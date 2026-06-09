import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const processedDir = path.join(root, "..", "data", "xhs", "processed");
const baseDatasetPath = path.join(processedDir, "xhs-style-dataset.json");
const enrichedDatasetPath = path.join(processedDir, "xhs-style-dataset.enriched.json");

loadEnv(envPath);

const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const batchSize = Number(process.env.XHS_ENRICH_BATCH_SIZE || 8);
const maxCount = Number(process.env.XHS_ENRICH_MAX_COUNT || 9999);

if (!apiKey) {
  throw new Error("Missing DEEPSEEK_API_KEY in user-client/.env");
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function chatJson(messages) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: 4000,
          response_format: { type: "json_object" },
          messages
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || JSON.stringify(payload));
      }
      const content = payload?.choices?.[0]?.message?.content || "{}";
      return JSON.parse(content);
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
      }
    }
  }
  throw lastError;
}

function ensureLength(text, minLength, maxLength) {
  const normalized = String(text || "").replace(/\s+/g, "").trim();
  if (!normalized) return "";
  if (normalized.length > maxLength) return normalized.slice(0, maxLength);
  if (normalized.length < minLength) return normalized;
  return normalized;
}

function mergeItem(baseStyle, generated) {
  const reviews = Array.isArray(baseStyle.reviewDetails) ? baseStyle.reviewDetails : (baseStyle.reviews || []).map((text) => ({ text, likes: 0 }));
  return {
    ...baseStyle,
    name: ensureLength(generated.name || baseStyle.name, 6, 16) || baseStyle.name,
    definition: ensureLength(generated.description || baseStyle.definition, 40, 88) || baseStyle.definition,
    primaryTag: ensureLength(generated.primaryTagText || baseStyle.primaryTag, 2, 8) || baseStyle.primaryTag,
    secondaryTag: ensureLength(generated.secondaryTagText || baseStyle.secondaryTag, 2, 10) || baseStyle.secondaryTag,
    marketingTitle: ensureLength(generated.marketingTitle || generated.name || baseStyle.name, 8, 20) || baseStyle.name,
    reviews,
    reviewDetails: reviews
  };
}

const dataset = JSON.parse(fs.readFileSync(baseDatasetPath, "utf8"));
const existingEnriched = fs.existsSync(enrichedDatasetPath)
  ? JSON.parse(fs.readFileSync(enrichedDatasetPath, "utf8"))
  : null;
const styles = Array.isArray(dataset.styles) ? dataset.styles.slice(0, maxCount) : [];
const existingById = new Map((existingEnriched?.styles || []).map((item) => [item.id, item]));
const byId = new Map(
  dataset.styles.map((item) => {
    const existing = existingById.get(item.id);
    return [
      item.id,
      existing
        ? {
            ...item,
            ...existing,
            reviewDetails: item.reviewDetails,
            reviews: item.reviews,
            businessMetrics: item.businessMetrics
          }
        : item
    ];
  })
);

function saveProgress() {
  const payload = {
    ...dataset,
    enrichedAt: new Date().toISOString(),
    styles: dataset.styles.map((item) => {
      const current = byId.get(item.id) || item;
      return {
        ...current,
        reviewDetails: item.reviewDetails,
        reviews: item.reviews,
        businessMetrics: item.businessMetrics
      };
    })
  };
  fs.writeFileSync(enrichedDatasetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

for (let index = 0; index < styles.length; index += batchSize) {
  const batch = styles.slice(index, index + batchSize);
  const pendingBatch = batch.filter((item) => {
    const current = byId.get(item.id) || item;
    return !current.marketingTitle;
  });
  if (!pendingBatch.length) {
    console.log(`Skip ${Math.min(index + batch.length, styles.length)}/${styles.length}`);
    continue;
  }
  const requestItems = pendingBatch.map((item) => ({
    id: item.id,
    rawTitle: item.rawTitle || item.name,
    rawDescription: item.rawDescription || item.definition,
    primaryTag: item.primaryTag,
    secondaryTag: item.secondaryTag,
    tagGroups: item.tagGroups,
    topComments: (item.reviewDetails || []).map((review) => review.text).slice(0, 2)
  }));

  const result = await chatJson([
    {
      role: "system",
      content:
        "你是美甲内容编辑。请根据每条款式的原始标题、原始介绍、标签和评论，返回更适合用户端展示的标题与介绍。必须只返回 JSON。要求：1）name 为 8-16 个中文字符；2）marketingTitle 为 10-20 个中文字符；3）description 为 48-80 个中文字符；4）不要带 #、话题、平台口吻、口语碎碎念；5）保留原有风格和款式信息；6）primaryTagText 和 secondaryTagText 要简短自然。返回格式：{\"items\":[{\"id\":\"...\",\"name\":\"...\",\"marketingTitle\":\"...\",\"description\":\"...\",\"primaryTagText\":\"...\",\"secondaryTagText\":\"...\"}]}"
    },
    {
      role: "user",
      content: JSON.stringify({ items: requestItems }, null, 2)
    }
  ]);

  const generatedItems = Array.isArray(result.items) ? result.items : [];
  for (const generated of generatedItems) {
    const baseStyle = byId.get(generated.id);
    if (!baseStyle) continue;
    byId.set(generated.id, mergeItem(baseStyle, generated));
  }

  console.log(`Enriched ${Math.min(index + batch.length, styles.length)}/${styles.length}`);
  saveProgress();
}
saveProgress();
console.log(`Saved enriched dataset to ${enrichedDatasetPath}`);
