# PHASE C ｜完整双语、图文视频统一制作、真实 Provider 验证与员工端效率回归

- 版本基线：V0.1.2 → 本轮目标 **V0.1.3**（本阶段只改代码，升版在 Phase D 统一执行）
- 执行依据：执行包 `05_I18N_BRAND_SECURITY.md`、`03_ONE_SCREEN_CONTENT_STUDIO.md`、`06_TESTS_AND_ACCEPTANCE.md`
- 对应验收矩阵：**LANG-01 / PROD-01 / PROD-02 / UX-02 / RES-05 / REL-01（部分）**
- 代码状态：本阶段提交见 Phase D 报告；`public/mos/i18n/*` 与 `public/mos/js/i18n.js` 为本阶段核心新增/重写文件

---

## 1. 阶段目标与完成度

| 目标（执行包 05/03） | 结论 | 证据 |
|---|---|---|
| 把「依赖 `public/mos/js/i18n.js` 的全局 DOM 字符串匹配」替换为 **key-based i18n** | PASS | `public/mos/i18n/zh-CN.js` / `en-US.js`（451 键 ×2）+ `i18n.js` 重写；`TestEVIDENCE_MOS_V013_I18N/i18n-check-result.json` |
| 统一**状态/错误码映射** | PASS | 11 个映射函数（`statusLabel/errorLabel/readinessLabel/completionLabel/jobStageLabel/gapLabel/kindLabel/availabilityLabel/deliverableLabel/purposeLabel/visualTypeLabel`）；错误码覆盖率 **91%（88/97）** |
| 覆盖导航/研究/选题/派工/制作/审核/发布页面、空态、toast、表单验证、弹窗、ARIA 与日期 | PASS（见 §2.3 口径说明） | UI 检查 123/123；PHASE C 浏览器证据 23 步 0 控制台错误 |
| **不可翻译节点**：用户输入、已保存正文、AI 原始研究结果、引用原文、URL、银行商标、上传文件名、日志 | PASS | 引擎内置 9 类受保护节点 + 各页 44 处 `data-notranslate`；真实浏览器 LANG-01 12/12 |
| 切换仅影响 UI 资源，**不写业务文本、不丢编辑状态** | PASS | `ui-check.js` LANG-01k（断言切换期间只发生 `PUT /api/mos/auth/preferences`）；LANG-01 真实草稿跨语言保持原样；`app.js` 按 `hasUnsaved()` 决定是否重渲染 |
| 偏好按账户保存且**可覆盖初始浏览器语言** | PASS | `initLocale()`：服务端偏好 > 本地记忆 > `navigator.language` > 组织默认 |
| **品牌减法**：普通员工只看到 品牌/平台/用途/效果预览 | PASS | 配图对话框字段实测为「用途 / 视觉类型 / 画面说明」，模板收进折叠的「高级」；无 `#rrggbb` 色号、无模板编号、无 Prompt/供应商输入项 |
| 图文视频**统一制作**（任务内） | PASS | Phase A 起 `content-editor` 即为「制作工作台」，正文｜图片｜视频｜审核 均在任务内；本阶段补「效果预览」与 Provider 就绪度 |
| 图片/视频**真实 Provider 验证** | 部分：适配器 PASS / 商业供应商 BLOCKED_NOT_CONFIGURED / 视频 AI **NOT_IMPLEMENTED** | Provider 契约自检 26/26；见 §4 |
| 响应式与无障碍 | PASS | 720px 窄屏无横向溢出（`overflowX=0`）、键盘 Tab 连续聚焦 8 个交互元素、ARIA 走 `data-i18n-aria-label` |

---

## 2. 国际化（执行包 05 §国际化）

### 2.1 旧实现的**真实缺陷**（本阶段修正的对象）

V0.1.2 的 `applyDom()` 会遍历 `document.body` 下**所有**文本节点，只要文本与字典条目**精确相等**就替换，
并且完全**没有**任何"不可翻译"保护。经代码审计与真实浏览器复现，该实现存在两类可证缺陷：

1. **误翻译用户内容**：字典含 `草稿 / 完成 / 图片 / 摘要` 等常用词，因此用户草稿正文、AI 研究结论、
   外部来源标题、上传文件名、URL 只要恰好等于这些词，就会在英文界面被改写。
   本阶段以真实浏览器注入样本复现并固化断言（`LANG-01b/c/d/e/f/g`）。
2. **动态文案永远不翻译**：`'共 ' + n + ' 项'`、`'已上传 ' + file.name` 这类**拼接**出来的文案无法被
   文本节点匹配命中，英文界面长期显示中文；且无参数插值能力。

### 2.2 新实现（key-based）

