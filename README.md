# AI 美甲试戴系统 — 工作交接文档

> 项目代号：`ai-nail-tryon-demo`
> 技术栈：Next.js 14 · TypeScript · Tailwind CSS · sharp
> AI 接入：AiHubMix（OpenAI 兼容代理）`gpt-5.4` / `gpt-5.5`
> 最后更新：2026-06-08

---

## 目录

1. [项目概述](#1-项目概述)
2. [快速启动](#2-快速启动)
3. [目录结构](#3-目录结构)
4. [核心功能模块](#4-核心功能模块)
5. [AI Pipeline 详解](#5-ai-pipeline-详解)
6. [4 种试戴模式](#6-4-种试戴模式)
7. [款式图上传流程](#7-款式图上传流程)
8. [前端裁图流程](#8-前端裁图流程)
9. [配置文件说明](#9-配置文件说明)
10. [缓存机制](#10-缓存机制)
11. [已知限制与待完成项](#11-已知限制与待完成项)
12. [外部依赖与服务](#12-外部依赖与服务)

---

## 1. 项目概述

一套基于 AI 的美甲试戴 demo，分为两个入口：

- **精准试戴**（`/try-on/normal` → 精准试戴 tab）：完整流程，含手图裁剪、指甲识别、款式图 AI 处理、4 种试戴模式
- **快速试戴**（同页面 → 快速试戴 tab）：极简流程，上传款式图 + 手图，勾选是否保持甲型，直接生成（B1/B2 模式）

### 整体数据流（精准试戴）

```
1. 用户上传款式图
   → /api/style-detect：Step1 AI 标注红框(detected) → Step2 AI 还原透明款式(extracted)
   → 弹出 modal：左=detected参考图，右=extracted可调框
   → 用户确认框 → 左面板更新，款式池生成

2. 用户上传/选择手图
   → 前端裁图（1024×1536 竖图）
   → 识别指甲：YOLO 分割 + WiLoR 手部检测 → 更新指甲框

3. 用户选择试戴模式（A/B1/B2/C）
   → 点「开始生成」→ /api/nail-tryon → AI edit → 1024×1536 试戴结果图
```

---

## 2. 快速启动

```bash
npm install
npm run dev   # http://localhost:3000
```

### 环境变量（`.env.local`）

```env
OPENAI_API_KEY=sk-xxxxxx
OPENAI_BASE_URL=https://aihubmix.com/v1
NAIL_API_URL=http://124.220.46.84       # YOLO 指甲分割（公网）
WILOR_API_URL=http://localhost:8088     # WiLoR 手部检测（本地 Docker）
STYLE_MODEL=gpt-5.5
```

---

## 3. 目录结构

```
123/
├── app/
│   ├── api/
│   │   ├── hand-detect/route.ts     # WiLoR 手部检测代理
│   │   ├── nail-segment/route.ts    # YOLO 指甲分割代理
│   │   ├── nail-tryon/route.ts      # ★ 试戴主接口（4 种模式）
│   │   └── style-detect/route.ts   # 款式图两步 AI pipeline + 缓存
│   └── try-on/
│       └── normal/page.tsx          # 主页面（精准试戴 + 快速试戴）
│
├── config/
│   ├── ai.ts          # API key、base URL、AI_TASK_CONFIG 类型定义
│   └── prompts.ts     # 所有提示词 + 每个任务的模型配置
│
├── lib/
│   ├── ai-server.ts   # ★ 服务端共享 AI 调用函数（callGenerate、padToTarget）
│   ├── types.ts       # 核心类型：Box、StyleBox、TargetNail、Placement 等
│   ├── utils.ts       # boxStyle、cn、computeLongNailBox、nextRotation
│   └── mock-api.ts    # 本地 mock（已弃用，可删除）
│
├── components/
│   └── ui.tsx         # Card / GhostButton / GradientButton
│
└── public/
    ├── demo/          # 演示用手图、款式图、分割 JSON
    └── style-library/
        ├── detected/  # Step1 输出：带红框标注图（slug-detected.png）
        └── extracted/ # Step2 输出：透明背景正视图（slug-extracted.png）
```

---

## 4. 核心功能模块

### 4.1 款式图区域（左侧面板）

| 功能 | 说明 |
|------|------|
| 上传款式图 | 调 `/api/style-detect`，AI 两步处理后弹 modal |
| Modal 左栏 | detected 图（带红框，只读参考） |
| Modal 右栏 | extracted 图（透明底，可拖拽调整框） |
| 确认款式框 | `confirmUpload()` → 更新左面板图片 + 生成款式池 |
| 重切割/切开/补框/删框 | 手动微调切割区域 |
| 确认框·生成款式池 | `makeStylePiecesFromBoxes` → 裁切各指甲透明 PNG |

### 4.2 目标手图区域（中间面板）

| 功能 | 说明 |
|------|------|
| 裁图框 | 默认竖图 2:3（1024×1536），支持方图 1:1 |
| 确认裁图 | canvas 裁剪，坐标系转换，指甲框重映射 |
| 识别指甲 | 并行调 YOLO + WiLoR → 更新指甲框 |
| 试戴模式选择 | 4 个模式按钮（甲面迁移/完整试戴/完整保型/长度延长） |
| 开始生成 | POST `/api/nail-tryon` → 返回 1024×1536 试戴图 |

---

## 5. AI Pipeline 详解

### `/api/style-detect`（款式图处理）

```
输入：用户上传的款式图（任意尺寸）

Step 1 — 指甲标注（PROMPT_BOX）
  模型：gpt-5.4
  动作：generate
  输出：1024×1024，每个指甲有红色虚线框
  保存：public/style-library/detected/{slug}-detected.png

Step 2 — 款式还原（PROMPT_EXTRACT）
  模型：gpt-5.5
  动作：generate
  输出：1024×1024，透明背景，各指甲正视图排列
  保存：public/style-library/extracted/{slug}-extracted.png
```

### `/api/nail-tryon`（试戴生成）

```
输入：
  styleImageBase64  图1（款式参考，来源见下方模式说明）
  handImageBase64   图2（用户手图，已裁为 1024×1536）
  mode              试戴模式

所有模式共用：
  模型：gpt-5.5
  动作：edit
  输出：1024×1536
  quality：medium
  background：opaque
  inputFixed：true（前端保证输入为精确尺寸）
```

---

## 6. 4 种试戴模式

| 模式 | 按钮名 | 图1（款式参考）| 图2（用户手）| 提示词 |
|------|--------|--------------|------------|--------|
| **A** | 甲面迁移 | detected 带红框款式手图 | 用户手图 | `PROMPT_TRANSFER` |
| **B1** | 完整试戴 | 美甲款式图（extracted 或原图）| 用户手图 | `PROMPT_FULL_TRYON` |
| **B2** | 完整保型 | 美甲款式图（extracted 或原图）| 用户手图 | `PROMPT_FULL_TRYON_KEEP` |
| **C** | 长度延长 | detected 带红框款式手图 | 用户手图 | `PROMPT_LENGTH` |

**模式说明：**
- **A 甲面迁移**：图1 = detected（红框标注了源款式位置），AI 把框内图案迁移到用户指甲，**甲型/长度/弧度完全不变**
- **B1 完整试戴**：图1 = 款式图，允许 AI 适度调整甲型以贴合款式风格
- **B2 完整保型**：图1 = 款式图，保持甲型不变，只换图案颜色
- **C 长度延长**：图1 = detected（红框范围即期望甲长），AI 延长指甲到框所示长度并上妆

---

## 7. 款式图上传流程

```
1. 用户点击「上传」
2. 前端 POST /api/style-detect
   ├─ 缓存命中（同名文件已存在）→ 直接返回，不调 AI
   └─ 缓存未命中 → Step1 AI 标注框 → Step2 AI 还原透明款式
3. 前端收到结果：
   - setDetectedDataUrl(detected图)   ← 立刻写入，供 A/C 模式使用
   - setCurrentStyleImageUrl(extracted图)  ← 左面板立刻更新
   - 弹出 modal（左=detected参考，右=extracted可调框）
4. 用户在 modal 右栏调整框
5. 点「重新生成款式预览」→ 裁切各指甲 PNG
6. 点「确认使用此款式」→ confirmUpload() → 款式池写入主状态
```

**降级策略**：API 失败时 toast 提示，左面板不更新，用户可继续用现有图。

---

## 8. 前端裁图流程

```
1. 页面加载 → 读 demo 分割 JSON → buildSmartCropBox 智能初始化裁框
2. 用户选择：竖图 2:3（默认）/ 方图 1:1
3. 裁图框可拖动 + 右下角等比缩放（严格锁定宽高比）
4. 点「确认裁图」→ canvas 裁剪 → 输出 1024×1536 或 1024×1024 dataURL
5. 指甲框坐标从原图百分比映射到裁图区域百分比
6. 点「识别指甲」→ 并行调 YOLO + WiLoR → 更新指甲框
```

---

## 9. 配置文件说明

### `config/ai.ts`

```typescript
export interface AI_TASK_CONFIG {
  model:      string;
  action:     "generate" | "edit";
  size:       "1024x1024" | "1024x1536" | "1536x1024";
  quality:    "low" | "medium" | "high";
  background: "opaque" | "transparent";
  inputFixed: boolean;  // true = 前端已保证输入精确尺寸，跳过 padding
}
```

### `lib/ai-server.ts`（服务端共享）

所有 API 路由共用的 AI 调用函数，包含：
- `callGenerate(images, prompt, cfg)` — 核心调用，支持单图/双图
- `padToTarget(buf, w, h)` — letterbox padding，edit 模式用
- `autoSize(base64, fallback)` — 按输入比例自动匹配输出档位

### `config/prompts.ts` 导出一览

| 导出名 | 配套 Config | 用途 |
|--------|------------|------|
| `SYSTEM_TRYON` | — | 双图任务系统消息（约定图1=款式参考，图2=用户手） |
| `PROMPT_BOX` + `CONFIG_BOX` | gpt-5.4, generate, 1024×1024, low | Step1：标注指甲红框 |
| `PROMPT_EXTRACT` + `CONFIG_EXTRACT` | gpt-5.5, generate, 1024×1024, medium, transparent | Step2：还原透明款式 |
| `PROMPT_TRANSFER` + `CONFIG_TRANSFER` | gpt-5.5, edit, 1024×1536, medium | 模式A：甲面迁移 |
| `PROMPT_FULL_TRYON` + `CONFIG_FULL_TRYON` | gpt-5.5, edit, 1024×1536, medium | 模式B1：完整试戴 |
| `PROMPT_FULL_TRYON_KEEP` + `CONFIG_FULL_TRYON_KEEP` | gpt-5.5, edit, 1024×1536, medium | 模式B2：完整保型 |
| `PROMPT_LENGTH` + `CONFIG_LENGTH` | gpt-5.5, edit, 1024×1536, medium | 模式C：长度延长 |

---

## 10. 缓存机制

### 款式图缓存（`/api/style-detect`）

- **缓存 key**：上传文件名（去扩展名，slug 化，最长 60 字符）
- **缓存文件**：`public/style-library/detected/{slug}-detected.png` + `public/style-library/extracted/{slug}-extracted.png`
- **命中条件**：两个文件同时存在 → 直接读文件返回，不调 AI
- **更新方式**：删除对应文件后重新上传即可重新生成

### 试戴结果

当前无缓存，每次点「开始生成」都调 AI（约 30-90 秒）。

---

## 11. 已知限制与待完成项

### 待实现

- [ ] `PROMPT_EXTRACT` 效果优化：还原款式的颜色/图案还原度有待提升，prompt 可进一步调优
- [ ] `PROMPT_BOX` 升级为 `gpt-5.5` + `quality: medium`，提升标注框准确率
- [ ] 试戴结果大图预览 + 下载按钮（快速试戴已有，精准试戴待补）
- [ ] 款式池持久化（刷新后清空，可接入 localStorage 或数据库）
- [ ] 指甲框手动画长度框工具（模式 C 目前需用 detected 图作长度参考）

### 已知问题

- `action: "edit"` 对 AiHubMix 的具体行为与官方 OpenAI 可能有差异，需实测
- `gpt-5.4` 可用性依赖 AiHubMix 支持，如不支持可改 `CONFIG_BOX.model = "gpt-5.5"`
- 快速试戴的款式图走 `style-detect` 管道（Step1+2），首次上传较慢；相同文件名第二次命中缓存

---

## 12. 外部依赖与服务

| 服务 | 默认地址 | 说明 |
|------|----------|------|
| AiHubMix | `https://aihubmix.com/v1` | OpenAI 兼容代理，gpt-5.x 图像生成 |
| YOLO 指甲分割 | `http://124.220.46.84`（公网备用）| 返回指甲 bbox + polygon |
| WiLoR 手部检测 | `http://localhost:8088` | Docker 容器，返回手部 bbox + 2D keypoints |

### WiLoR 本地启动

```bash
docker start nail-api
```

### YOLO 本地模型文件

```
模型：nails_seg_s_yolov8_v1.pt（在 C:\Users\chen\Downloads\）
脚本：../nail-ai-ops-package/user-client/scripts/nail_segment.py
```

---

## 13. 前端 UI 设计系统

> 用户端与运营端（admin-ops）共用同一套设计 token，保持视觉一致性。

### 字体规范

| 用途 | 字体 |
|------|------|
| 英文/数字正文 | DM Sans（optical-size 9–40，opsz 轴）|
| 中文回退链 | Noto Sans SC → PingFang SC → Microsoft YaHei UI |
| 标题/Eyebrow（英文大写） | Cinzel，`letter-spacing: 0.06em` |
| 大数字指标 | DM Mono，`font-variant-numeric: tabular-nums`，`letter-spacing: -0.01em` |
| 基础字号 | 15px / 行高 1.6 |

Google Fonts 引入位置：`app/layout.tsx`
```html
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;...&family=DM+Mono:wght@400;500&family=Cinzel:wght@400;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet" />
```

### 色彩 Token（`app/globals.css` + `app/legacy-user.css`）

| Token | 值 | 含义 |
|-------|----|------|
| `--accent` | `#c97a4e` | 品牌烤赤陶橙 |
| `--accent-dark` | `#a85e35` | 深橙，hover 状态 |
| `--accent-light` | `#f5e6d8` | 浅橙背景 |
| `--ink` | `#2d1a10` | 主文字色（深棕墨） |
| `--ink-62` | `rgba(45,26,16,0.62)` | 次要文字 |
| `--card-bg` | `rgba(255,255,255,0.82)` | 卡片半透明背景 |
| `--border` | `rgba(185,120,80,0.14)` | 边框 |

Tailwind color alias：`orchid-500`（= `--accent`）、`plum`（= `--ink`）、`mist`（= `--ink-62`）

### 背景

```css
background: linear-gradient(128deg, #F7E8E2 0%, #FAF0EA 30%, #FCF5EF 65%, #FDFAF7 100%) fixed;
```
斜向奶油暖粉渐变，`fixed` 不随内容滚动，与运营端一致。

### 阴影 Token

| Class | 值 |
|-------|----|
| `shadow-soft` | `0 20px 60px rgba(180,100,50,0.14)` |
| `shadow-soft-md` | `0 8px 32px rgba(180,100,50,0.12)` |
| `shadow-soft-sm` | `0 2px 12px rgba(180,100,50,0.08)` |

### 精准试戴步骤动效（`app/globals.css`）

| Class / Keyframe | 说明 |
|-----------------|------|
| `.precise-panel-active` | 当前步骤面板：`panel-pop-in` 弹入 |
| `.precise-panel-inactive` | 非当前步骤：透明度 0.38 + 轻微缩小，保留色彩 |
| `.cta-breathe` | 主操作按钮呼吸脉冲（2.2s loop） |
| `.stroke-draw` | SVG 描边绘制动画（步骤完成打勾） |
| `.step-line-done` | 步骤连接线从左填充 |
| `.hint-in` | 提示栏从上滑入 |

### 精准试戴四步流程（`features/try-on/PreciseTryOnPage.tsx`）

```
Step 1 — 款式图：上传款式图 → AI 切割 → 确认 N 个框·生成款式池  （左面板高亮）
Step 2 — 手图：  上传/选手图 → 调整裁图框 → 确认裁图           （中心面板高亮）
Step 3 — 分配款式：拖拽/点击把款式分配给每根手指               （右面板高亮）
             可选：本甲（甲型不变）/ 延长甲（延长甲长）
Step 4 — 生成试戴：点「开始生成」→ AI 生成 1024×1536 试戴图   （全面板高亮）
```

每步骤切换时，提示栏（hint bar）自动重新触发 `hint-in` 动画。

---

## 附：当前 API Key

```
sk-11A20IIdQETwqD7M44BdB8F2Ea9a4f78B2B309947c6e8650
```

> ⚠️ 生产环境通过 `.env.local` 的 `OPENAI_API_KEY` 注入，不要提交到代码仓库。
