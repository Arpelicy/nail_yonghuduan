import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const processedDir = path.join(root, "data", "xhs", "processed");
const outputDatasetPath = path.join(processedDir, "xhs-style-dataset.json");
const outputAdminSeedPath = path.join(root, "admin-ops", "src", "data", "xhs-admin-seed.json");
const rawCommentSourceCandidates = [
  path.join(root, "data", "xhs", "json", "search_comments_2026-05-29.json"),
  "C:/Users/chen/Downloads/nail_xiaoshongshu-main/nail_xiaoshongshu-main/data/xhs/json/search_comments_2026-05-29.json"
];

const groupOrder = ["季节", "风格", "款式", "甲型"];
const groupColorMap = {
  季节: ["#ffe1ec", "#ffd2e2", "#ffc8dc"],
  风格: ["#e7f2ff", "#d7ebff", "#c4e2ff"],
  款式: ["#e8f8ef", "#d6f0e2", "#c7e9d8"],
  甲型: ["#fff4d8", "#ffecc0", "#ffe3ab"]
};

function readJsonByStem(stem) {
  const target = fs.readdirSync(processedDir).find((name) => name.endsWith(".json") && name.includes(stem));
  if (!target) throw new Error(`Missing source json for ${stem}`);
  return JSON.parse(fs.readFileSync(path.join(processedDir, target), "utf8"));
}