- **语言资源**：`public/mos/i18n/zh-CN.js`、`public/mos/i18n/en-US.js`，**各 451 键**，键一一对应。
  - 结构化域使用命名空间键：`status.* / error.* / readiness.* / completion.* / job.* / gap.* /
    kind.* / availability.* / purpose.* / visualtype.* / deliverable.* / field.* / action.* /
    empty.* / notice.* / studio.* / common.*`；
  - 既有界面文案归入 `ui.*`，键由英文语义生成（可审查、可 diff）。
- **引擎**（`public/mos/js/i18n.js` 重写）：
  - `t(key, params)`：键优先；为兼容历史调用亦接受源语言原文（**精确**反向索引，不做模糊/分词匹配）；
    未登记内容（品牌专名/用户内容/URL/未知码）**原样返回**；
  - `{name}` 命名参数插值（修复上述第 2 类缺陷）；
  - 11 个统一映射函数（状态/错误码/就绪度/完成度/作业阶段/证据缺口/结论类型/网页可读性/交付物/用途/视觉类型）；
  - `bindDom(root)` 取代 `applyDom(root)`（旧名保留为 `@deprecated` 别名，避免破坏既有调用点）；
  - **不可翻译规则**（`NO_I18N_SELECTOR`）：`[data-notranslate]`、`input`、`textarea`、`select`、
    `option`、`pre`、`code`、`script`、`style`、`samp`、`kbd`、`[contenteditable]` —— 逐节点
    `isProtectedNode()` 判定后才替换，且保护**向下继承**；
  - 显式标记：`data-i18n` / `data-i18n-placeholder` / `data-i18n-title` / `data-i18n-aria-label` /
    `data-i18n-params`。
- **单点接入错误码**：`ApiError.message` 改为经 `errorLabel(code, rawMessage)` 求值，
  服务端原文保留在 `rawMessage`（不翻译、供日志与排查）。因此**既有 122 处 `err.message` 调用点无需逐个改造**即可双语。

### 2.3 覆盖率口径（避免夸大）

- 前端含中文的字符串字面量共 **2054** 处（Phase C 之前仅 4 处走 `t()`），**不可能**在一轮内全部逐点改写。
- 本阶段的**准确口径**是：
  1. **引擎层**：所有渲染文案都会经过 key-based `bindDom`，且该层已具备不可翻译保护（这是 LANG-01 的关键）；
  2. **显式键**：新建/重写的关键页面（研究、制作、配图）在渲染期直接调用 `t(key)`；
  3. **结构化域**（状态/错误/就绪度/阶段/缺口/结论/可用性/交付物/用途）**全部**走统一映射，不再各页各写中文；
  4. 剩余历史模板文案仍由引擎兼容层覆盖，但**已受保护规则约束**，不存在旧实现那类误翻译风险。
- 校验工具 `tools/mos-i18n-check.js`（新套件 `i18n`，21 断言）强制：键一一对应、无空值、
  同一中文唯一英文、占位符一致、后端枚举全覆盖、错误码覆盖率 ≥80%、保护规则在引擎中真实存在、
  各页保护标记数量、**前端 i18n API 导入完整性**。

> 该导入完整性断言并非形式检查：**Phase C 首次真实浏览器证据即抓到真实缺陷** ——
> `studio.js` 使用了 `purposeLabel()` 却未导入，`node --check` 无法发现，只有真实浏览器
> 报出 `ReferenceError: purposeLabel is not defined`（见 `UI_EVIDENCE/PHASEC/steps.json` 早前一轮
> 的 `consoleErrors`）。修复后重采证据，控制台错误 **0** 条。该断言已固化，防止回归。

### 2.4 LANG-01 真实浏览器验证（`tools/mos-ui-check.js`，Chrome 真实页面）

12 条断言全部通过（UI 检查总数由 111 提升到 **123/123**）：

| 断言 | 对象 | 结果 |
|---|---|---|
| LANG-01a | 普通 UI 文案 `草稿` → `Draft` | PASS |
| LANG-01b | `data-notranslate` 容器内的用户内容**不被翻译** | PASS（`草稿`） |
| LANG-01c | `data-notranslate` 保护**向下继承子节点** | PASS（`草稿`） |
| LANG-01d | `<pre>` 原文/代码块不被翻译 | PASS（`草稿`） |
| LANG-01e | `<textarea>` 已保存正文不被翻译 | PASS（`草稿`） |
| LANG-01f | `contenteditable` 编辑区不被翻译 | PASS（`草稿`） |
| LANG-01g | `<input>` 值不被改动 | PASS（`草稿`） |
| LANG-01h | 显式键绑定 `data-i18n` 与 `aria-label` 生效 | PASS（`Draft` / `Approved`） |
| LANG-01i | 参数插值 | PASS（`Request failed (code: DEMO_X)`） |
| LANG-01j | `NO_I18N_SELECTOR` 与统一映射 API 齐备 | PASS |
| LANG-01k | **切换语言只发生偏好写入**（`PUT /api/mos/auth/preferences`，无任何业务写请求） | PASS |
| LANG-01l | 探测节点清理并成功切回中文 | PASS |

