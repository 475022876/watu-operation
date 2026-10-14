# Phase A — 一站式任务空间与交互减法（VFIB Marketing OS V0.1.2 → V0.1.3）

- 基线：Phase 0（`REPORTS/PHASE0_BASELINE.md`，基线提交 `6df37ba`）
- 本阶段目标（执行包 00 §执行节奏 2）：**先让不依赖 AI 的完整链路可用**——
  员工在一个任务页面内完成「看 Brief → 写正文 → 配图 / 视频脚本分镜 → 提交审核」，
  不再跳出任务；无研究来源的任务可登记业务依据后正常送审。

---

## 1. 交付内容

### 1.1 后端（新增 `lib/mos/routes/studio.js`，注册于 `routes/index.js`）

| 端点 | 作用 | 关键约束 |
| --- | --- | --- |
| `GET /api/mos/tasks/:id/studio` | 一次返回任务空间全部上下文：Brief / **已审研究依据（Topic→Proposal→Report→Findings→Evidence，只引用不复制）** / 业务依据 / 版本 / 配图 / 视频 / 交付物清单 / 下一步建议 | 技术参数（Provider/Skill）收纳进 `advanced`，不进员工首屏 |
| `GET /api/mos/tasks/:id/submit-check` | **服务端**计算提交前检查：来源 / 正文 / 平台必需交付物 / 品牌许可 / 待核实 / 风险级别，返回 `items[]` 与 `blocking[]` | 必需项 FAIL 时前端阻断提交并给出修复入口 |
| `POST /api/mos/tasks/:id/variant` | 由同一任务一键创建**其他平台的独立任务**（继承 Brief/栏目/叙事/风险/研究与来源） | `idempotencyKey` 幂等（重放零新增）；无研究且无依据 → 409 `NO_RESEARCH_BASIS`；**不自动批准** |
| `POST /api/mos/tasks/:id/basis` | 无研究任务登记业务依据（`OFFICIAL_NOTICE` / `INTERNAL_APPROVED_FACT` / `AD_HOC`） | `requiresReview:true` 恒定——登记**不豁免**审核 |
| `POST /api/mos/tasks/:id/notes` | 上级备注（任务内直接可见，员工不再去审核模块找意见） | 审计 `content_task.note_added` |

权限：全部端点先 `rbac.assertBrand`（品牌范围，越权 404 防枚举）再 `assertCan`（默认拒绝 + 越权审计）。

### 1.2 前端（新增 `public/mos/js/modules/studio.js`，模块 id `content-editor` **保持不变**）

```
┌ 顶部固定：任务选择 · 状态 · 平台 · 截止 · 保存状态 · [高级] ┐
├ 左栏（可折叠）  │ 中栏：正文｜图片｜视频｜审核（任务内切换）│ 右栏 │
│ 任务要求        │  正文：版本列表 + 编辑器 + AI 草稿       │ 下一步│
│ 研究依据(只读)  │  图片：生成(无模型禁用) / 手工上传        │ 交付物│
│ 上级备注        │  视频：脚本骨架/分镜增删/关键帧/成片上传  │ 清单  │
└────────────────┴─────────────────────────────────────┴──────┘
```

- **四个页签全部在任务内渲染**（`data-ts`），不再跳转 `visual-studio` / `my-reviews`；
  这两个旧模块保留为高级独立入口（模块 id 未变）。
- 自动选中最新版本 → 进入任务即可编辑（无需先点版本）。
- 「开始制作」是空态唯一主按钮；AI 按钮（生成初稿/生成配图）在模型未配置时**禁用并说明**，
  手工路径（写正文 / 上传图片 / 上传成片）始终可用。
- 提交审核弹窗展示服务端检查清单；必需项缺失时给出「登记业务依据 / 查看研究依据」修复入口。

### 1.3 文案与命名

- 导航「内容编辑器」→「**制作工作台**」（模块 id `content-editor` 不变，深链接 `#/content-editor?task=<id>` 兼容）；
  `i18n.js` 补充对应 en-US 键；`tools/mos-ui-check.js` 期望页头同步。

---

## 2. 测试与证据

### 2.1 自动化

| 套件 | 结果 | 说明 |
| --- | --- | --- |
| `bash tools/run-mos-tests.sh studio`（**新增** `tools/mos-e2e-v013-studio.js`） | **29/29** | 聚合 / 检查阻断与解除 / 依据不豁免审核 / 变体幂等与 RBAC / 备注 |
| `bash tools/run-mos-tests.sh ui` | **111/111**（基线 110 + 1） | 真实 Chrome：新建草稿 → 写正文 → 保存 → 刷新仍在 → **先登记业务依据** → 提交审核冻结只读 |
| 证据目录 | `TEST_EVIDENCE_MOS_V013_STUDIO/` | `studio-result.json` |

新套件覆盖的关键负例：跨品牌读 studio 404（防枚举同形）、跨品牌变体 404、P3（无 `content.edit`）403、
非法平台 400、缺幂等键 400、空备注 400、非法依据类型 400、幂等重放 `deduplicated:true` 零新增。

### 2.2 真实浏览器证据（`UI_EVIDENCE/PHASEA/`，Chrome/155.0.8059.79）

| 指标 | Phase 0 基线 | Phase A 实测 | 目标 |
| --- | --- | --- | --- |
| 任务内切「视频」是否跳出任务 | 跳出 | **不跳出**（面板内渲染 `#tvSave`） | 不跳出 ✅ |
| 任务内切「图片」是否跳出任务 | 跳出 | **不跳出** | 不跳出 ✅ |
| 任务内切「审核」是否跳出任务 | 跳出 | **不跳出**（含提交按钮与检查清单） | 不跳出 ✅ |
| P2 落地页 → 正文可编辑 | 1 点击但不可编辑 | **2 个主要动作**（导航 + 开始制作确认；已有版本时 1 个） | ≤2 ✅ |
| 控制台错误 | 0 | **0** | 0 ✅ |

台账：`UI_EVIDENCE/PHASEA/steps.json`（18 步，`jumpOutTabs: 0`）；截图 20 张（含 `p2-04-tab-video/image/review.png`）。

---

## 3. 已知边界（如实）

- 「审核」页签内的**审核裁决**仍在「我的审核」模块完成（职责分离：审核人是另一角色）；
  任务内提供进度只读视图与跳转入口。裁决体验统一放入 Phase C 的 reviewkit 复用。
- 图片/视频 AI 生成本轮仍取决于 Provider 配置（`imageProvider:none` 时按钮禁用）——
  Phase C 完成真实 Provider 接入与验收。
- 平台变体的**发布排期**不在本阶段（属 Phase C 发布衔接）。

---

## 4. Phase A 结论

一站式任务空间已落地并**通过真实浏览器验证**：员工不再跨模块跳转，无 AI 也能完成
「写正文 → 配图/视频脚本分镜 → 提交审核」全链路。自动化 29/29 + ui 111/111 全绿。
