# 快速上手指南 — AI 美甲试戴系统

> 读完这份文档你就能接手工作。不需要读其他任何文件。

---

## 一句话描述

用户上传**款式图**和**手图**，AI 把款式贴到手上，输出试戴效果图。

---

## 先跑起来

```bash
npm install && npm run dev   # http://localhost:3000
```

`.env.local`（可选，有默认值）：
```env
OPENAI_API_KEY=sk-...        # AiHubMix key
OPENAI_BASE_URL=https://aihubmix.com/v1
NAIL_API_URL=http://124.220.46.84      # YOLO 指甲分割
WILOR_API_URL=http://localhost:8088    # WiLoR 手部检测（docker start nail-api）
```

---

## 只有三个页面入口

```
/try-on/normal   →   精准试戴 + 快速试戴（同一页面，tab 切换）
```

---

## 两个 Tab 的区别

### 精准试戴
完整流程，精细控制：
1. 上传款式图 → AI 两步处理 → modal 确认框 → 款式池生成
2. 上传手图 → 自动识别指甲 → 裁图确认
3. 选模式（保持甲型 / 按红框大小）→ 开始生成

### 快速试戴
极简流程：
1. 上传款式图（直接用原图，不走 AI）
2. 上传手图 → 裁图确认
3. 勾选是否保持甲型 → 开始生成

---

## 唯一需要理解的数据流

```
款式图上传
  → POST /api/style-detect
  → Step1: gpt-5.4 在款式图上画红框（detected）
  → Step2: gpt-5.5 用 detected 图还原透明款式（extracted）
  → 缓存到 public/style-library/（同文件名直接命中，不重复调 AI）

手图上传
  → YOLO /api/nail-segment + WiLoR /api/hand-detect（并行）
  → 检测结果定位裁框中心
  → 用户确认裁图 → 输出精确 1024×1536

开始生成
  → POST /api/nail-tryon
  → 图1 = renderHandWithBoxes()（手图 + 款式裁片 + 红框）
  → 图2 = 干净手图
  → gpt-5.5 edit → 返回 1024×1536 试戴结果
```

---

## 四个模式只有两条规则

| 模式 | 何时用 | 提示词 |
|------|--------|--------|
| 精准·保持甲型 | 不改指甲形状，只换图案 | `PROMPT_FULL_TRYON_KEEP` |
| 精准·按红框大小 | 延长指甲到框所示长度 | `PROMPT_LENGTH` |
| 快速·不勾选 | 允许 AI 调整甲型 | `PROMPT_FULL_TRYON` |
| 快速·勾选保持甲型 | 不改指甲形状 | `PROMPT_FULL_TRYON_KEEP` |

**所有模式**：图1 = 有红框的手图，图2 = 干净手图（快速试戴图1是原始款式图）

---

## 文件在哪改什么

| 要改什么 | 去哪里 |
|----------|--------|
| 提示词效果不好 | `config/prompts.ts` |
| AI 模型 / 质量 / 尺寸 | `config/prompts.ts` 里每个 `CONFIG_*` |
| API 超时 / key | `config/ai.ts` |
| 款式图两步 pipeline | `app/api/style-detect/route.ts` |
| 试戴生成逻辑 | `app/api/nail-tryon/route.ts` |
| 共享 AI 调用函数 | `lib/ai-server.ts`（服务端）|
| 精准试戴 UI + 所有交互 | `app/try-on/normal/page.tsx` |
| 快速试戴 UI | 同上，`QuickView` 函数（文件底部）|
| 类型定义 | `lib/types.ts` |

---

## 最容易踩的坑

1. **款式图缓存**：同文件名直接返回缓存，不重新调 AI。想强制重新生成 → 删 `public/style-library/detected/` 和 `extracted/` 里对应文件

2. **图1 vs 图2**：精准试戴的图1是 `renderHandWithBoxes()` 渲染出来的，不是 extracted 款式图。快速试戴才是 extracted

3. **裁图尺寸**：所有手图必须 1024×1536 才能进 edit pipeline。`confirmCrop` 已经保证这一点，不要绕过

4. **超时**：AI 两步 pipeline 最长 6 分钟。前端 timeout 设的 360 秒，单次 AI 调用 180 秒。如果改了不要调小

5. **WiLoR 手部检测**：本地 Docker，`docker start nail-api`，不启动也能用（降级为只用 YOLO 结果）

---

## 看代码的顺序

```
1. config/prompts.ts        ← 搞清楚有几种模式、每种用什么图
2. app/api/style-detect/    ← 款式图怎么处理、缓存怎么工作
3. app/api/nail-tryon/      ← 试戴怎么调用 AI
4. lib/ai-server.ts         ← callGenerate 是怎么发请求的
5. page.tsx（NormalView）   ← 精准试戴的状态机，最复杂
6. page.tsx（QuickView）    ← 简单，文件最底部
```

五步读完，基本就能接手了。