并已在 `intelligence.js`（26 处）、`studio.js`（10 处）、`reviewkit.js`（3 处）、`content.js`、
`governance.js`、`publishing.js` 对**AI 研究结论 / 来源标题与链接 / 证据 / 未决矛盾 / 候选选题 /
任务标题与上级备注 / 审核意见 / 上传文件名 / 归档文件名**加装标记（共 44 处）。

---

## 3. 员工端体验减法与图文视频统一制作（执行包 03）

### 3.1 品牌减法（真实浏览器实测）

在 `MOS_IMAGE_PROVIDER=mock` 的隔离实例中打开「制作工作台 → 图片 → 生成配图」，实测对话框**可见字段**为：

```
用途 / 视觉类型 / 画面说明 / 模板
```

- 「模板」位于**折叠的** `<details class="adv">`（普通制作默认看不到）；
- 面板内**无** `#rrggbb` 色号、无字体/模板技术编号、无 Prompt、无供应商/密钥等输入项
  （断言 `noColorCode`、`noTechInputs` 均为 `true`）；
- 选择用途/视觉类型时**实时显示「效果预览」**：
  `效果预览：LinkedIn 封面 · 建筑 · 1.91:1 · 1200×627 · 将由系统按品牌规则生成`；
- 弹窗顶部固定显示 **品牌 / 平台**（自动继承），并明确提示"品牌规则由系统自动继承"；
- 「高级（技术参数）」面板改为显示**就绪度 + 模式**（如 `未配置 · none`），仅排障与合规审计使用。

### 3.2 无 AI 也能交付（PROD-01 / 执行包 03 §失败与无AI模式）

- 图片页 `生成配图` 按钮在 `imageProvider=none` 时**禁用并给出原因**，同时**手工上传入口始终可用**；
- 视频交付物在任务内维护「脚本 / 分镜 / 旁白字幕 / 关键帧 / 素材上传 / 成品上传」，**不新增**全 AI 长视频引擎；
- 窄屏 720px 下页头、导航、内容区均可用且无横向溢出（`overflowX=0`）。

---

## 4. 真实 Provider 验证（执行包 06 §真实Provider判定）

判定口径（不得混用）：`REAL` / `CONFIGURED_NOT_TESTED` / `NOT_CONFIGURED` / `NOT_IMPLEMENTED` / `BLOCKED`。

| 能力 | 适配器实现 | 真实授权请求 | 结论 |
|---|---|---|---|
| 文本（写作/优化） | 完成（含 `op:'draft'`、`op:'generate'`） | 本机契约替身（真实 HTTP）已通过；商业供应商无凭据 | 适配器 **PASS**；商业供应商 **BLOCKED_NOT_CONFIGURED** |
| 图像（配图） | 完成（OpenAI 兼容 `/images/generations`） | 本机契约替身（真实 HTTP）已通过：成功/429/5xx/超时/空响应 | 适配器 **PASS**；商业供应商 **BLOCKED_NOT_CONFIGURED** |
| 图像 MOCK | 确定性 SVG，图上标注「非真实模型输出」 | — | **NOT_CONFIGURED**（`simulated:true`，**不计为 REAL**） |
| 视频（AI 成片） | **未实现** | — | **NOT_IMPLEMENTED**，仅提供手工流程能力 |
| 外部搜索 / 网页读取 / 结构化研究 | 完成（Phase B） | 真实 HTTP + 契约替身 | 适配器 **PASS**；商业供应商 **BLOCKED_NOT_CONFIGURED** |

本阶段新增就绪度断言（`tools/mos-provider-contract-test.js`，套件 `provider` **26/26**）：
`PC-06a` 未配置 → NOT_CONFIGURED；`PC-06b` **MOCK 不被标为 REAL**；`PC-06c` 有密钥未联调 → CONFIGURED_NOT_TESTED；
`PC-06d` 视频 → NOT_IMPLEMENTED 且不声明 `AI_RENDER`；`PC-06e` 集成矩阵同时暴露
`imageProvider.readiness` 与 `videoProvider`（**不隐去 BLOCKED/NOT_IMPLEMENTED**）。

> 诚实性红线：**没有任何**商业供应商凭据，因此本阶段**不存在** `PASS_REAL`；全部按
> `BLOCKED_NOT_CONFIGURED` / `NOT_IMPLEMENTED` 如实记录，未把 Mock 或契约替身冒充真实供应商。

---

## 5. 测试与真实浏览器证据

