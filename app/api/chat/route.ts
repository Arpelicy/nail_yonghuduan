import { type NextRequest, NextResponse } from "next/server";

const DEEPSEEK_API = "https://api.deepseek.com/chat/completions";
const NAIL_API = process.env.NAIL_API_URL ?? "http://localhost:5173";

interface StyleEntry {
  id: string;
  name: string;
  primaryTag: string;
  secondaryTag: string;
  definition: string;
  hotScore: number;
  likes: string | number;
  tagGroups?: Record<string, string[]>;
}

async function fetchStyleCatalog(): Promise<StyleEntry[]> {
  try {
    const res = await fetch(`${NAIL_API}/api/xhs-style-dataset`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.styles ?? []).map((s: StyleEntry) => ({
      id: s.id,
      name: s.name,
      primaryTag: s.primaryTag,
      secondaryTag: s.secondaryTag,
      definition: s.definition,
      hotScore: s.hotScore,
      likes: s.likes,
      tagGroups: s.tagGroups,
    }));
  } catch {
    return [];
  }
}

function buildSystemPrompt(styles: StyleEntry[]): string {
  // 只发 id + name + 主要分类标签，大幅减少 token
  const catalog = styles
    .map((s) => {
      const tags = s.tagGroups
        ? Object.values(s.tagGroups).flat().filter(Boolean).join("/")
        : `${s.primaryTag}/${s.secondaryTag}`;
      return `${s.id} ${s.name} [${tags}] 热${s.hotScore}`;
    })
    .join("\n");

  return `你是美甲店 AI 顾问"灵感小助手"，熟悉肤色搭配、甲型、工艺持久度、场景适配。只推荐下方款式库中真实存在的款式，不编造。

店内款式（共 ${styles.length} 款，格式：id 名称 [标签] 热度）：
${catalog}

回复规则：
1. 语气亲切，像美甲师朋友聊天，使用 Markdown 格式（**加粗**、列表等）让回复更易读。
2. 推荐 1-3 款，只写款式名称，说清楚推荐理由（肤色/场景/工艺）。**绝对不要**在正文中提及任何 id（如 xhs- 开头的字符串）。
3. 回复正文结束后，另起一行输出：:::recommended {"ids":["id1","id2"]}，只用真实 id，最多 3 个。这一行不会展示给用户，仅用于系统识别。
4. 用户需求不明确时，先问 1 个关键问题再推荐。`;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "DEEPSEEK_API_KEY not configured" }, { status: 500 });
  }

  let body: { message: string; history?: { role: string; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { message, history = [] } = body;
  if (!message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const styles = await fetchStyleCatalog();
  const systemPrompt = buildSystemPrompt(styles);

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10),
    { role: "user", content: message },
  ];

  try {
    const resp = await fetch(DEEPSEEK_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages,
        max_tokens: 800,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(50000),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return NextResponse.json({ error: `DeepSeek error ${resp.status}: ${err}` }, { status: 502 });
    }

    const data = await resp.json();
    const rawReply: string = data.choices?.[0]?.message?.content ?? "";

    // 解析推荐 ID（容错：模型可能在行首/行末加空格或换行）
    let recommendedIds: string[] = [];
    // 匹配整行 :::recommended {...}，无论前后有无空白
    const recMatch = rawReply.match(/:::recommended\s*(\{[\s\S]*?\})/);
    if (recMatch) {
      try {
        const parsed = JSON.parse(recMatch[1]);
        recommendedIds = (parsed.ids ?? []).filter((id: string) =>
          styles.some((s) => s.id === id)
        );
      } catch {}
    }
    // 去掉 :::recommended 整行，再去掉任何残留的 xhs- id 字符串
    let reply = rawReply
      .replace(/:::recommended\s*\{[\s\S]*?\}/g, "")
      .replace(/\bxhs-[a-f0-9]+\b/g, "")
      .trim();

    return NextResponse.json({ reply, recommendedIds });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
