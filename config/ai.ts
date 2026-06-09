export interface AI_TASK_CONFIG {
  model:       string;
  action:      "generate" | "edit";
  size:        "1024x1024" | "1024x1536" | "1536x1024";
  quality:     "low" | "medium" | "high";
  background:  "opaque" | "transparent";
  // inputFixed: true 表示手图必须已裁为与 size 相同的固定分辨率（前端强制裁剪）
  // inputFixed: false 表示输入尺寸不限，路由自动 letterbox padding 对齐
  inputFixed:  boolean;
}

// API 接入配置
export const AI_BASE = {
  baseUrl:   process.env.OPENAI_BASE_URL ?? "https://aihubmix.com/v1",
  apiKey:    process.env.OPENAI_API_KEY  ?? "sk-11A20IIdQETwqD7M44BdB8F2Ea9a4f78B2B309947c6e8650",
  timeoutMs: 180_000,  // 单次 AI 调用最长 3 分钟
};