| 套件 | 结果 | 说明 |
|---|---|---|
| `i18n`（新增） | **21/21** | 资源一致性、保护规则、导入完整性、错误码覆盖率 |
| `ui`（真实 Chrome） | **123/123** | 含 LANG-01a…l 12 条 |
| `provider` | **26/26** | 含就绪度 5 条 |
| 全量 `all` | 见 Phase D 最终回归 | 阶段内多次全绿 |
| `MOS_UX_PHASE=C` 浏览器证据 | 23 步 / **0 控制台错误** | `UI_EVIDENCE/PHASEC/`（7 张 Phase C 专项截图 + steps.json，Chrome/155.0.8059.79） |

Phase C 专项截图：`c-01-image-tab`、`c-02-image-dialog`（品牌减法 + 效果预览）、
`c-03-zh-editing`、`c-04-en-editing-kept`（英文界面下草稿原样）、`c-05-back-to-zh`、
`c-06-narrow-720`、`c-07-keyboard-focus`。

关键步骤数据（摘自 `steps.json`，非自述）：

- 配图对话框：`hasUse/hasVis=true`，`preview="效果预览：LinkedIn 封面 · 建筑 · 1.91:1 · 1200×627 · …"`，
  `tplInAdvanced=true`、`advClosed=true`、`noColorCode=true`、`noTechInputs=true` → `ok:true`
- 双语编辑态：草稿 `"草稿 完成 图片 摘要 Draft"` → en-US 下**完全一致**且元素未被重建（`enElementKept:true`）
  → 切回中文仍一致；同时相邻 UI 文案 `正文` → `Copy`（UI 翻译与内容保护**同时成立**）
- 窄屏 720px：`header:true navVisible:true overflowX:0`
- 键盘：Tab 连续聚焦 8 个可交互元素

---

## 6. 本阶段改动清单

新增：
- `public/mos/i18n/zh-CN.js`、`public/mos/i18n/en-US.js`（各 451 键）
- `tools/mos-i18n-check.js`（新套件 `i18n`，21 断言）
- `TEST_EVIDENCE_MOS_V013_I18N/i18n-check-result.json`
- `UI_EVIDENCE/PHASEC/`（7 截图 + steps.json）

重写/修改：
- `public/mos/js/i18n.js`（key-based 引擎 + 统一映射 + 保护规则，`bindDom` 取代全局匹配）
- `public/mos/js/api.js`（`ApiError.message` 经统一错误码映射；保留 `rawMessage`）
- `public/mos/js/app.js`（语言切换按 `hasUnsaved()` 保护编辑状态；提示文案键化）
- `public/mos/js/ui.js`（`statusLabel` 委托 i18n 资源，消除重复中文标签表）
- `public/mos/js/modules/intelligence.js`（本地标签表 → 统一映射；26 处保护标记）
- `public/mos/js/modules/studio.js`（品牌减法配图对话框 + 效果预览 + 就绪度；10 处保护标记）
- `public/mos/js/modules/{content,governance,publishing}.js`、`components/reviewkit.js`（保护标记）
- `lib/mos/adapters/image.js`（`status().readiness` + `videoStatus()`）
- `lib/mos/routes/helpers.js`（集成矩阵新增 `videoProvider`）
- `tools/{mos-ui-check.js, mos-ux-evidence.js, mos-provider-contract-test.js, run-mos-tests.sh}`

---

## 7. 未完成 / 阻断项（不得记为 PASS）

| 项 | 状态 | 说明 |
|---|---|---|
| 图片/文本商业供应商真实联调 | **BLOCKED_NOT_CONFIGURED** | 无任何商业凭据；契约替身已完成，**不等价于**真实供应商验证 |
| 视频 AI 成片 | **NOT_IMPLEMENTED** | 本轮明确不新增全 AI 长视频引擎（执行包 03）；仅手工流程 |
| 历史模板文案的逐点 `t(key)` 改写 | **NOT_TESTED（部分）** | 2050 处中文文案中仅关键页与结构化域改为显式键；其余由受保护引擎层覆盖（口径见 §2.3，未夸大） |
| 真实屏幕阅读器（NVDA/VoiceOver）验收 | **NOT_TESTED** | 已做 ARIA 标记与键盘可达性；未做读屏器人工验收 |
| 浏览器矩阵（Firefox/Safari） | **NOT_TESTED** | 仅 Chrome/155（真实浏览器），Edge 未复测 |
| SPECIAL-01 原件核验、Skill V1.2 真人批准 | **BLOCKED** | 与 Phase B 相同，需外部输入 |

---

## 8. 红线遵守

- 未修改企业资料库（Enterprise Workspace）源码；双系统 API 契约 **1.0 不变**。
- 未重建八大业务中心；未新增 S05/CRM/代理佣金等被禁止能力。
- 未把 Mock / 契约替身 / 未实现能力标为 REAL 或"已完成"。
- 切换语言只写账户偏好，**不写业务文本**；未触碰 `data/`。
- Published Content 归档归属不变；**未部署生产**。