function cleanCopy(text) {
  return String(text || "")
    .split("#")[0]
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function estimateCommentLikes(styleLikes, commentIndex, text) {
  const heat = Math.max(18, Math.round(Math.log10(Math.max(10, styleLikes || 10)) * 18))
  const lengthBoost = Math.min(18, Math.max(2, Math.round(String(text || "").length / 6)))
  return Math.max(3, heat - commentIndex * 2 + lengthBoost)
}

function loadRawCommentMetaMap() {
  for (const candidate of rawCommentSourceCandidates) {
    if (!fs.existsSync(candidate)) continue;
    const rows = JSON.parse(fs.readFileSync(candidate, "utf8"));
    if (!Array.isArray(rows) || !rows.length) continue;
    return new Map(
      rows.map((item) => [
        String(item.comment_id || ""),
        {
          userName: String(item.nickname || "").trim(),
          likes: Number(item.like_count || 0)
        }
      ])
    );
  }
  return new Map();
}

function buildMaskedName(name) {
  const chars = Array.from(String(name || "").trim());
  if (!chars.length) return "匿名用户";
  if (chars.length === 1) return `${chars[0]}*`;
  const middleIndex = Math.floor(chars.length / 2);
  return chars.map((char, index) => (index === middleIndex ? "*" : char)).join("");
}

function resolveCommentKey(row) {
  return String(
    row?.comment_id
    || row?.["评论ID"]
    || row?.["璇勮ID"]
    || Object.values(row || {})[0]
    || ""
  );
}

function scoreToRating(likes, saves, comments) {
  const score = Math.log10(Math.max(10, likes + saves + comments * 4));
  return Math.min(5, Math.max(4.4, Number((4.35 + score * 0.12).toFixed(1))));
}

function inferBucket(post) {
  const likes = Number(post["点赞数"] || 0);
  const saves = Number(post["收藏数"] || 0);
  const comments = Number(post["实际评论数"] || post["评论数"] || 0);
  const interaction = likes + saves * 0.8 + comments * 8;
  if (interaction >= 120000) return "hot";
  if (interaction >= 45000) return "stable";
  if (interaction >= 12000) return "potential";
  return "cold";
}

function inferPrice(post, tagGroups) {
  const craftTags = tagGroups["款式"] || [];
  const styleTags = tagGroups["风格"] || [];
  const lengthTags = tagGroups["甲型"] || [];
  let price = 138;
  if (craftTags.includes("猫眼")) price += 40;
  if (craftTags.includes("钻饰")) price += 35;
  if (craftTags.includes("手绘")) price += 45;
  if (craftTags.includes("法式")) price += 20;
  if (craftTags.includes("渐变")) price += 15;
  if (craftTags.includes("花朵")) price += 18;
  if (styleTags.includes("高级感")) price += 12;
  if (lengthTags.includes("延长甲")) price += 30;
  return Math.min(298, price);
}

function syntheticMetricBase(bucket, index) {
  const cycle = (index % 11) + 1;
  if (bucket === "hot") {
    return {
      exposure: 1800 + cycle * 95,
      view: 520 + cycle * 26,
      detail: 240 + cycle * 15,
      basketAdd: 210 + cycle * 14,
      tryonSuccess: 186 + cycle * 13,
      resultView: 168 + cycle * 11,
      want: 72 + cycle * 5,
      confirm: 28 + cycle * 3,
      orders: 24 + cycle * 3,
      hotScore: 88 + (cycle % 8),
      coldRiskScore: 10 + (cycle % 6),
      growthScore: 72 + (cycle % 12),
      trendLabel: "HotUp",
      sampleStatus: "enough"
    };
  }
  if (bucket === "stable") {
    return {
      exposure: 1320 + cycle * 70,
      view: 360 + cycle * 18,
      detail: 176 + cycle * 9,
      basketAdd: 138 + cycle * 8,
      tryonSuccess: 122 + cycle * 8,
      resultView: 104 + cycle * 7,
      want: 42 + cycle * 4,
      confirm: 16 + cycle * 2,
      orders: 14 + cycle * 2,
      hotScore: 68 + (cycle % 12),
      coldRiskScore: 18 + (cycle % 10),
      growthScore: 52 + (cycle % 10),
      trendLabel: "Stable",
      sampleStatus: "enough"
    };
  }
  if (bucket === "potential") {
    return {
      exposure: 520 + cycle * 42,
      view: 182 + cycle * 12,
      detail: 88 + cycle * 7,
      basketAdd: 80 + cycle * 6,
      tryonSuccess: 72 + cycle * 5,
      resultView: 64 + cycle * 5,
      want: 28 + cycle * 3,
      confirm: 10 + cycle * 2,
      orders: 8 + cycle * 2,
      hotScore: 74 + (cycle % 9),
      coldRiskScore: 22 + (cycle % 8),
      growthScore: 76 + (cycle % 10),
      trendLabel: "Potential",
      sampleStatus: cycle <= 3 ? "low_sample" : "enough"
    };
  }
  return {
    exposure: 260 + cycle * 28,
    view: 62 + cycle * 5,
    detail: 22 + cycle * 3,
    basketAdd: 18 + cycle * 2,
    tryonSuccess: 16 + cycle * 2,
    resultView: 12 + cycle * 2,
    want: 3 + Math.floor(cycle / 3),
    confirm: cycle <= 4 ? 0 : 1,
    orders: cycle <= 5 ? 0 : 1,
    hotScore: 18 + (cycle % 12),
    coldRiskScore: 72 + (cycle % 18),
    growthScore: 16 + (cycle % 10),
    trendLabel: "ColdDown",
    sampleStatus: "low_sample"
  };
}

function inferScene(tagGroups, cleanedCopy) {
  const text = cleanedCopy || "";
  const scenes = [];
  if (/上班|通勤|面试|日常/.test(text)) scenes.push("日常");
  if (/约会|聚会|聚餐/.test(text)) scenes.push("约会");
  if (/婚礼|新娘/.test(text)) scenes.push("婚礼");
  if (/夏|春/.test(text)) scenes.push("出游");
  return scenes.length ? scenes : ["日常"];
}

function inferEffect(tagGroups, cleanedCopy) {
  const effects = [];
  const craftTags = tagGroups["款式"] || [];
  if (craftTags.includes("猫眼")) effects.push("猫眼");
  if (craftTags.includes("渐变")) effects.push("渐变");
  if (craftTags.includes("法式")) effects.push("精致");
  if (/显白/.test(cleanedCopy)) effects.push("显白");
  if (/高级|老钱风/.test(cleanedCopy)) effects.push("高级感");
  return effects.length ? effects : ["耐看"];
}

function buildTagGroups(source) {
  const groups = {};
  const binaryTags = {};
  for (const key of Object.keys(source)) {
    const match = /^(.+?)_(.+)$/.exec(key);
    if (!match) continue;
    const [, group, tag] = match;
    if (!groupOrder.includes(group)) continue;
    const value = Number(source[key] || 0);
    binaryTags[key] = value;
    if (!groups[group]) groups[group] = [];
    if (value === 1) groups[group].push(tag);
  }
  return { groups, binaryTags };
}

function buildGradients(primary, secondary) {
  const palette = groupColorMap[primary] || ["#f6e7ef", "#ead9ea", "#dccde6"];
  const fallback = groupColorMap[secondary] || ["#fde7d8", "#f7d9c8", "#f0cdb9"];
  return {
    thumb: `linear-gradient(135deg, ${palette[0]}, ${palette[1]} 56%, ${fallback[2]})`,
    accent: palette[2],
    nail: `linear-gradient(145deg, ${palette[1]} 0 34%, ${fallback[0]} 58%, ${palette[2]} 86%)`
  };
}

function uniqueNonEmpty(values) {
  return [...new Set(values.filter(Boolean))];
}

const postsPayload = readJsonByStem("帖子数据库");
const imagesPayload = readJsonByStem("图片数据库");
const commentsPayload = readJsonByStem("评论数据库");

const posts = postsPayload.data || [];
const images = imagesPayload.data || [];
const comments = commentsPayload.data || [];
const rawCommentMetaById = loadRawCommentMetaMap();
const imageByPostId = new Map(images.map((row) => [row["帖子ID"], row]));
const commentsByPostId = new Map();

for (const comment of comments) {
  const postId = comment["帖子ID"];
  if (!commentsByPostId.has(postId)) commentsByPostId.set(postId, []);
  commentsByPostId.get(postId).push(comment);
}

const normalizedStyles = posts.map((post, index) => {
  const postId = post["帖子ID"];
  const imageRow = imageByPostId.get(postId) || {};
  const relatedComments = commentsByPostId.get(postId) || [];
  const { groups: tagGroups, binaryTags } = buildTagGroups({ ...post, ...imageRow });
  const groupKeys = groupOrder.filter((key) => (tagGroups[key] || []).length);
  const primaryGroup = groupKeys[0] || "风格";
  const secondaryGroup = groupKeys[1] || primaryGroup;
  const primaryTag = tagGroups["款式"]?.[0] || tagGroups["风格"]?.[0] || tagGroups["季节"]?.[0] || tagGroups["甲型"]?.[0] || "精选";
  const secondaryTag = tagGroups["风格"]?.[0] || tagGroups["甲型"]?.[0] || tagGroups["季节"]?.[0] || primaryTag;
  const cleanedDescription = cleanCopy(post["正文"] || post["标题"]);
  const cleanedTitle = cleanCopy(post["标题"]) || `小红书灵感款 ${index + 1}`;
  const recommendBucket = inferBucket(post);
  const synthetic = syntheticMetricBase(recommendBucket, index);
  const reviewEntries = relatedComments
    .map((item) => ({
      commentId: String(item["评论ID"] || ""),
      text: cleanCopy(item["评论内容"]),
      rawMeta: rawCommentMetaById.get(resolveCommentKey(item)) || null
    }))
    .filter((item) => item.text && item.text.length >= 2)
    .slice(0, 3);
  const reviewTexts = uniqueNonEmpty(reviewEntries.map((item) => item.text));
  const likes = Number(post["点赞数"] || 0);
  const saves = Number(post["收藏数"] || 0);
  const commentCount = Number(post["实际评论数"] || post["评论数"] || 0);
  const shareCount = Number(post["分享数"] || 0);
  const hotScore = Math.min(99, Math.max(22, Math.round(Math.log10(Math.max(10, likes + saves + commentCount * 10 + shareCount)) * 20)));
  const gradients = buildGradients(primaryGroup, secondaryGroup);
  const imagePath = String(imageRow["图片路径"] || "").split(/[/\\]/).pop();
  const postUrl = post["帖子链接"] || "";
  const reviewDetails = reviewEntries.map((entry, commentIndex) => ({
    commentId: entry.commentId,
    userName: entry.rawMeta?.userName || "Guest",
    maskedUserName: buildMaskedName(entry.rawMeta?.userName || "Guest"),
    text: entry.text,
    likes: Number.isFinite(entry.rawMeta?.likes) && entry.rawMeta.likes > 0
      ? entry.rawMeta.likes
      : estimateCommentLikes(likes, commentIndex, entry.text)
  }))

  return {
    id: `xhs-${postId}`,
    postId,
    name: cleanedTitle,
    rawTitle: cleanedTitle,
    primaryTag,
    secondaryTag,
    image: imagePath ? `/api/xhs-image?file=${encodeURIComponent(imagePath)}` : "",
    likes: String(likes),
    rating: scoreToRating(likes, saves, commentCount).toFixed(1),
    reviews: reviewTexts.length ? reviewTexts : ["这款最近互动不错，适合先加入试戴看看。"],
    reviewDetails: reviewDetails.length ? reviewDetails : [{ commentId: `fallback-${postId}`, userName: "Guest", maskedUserName: "G*", text: "这款最近互动不错，适合先加入试戴看看。", likes: 6 }],
    definition: cleanedDescription || cleanedTitle,
    rawDescription: cleanedDescription || cleanedTitle,
    thumb: gradients.thumb,
    accent: gradients.accent,
    nail: gradients.nail,
    recommendBucket,
    hotScore,
    author: post["作者"] || "",
    postStats: {
      likes,
      saves,
      comments: commentCount,
      shares: shareCount,
      imageCount: Number(post["图片数量"] || 1),
      sourceUrl: postUrl
    },
    tagGroups,
    binaryTags,
    businessMetrics: {
      exposure: synthetic.exposure,
      view: synthetic.view,
      detail: synthetic.detail,
      tryonSuccess: synthetic.tryonSuccess,
      want: synthetic.want,
      confirm: synthetic.confirm,
      orders: synthetic.orders,
      trendLabel: synthetic.trendLabel,
      sampleStatus: synthetic.sampleStatus,
      tryonRate: Number((synthetic.tryonSuccess / Math.max(1, synthetic.view)).toFixed(3)),
      wantRate: Number((synthetic.want / Math.max(1, synthetic.tryonSuccess)).toFixed(3)),
      confirmRate: Number((synthetic.confirm / Math.max(1, synthetic.want)).toFixed(3))
    }
  };
});

const filterGroups = groupOrder.reduce((acc, group) => {
  acc[group] = uniqueNonEmpty(normalizedStyles.flatMap((style) => style.tagGroups[group] || [])).sort((a, b) => a.localeCompare(b, "zh-CN"));
  return acc;
}, {});

const sortedPublished = [...normalizedStyles].sort((a, b) => b.hotScore - a.hotScore);
const promotedIds = new Set(sortedPublished.slice(0, 8).map((item) => item.id));
const statusBands = {
  published: 88,
  pending_review: 12,
  draft: 10,
  unpublished: 8,
  archived: 5
};

const adminSeed = normalizedStyles.map((style, index) => {
  const tagGroups = style.tagGroups;
  const status =
    index < statusBands.published
      ? "published"
      : index < statusBands.published + statusBands.pending_review
        ? "pending_review"
        : index < statusBands.published + statusBands.pending_review + statusBands.draft
          ? "draft"
          : index < statusBands.published + statusBands.pending_review + statusBands.draft + statusBands.unpublished
            ? "unpublished"
            : "archived";
  const makeable = !(tagGroups["甲型"] || []).includes("延长甲") || index % 4 !== 0;
  const listedDay = String((index % 28) + 1).padStart(2, "0");
  const synthetic = syntheticMetricBase(style.recommendBucket, index)
  const trendLabel =
    status === "draft" || status === "pending_review"
      ? "Untested"
      : synthetic.trendLabel;
  const growthScore = trendLabel === "Untested" ? 32 : synthetic.growthScore
  const hotScore = trendLabel === "Untested" ? 26 : synthetic.hotScore
  const coldRiskScore = trendLabel === "Untested" ? 36 : synthetic.coldRiskScore
  const simulatedConfirm = trendLabel === "Untested" ? 0 : synthetic.confirm

  return {
    id: style.id,
    styleCode: `XHS${String(index + 1).padStart(4, "0")}`,
    name: style.name,
    description: style.definition,
    status,
    category: style.primaryTag,
    price: inferPrice({}, tagGroups),
    coverImage: style.image,
    isPromoted: promotedIds.has(style.id),
    isColdStart: status === "draft" || status === "pending_review",
    listedAt: status === "published" || status === "unpublished" || status === "archived" ? `2026-05-${listedDay}` : undefined,
    unpublishedAt: status === "unpublished" || status === "archived" ? `2026-05-${String(((index + 11) % 28) + 1).padStart(2, "0")}` : null,
    crawled: status === "draft" || status === "pending_review",
    makeable,
    tags: {
      color: tagGroups["季节"]?.length ? tagGroups["季节"] : ["通用"],
      style: tagGroups["风格"]?.length ? tagGroups["风格"] : ["精选"],
      craft: tagGroups["款式"]?.length ? tagGroups["款式"] : [style.primaryTag],
      length: tagGroups["甲型"]?.length ? tagGroups["甲型"] : ["短甲"],
      scene: inferScene(tagGroups, style.definition),
      effect: inferEffect(tagGroups, style.definition)
    },
    metrics: {
      exposure: trendLabel === "Untested" ? 0 : synthetic.exposure,
      view: trendLabel === "Untested" ? 0 : synthetic.view,
      detail: trendLabel === "Untested" ? 0 : synthetic.detail,
      basketAdd: trendLabel === "Untested" ? 0 : synthetic.basketAdd,
      tryonSuccess: trendLabel === "Untested" ? 0 : synthetic.tryonSuccess,
      resultView: trendLabel === "Untested" ? 0 : synthetic.resultView,
      want: trendLabel === "Untested" ? 0 : synthetic.want,
      confirm: trendLabel === "Untested" ? 0 : synthetic.confirm,
      orders: trendLabel === "Untested" ? 0 : synthetic.orders,
      hotScore,
      coldRiskScore,
      growthScore,
      trendLabel,
      sampleStatus: trendLabel === "Untested" ? "low_sample" : synthetic.sampleStatus,
      suggestion:
        trendLabel === "HotUp"
          ? "互动和转化都高，适合继续占据核心推荐位。"
          : trendLabel === "Stable"
            ? "表现稳定，适合作为稳转化承接款持续保留。"
            : trendLabel === "Potential"
              ? "曝光还不算高，但意向不错，适合继续测试。"
              : trendLabel === "Untested"
                ? "新导入款或审核中款，建议先补齐资料再做小流量测试。"
                : "互动热度偏低，建议先观察封面和定位，再决定是否下架。",
      sourceBreakdown: {
        card: Math.round(simulatedConfirm * 0.28),
        detail: Math.round(simulatedConfirm * 0.14),
        tryon_result: Math.round(simulatedConfirm * 0.26),
        ai_recommend: Math.round(simulatedConfirm * 0.18),
        want_list: Math.max(0, simulatedConfirm - Math.round(simulatedConfirm * 0.28) - Math.round(simulatedConfirm * 0.14) - Math.round(simulatedConfirm * 0.26) - Math.round(simulatedConfirm * 0.18))
      },
      generationSuccessRate: Number((0.9 + ((hotScore % 8) / 100)).toFixed(2)),
      avgLatencySec: Number((7 + ((index % 9) * 0.6)).toFixed(1)),
      resultViewDurationSec: Math.max(12, Math.round(18 + hotScore * 0.28))
    }
  };
});

const dataset = {
  updatedAt: new Date().toISOString(),
  styles: normalizedStyles,
  filterGroups,
  stats: {
    totalStyles: normalizedStyles.length,
    totalImages: imagesPayload.total_images || images.length,
    totalComments: commentsPayload.total_comments || comments.length
  }
};

fs.writeFileSync(outputDatasetPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
fs.mkdirSync(path.dirname(outputAdminSeedPath), { recursive: true });
fs.writeFileSync(outputAdminSeedPath, `${JSON.stringify(adminSeed, null, 2)}\n`, "utf8");

console.log(`Built XHS dataset with ${normalizedStyles.length} styles`);
console.log(`- ${outputDatasetPath}`);
console.log(`- ${outputAdminSeedPath}`);
