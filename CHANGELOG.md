# CHANGELOG — VFIB Marketing OS（运营中台）

本文件记录**应用版本**（`package.json` / `lib/mos/config.js` 的 `MOS_VERSION`）的变更。
接口契约版本（当前 **1.0**）与整改执行包编号（V1.2 等）是**另外两条轴线**，不随应用版本变动。

---

## [0.1.6] — 2026-10-20 — Zero-Cost Trial Path（零付费试用路径）

**基线**：`v0.1.5`（发布提交 `1993991`，schema v8）
**目标/实际版本**：`0.1.6`
**schema**：**v8 不变**（未新增集合，零迁移）
**接口契约**：**1.0 不变**（未改共享契约、未改资料库源码）

### 为什么要发这一版

实际推进顺序是「先接上跑通 → 确认效果 → 再付费」，而不是反过来。
上一版只能选 `openai` / `deepseek` / `anthropic` 三个模式，且默认端点全是海外或付费端点：
想先用免费额度验证，得自己拼端点、猜模型名，一步填错就把 Key 发往错误主机。

本版把**国内三家有免费额度的厂商做成一级接入方式**，并把"免费档"作为**元数据**下发到页面，
让"先免费测"变成下拉框里的一个选项，而不是文档里的一段说明。

### A. 文本新增三个 OpenAI 兼容模式（带免费档默认值）

| 接入方式 | 默认端点 | 默认模型 | 免费档 |
| --- | --- | --- | --- |
| `zhipu`（智谱 GLM） | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.7-flash` | GLM-4.7-Flash / GLM-4-Flash 长期免费不限量 |
| `dashscope`（阿里云百炼） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-flash` | 新用户每模型 100 万 tokens / 90 天 |
| `siliconflow`（硅基流动） | `https://api.siliconflow.cn/v1` | `Qwen/Qwen3-8B` | 注册赠券 + 一批 0 元小模型 |

- 三者都是 `Bearer` + `/chat/completions`，**复用同一套适配器**，没有新增调用分支
  （`IMPLEMENTED_MODES` 白名单同步扩充，未知 vendor 仍然出站前拒绝）。
- 端点为空时由 `defaultBaseUrl(mode)` 兜底，用户不填也能发——**但填了就一定用填的**。

### B. 图像新增 `zhipu` 模式（CogView 免费档）

- `CogView-3-Flash` 免费，请求形状与 OpenAI 图像接口一致（`POST /images/generations`，返回 `url`），
  因此与 `openai` 分支共用实现；默认端点/模型按模式回退。
- 返回的图片地址**仍要再过一次 `egress.assertProviderUrl`** 才下载，不是裸取外部 URL。

### C. 免费档信息作为**元数据**下发（不进入调用路径）

- 注册表新增可选字段 `freeTier`；`publicView()` 下发，`effective()` **不返回**
  （`PF-10` 断言）——它只用于展示，不参与调用、不入库、不影响就绪度。
- 页面：下拉项标注「· 有免费额度」，模式说明追加「免费档：…（以厂商控制台为准）」。
- 切换接入方式时就地更新端点/模型占位符与提示，**不整页重渲染**（避免清掉未保存的输入）。

### D. 文档

- 新增 **`docs/FREE_TIER_TESTING.md`**：三条零付费路线、五分钟接入步骤、免费额度够测多少、
  三个必踩的坑（数据分级拦截 / 429 限速 / 模型名错）、何时才必须付费、MOCK 能证明什么。
- `docs/PROVIDER_INTEGRATION_GUIDE.md` 模式表补三新模式与指向。

### E. 测试

- `provideradmin` **60 → 70**，新增 `PF-01…PF-10`（**纯离线、零出站**）：
  模式集合、`freeTier` 下发、默认端点与模型、三家的 `/chat/completions` 拼接与 Bearer、
  尾部多斜杠归一化、图像 CogView 默认值、`freeTier` 不进入 `effective()`。

### F. 诚实边界（不得改写为"已验证可用"）

- **没有任何真实厂商凭据被使用**。本版证明的是「本侧能对着这些端点正确发请求」，
  不证明「该账号能成功调用」；真实账号的第一次调用由用户在页面上点出来。
- 免费额度数值核实于 **2026-10-20**，厂商随时会调；页面与文档均标注"以控制台为准"，
  **产品内不写死额度数字**，避免过期信息被当成承诺。
- **视频没有免费档**：火山方舟按秒计费，建议放到最后。
- **火山方舟「协作奖励计划」与数据策略冲突**：该计划要求授权调用内容用于模型优化，
  与我们的外发分级红线不一致，文档里明确劝阻用内部材料换取免费额度。
- 未部署生产；`joint` / `build06` 仍因资料库 1.1.9 阻塞（非本版引入，已在 `1ed4d28` 复跑确认）。

---

## [0.1.6-hotfix.1] — 2026-10-20 — Workspace Look & Feel（去文档感 UI 优化）

**性质**：纯前端视觉/信息层级优化（`public/mos/app.css` + `workspace.js` 首屏横幅），零后端改动、零 schema/契约变更、零依赖新增。
**动因**：用户反馈"整个系统看起来像文档网站"。

### 根因与处置

| 根因 | 处置 |
| --- | --- |
| 每页标题下挂一段架构说明式长导语（`ph-desc`），观感即文档导语 | CSS 全局单行钳制（`-webkit-line-clamp:1`），悬停展开全文；**一次覆盖全部 10+ 模块，不改任何模块 JS** |
| 顶部集成状态条用紫色警示配色常驻，像工程调试面板 | 降权为中性灰元信息条（11px、灰底灰字），`--ok` 态单独配色 |
| 页面标题弱、层级平 | `h1` 23px/700 + 金色短下划线；面包屑弱化；页头加分隔线 |
| 首屏「我的工作」是四张空说明卡，无工作台感 | 新增 **hero 横幅**：问候 + 日期 + 三个实时数字（我的任务/待我裁决/本周待发布，点击直达）+ 高频入口 |
| 表格白底细线平淡 | 斑马纹 + 悬停金色左指示条 + 表头加重 |
| 语义徽章与说明文字难区分 | `badge-ok/warn/danger/info/demo` 前置状态圆点 |
| 卡片头部无层次 | `card-head` 微渐变底 + `h2` 金色侧条 |
| **真 bug**：`.bar-fill` 引用未定义变量 `--navy-secondary`，Analytics 分布条始终无色 | 修复为 navy 渐变，分布图首次真正可见 |
| 空态过高、图标突兀 | 紧凑化、图标降透明度 |
| 默认滚动条粗大 | 全局细滚动条（WebKit + Firefox） |

### 验证与诚实边界

- `ui` 套件 **135/135** 通过（含页头断言、P2 权限断言、无未捕获异常/无控制台 error）；
  新截图落 `UI_EVIDENCE_MOS_BUILD01/`（03-my-work、12-all-tasks）与 `UI_EVIDENCE_MOS_BUILD03/`（B03-29/31/32）。
- `provider` 26/26、`provideradmin` 70/70（同日文档改动回归，基线未变）。
- 仅视觉与首屏横幅，**未改任何业务口径**：缺失态不填 0、MOCK 标注、排期≠已发布等语义全部保持。

---

## [0.1.5] — 2026-10-20 — Video Provider Reachability（视频供应商可达性修复）

**基线**：`v0.1.4`（发布提交 `15e7e9d`，schema v8）
**目标/实际版本**：`0.1.5`
**schema**：**v8 不变**（未新增集合）
**接口契约**：**1.0 不变**（未改共享契约、未改资料库源码）

### 为什么要发这一版

选型调研时发现一个**上游消失**导致的功能死路：

> OpenAI 于 **2026-09-24** 移除 Videos API 及全部 `sora-2` / `sora-2-pro` 别名与快照，
> **未公布继任模型**（消费端 App 更早在 4 月 26 日关闭）。
> 本系统 `video` 的 `openai` 模式正是按 `/videos → /videos/{id} → /videos/{id}/content`
> 这条路实现的——协议没错，是**对端没了**。

这意味着如果不改，视频能力在可预见的将来**无法接入任何供应商**。
本版把国内可用路线打通，并顺手修掉两个被它暴露出来的真实缺陷。

### A. 新增 `volcengine` 视频模式（火山方舟 Seedance）

- 创建：`POST {base}/contents/generations/tasks`，请求体为
  `{model, content:[{type:'text',text:prompt}], duration, ratio, watermark:false}`
  （与 OpenAI 的 `{model,prompt,seconds}` 形状不同）。
- 查询：`GET {base}/contents/generations/tasks/{id}` → `{status, content:{video_url}}`。
- 下载：**先查状态取 `content.video_url`，再对该地址 GET**——该类供应商**没有二进制端点**，
  只有 24 小时有效的签名 URL。下载仍走 `egress.assertProviderUrl`，未绕过安全校验。
- **未完成拒绝下载**：状态非 `succeeded` 时返回 `NOT_READY`，绝不把状态 JSON 当 MP4 落盘。
- 尺寸翻译：`size` 可填 `16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9` 或像素值
  （`1536x1024 → 16:9`、`720x1280 → 9:16`）；供应商侧只认 ratio 枚举。
- `openai` 模式**保留**：若 OpenAI 后续恢复 Videos API 或推出继任者，无需改代码。

### B. 修掉两个被暴露的真实缺陷

1. **`effective()` 未返回 `createPath` / `statusPath` / `contentPath`**
   → `video.js` 的 `pathOf()` 永远读不到 fallback 之外的值，
   即 **`generic` 模式的自定义路径一直没生效**（页面上填了也没用）。
   已在 `effective()` 返回值中补齐，并沿用 `env > 库 > config.json > 默认` 的同一优先级链。
2. **`video.normalize()` 丢弃 `extra.rawStatus`**
   → 所有把状态放在 `extra` 里的失败分支（`PROVIDER_FAILED` / `NOT_READY` / `BLOCKED`）
   的 `rawStatus` 恒为空，调用方无法区分失败原因。已补 `if (e.rawStatus) r.rawStatus = e.rawStatus;`。

### C. 测试

- `provideradmin` **55 → 60**，新增 `PB-17a…17e`：
  - 创建体为 `content` 数组 + `ratio` 枚举（像素尺寸被翻译、不下放技术参数）；
  - 任务未完成时**拒绝下载**且 `rawStatus=NOT_READY`；
  - `succeeded` 被识别并带回 `content.video_url`；
  - 从 `video_url` 下载落盘且**字节一致**（`MP4-FROM-VIDEO-URL`），下载次数为 1；
  - 竖版 `720x1280` 正确翻译为 `ratio=9:16`。
- 测试仍用**本地契约替身**（真实实现 `/v3/contents/generations/tasks` 协议），只换对端不换本侧代码。

### D. 文档

- 新增 `docs/PROVIDER_SELECTION.md`：四类供应商（文本/图像/视频/检索）的候选、价格、
  **可直接照抄的 mode/baseUrl/model**、月成本测算、合规自查，以及 Sora 停服这一事实。
- `docs/PROVIDER_INTEGRATION_GUIDE.md` §5.4 重写为"两种下载范式"，补火山方舟填法。

### E. 诚实边界

- **没有任何真实供应商凭据被使用**：`volcengine` 模式的验证来自本地协议替身
  （与真实端点的请求/响应形状逐字段对齐），真实账号调用仍为 `NOT_CONFIGURED`。
- OpenAI 侧"已停服"依据其 deprecations 页与多家独立报道；
  **若你手上有仍可用的 Sora 存量额度，请以你控制台的实际可用性为准**，本版不据此阻塞。
- 未部署生产。

---

## [0.1.4] — 2026-10-20 — Real Provider Integration & Runtime Governance（真实接入与运行治理）

**基线**：`1ed4d28`（应用版本 0.1.3，schema v7）
**目标/实际版本**：`0.1.4`
**schema**：**v7 → v8**（仅新增 `provider_calls` 调用账本、`video_render_jobs` AI 成片作业；**只增不改、幂等**，见 `docs/MIGRATION_AND_ROLLBACK.md` §2.1）
**接口契约**：**1.0 不变**（未改共享契约、未改资料库源码）
**发布提交**：见 `docs/RELEASE_REGISTER.md` §1.4 ｜ **发布标签**：`v0.1.4`

> 本版**只做接入与治理**，不新增业务中心、不改任何模块 id、不动 8 大工作中心结构。
> **全部「真实」必须由证据说话**：未配置一律 `NOT_CONFIGURED`，就绪度 `REAL` 只认账本中的真实成功调用。

### A. 配置单一权威（消除"管理页保存 A、调用读 B"的漂移）

- 新增 `lib/mos/provideradmin.js`（约 800 行）：四类供应商（`text` / `image` / `video` / `websearch`）的
  模式注册表、密钥加解密、就绪度判定、预算与数据策略、连通性测试、用量汇总。
  `effective(kind)` 成为**唯一配置来源**，`text` / `image` / `video` / `websearch` 四个适配器与
  `providercontract.providerConfig()` 全部改为经由它读取（env ＞ 管理页加密库 ＞ `config.json` ＞ 默认）。
- `publicView()` **绝不含 `apiKey` 字段**；被环境变量锁定的字段返回 `lockedByEnv`，页面只读。
- **未知供应商不再退化**：`text` 适配器新增 `IMPLEMENTED_MODES` 前置校验，拼错的 vendor 名
  在**出站前**被拒（`PROVIDER_UNKNOWN_MODE`）——旧行为会回落到默认 OpenAI 端点，把密钥发往非预期主机。

### B. 密钥安全（Key 只进不出）

- 新增 `lib/mos/secrets.js`：**AES-256-GCM** 封装 `{v,iv,tag,ct,kf}`；主密钥优先级
  `MOS_SECRET_KEY` ＞ `data/.mos-secret.key`（0600 自动生成）＞ 告警兜底；支持 hex/base64/口令派生。
- **主密钥轮换后旧密文明确报 `SECRET_KEY_MISMATCH`**，不静默失败、不回退到 `config.json` 明文。
- 掩码 `sk-••••••••1a2b`（<12 位全掩码）+ sha256 前 12 位指纹；`redactText()` 在**落库前**统一脱敏。
- 审计只记动作（`apiKey:set`），不记值。

### C. 真实大语言模型（五类产出）

- `lib/mos/adapters/text.js` **全量重写**（约 700 行）：`SUMMARY` 资料总结 / `REPORT` 研究报告 /
  `TOPIC` 选题 / `COPY_EN` 英文文案 / `VIDEO_SCRIPT` 视频脚本，各自独立 system 与输出契约；
  统一**五步出站闸门**（数据分级 → 预算 → 端点 → 有界重试 → 账本）。
- 防注入基线：材料中出现的任何"指令"视为不可信文本，一律不得改变任务目标。
- 支持 OpenAI 与 Anthropic 两种协议形状；`probe()` 走**完整 chat 管线**（maxTokens=16）而非另写一套。
- 保留并修正 `draft()`（制作工作台在用）：真实模式走 `chat()`，Mock 模式明确标注 `mock:true`。

### D. 真实图像与视频

- `lib/mos/adapters/image.js`：完整五步闸门 + 尺寸映射（1:1→`1024x1024`，16:9→`1536x1024`）+
  `b64_json` 与 `url` 两种返回（url 二次下载落盘）。
- 新增 `lib/mos/adapters/video.js`（约 430 行）：**异步三步** `start → check → download`，
  单步操作避免长连接重复计费；成片落 `data/uploads/generated/AI-VIDEO-<brand>-<ts>.mp4`（上限 120MB）。
- 新增路由 `POST /api/mos/video-renders`、`GET /api/mos/video-renders/:id`、`GET /api/mos/video-renders?brand=`；
  未配置时返回 **200 + `ok:false` + `NOT_CONFIGURED`**，**绝不产出占位视频**。

### E. 运行治理六件事

- 新增 `lib/mos/egress.js`：四级数据分类 `PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED`，
  正则识别身份证/银行卡/手机/邮箱/受限标记，**取"声明"与"检测"更严者**；
  `CONFIDENTIAL` 需显式开关，`RESTRICTED` 还需登记审批人；端点校验拒绝非 https（生产）、
  非白名单端口、内网/环回/云元数据（DNS **全量**解析后逐个判定）、URL 内嵌账号口令。
- 新增 `lib/mos/providerlog.js`：调用账本（成功与失败都记），滚动 2000 条；
  `summarize()` 给出 P50/P95、错误率、**只认回执**的费用汇总与 `unknownCount`。
- `providercontract.js` 新增 `withRetry/backoffMs/sleep/usageOf`：仅
  `TIMEOUT/RATE_LIMITED/HTTP_ERROR/NETWORK_ERROR` 可重试，上限 3 次，遵守 `Retry-After`，否则指数退避（400ms 起、封顶 8s）。
- 预算：单次预估 + 当月已发生双阈值（`0` = 不设上限），超限 `PROVIDER_BUDGET_EXCEEDED` 且**零出站**。
- 权限：新增权限点 `settings.manage`（`MOS_ADMIN` 自动涵盖），配置类接口统一校验；调用类仍为 `model.invoke`。

### F. 系统接入管理界面（中英双语）

- 新增模块 `public/mos/js/modules/settings.js` 与路由 `lib/mos/routes/settings.js`（8 个端点）。
- 新增导航组「系统接入」（`aux`，`requireRoles: ['MOS_ADMIN']`），**不进入 8 大业务中心**。
- 四张供应商卡（检索/文本/图像/视频）+ 预算卡 + 数据外发策略卡 + 用量卡；
  密钥框恒 `type=password`、保存后**立即清空**，页面只显示掩码与指纹。
- i18n 新增 **78 键**（`zh-CN` / `en-US` 各一份，一一对应）；修正 `notice.ai_video_unavailable`
  文案由「未实现」改为「未接入」（本版已实现异步真实接入）。

### G. 测试与证据

- 新增套件 **`provideradmin`（55 条）**：A 段 22 条（管理接口/RBAC/密文/锁 env/审计）、
  B 段 21 条（适配器真实调用：五类文本产出逐个验证、图像、视频三步、检索、重试/超时/预算/分级）、
  C 段 12 条（安全基座：掩码、指纹、篡改、轮换、清账本回落）。
  驱动方式是**本地契约替身**（真实协议 `/v1/chat/completions`、`/v1/images/generations`、`/v1/videos`、SearXNG `/search`），
  只换"对端"不换本侧代码。
- `ui` 套件 123 → **135**：新增 `SET-01…SET-12`（管理员可见入口 / P2 不可见且直链 403 /
  密钥框 password 且不回显 / DOM 与接口无明文 / 库文件为密文 / 刷新后仍只有掩码）。
- `unit` 76 条：`U-19*` 的 schema 期望由 7 升 8，新增 `U-19a`（v7→v8 只新增两集合、既有集合零改写、幂等）。
- `run-mos-tests.sh`：`all` 纳入 `provideradmin`（**17 套件**）；汇总口径拆为
  **「本次运行」**（推荐引用）与「证据目录全量（含 joint/build06 历史证据）」两行，避免混读。
- **全量回归：`all` 17 套件 865/865 通过**。

### H. 期间修正的真实缺陷

1. **`research-fetch` 校验路径会连带加载数据库**：`wsConfig()` 聚合了 provideradmin → store，
   导致纯 URL 校验的子进程探针 stdout 被 store 日志污染（`J-01/J-03` 假失败），并以只读方式碰真实 `data/`。
   改为**只读 `config.json`/env 的研究配置**，语义不变；`websearch` 对 provideradmin 亦改为惰性 require。
2. **`updateBudget` 用 `toFixed(4)` 把 `0.000001` 抹成 0**，等于静默取消单次限额 → 改 `toFixed(6)`。
3. **`egress.dataPolicy()` 的 `allowRestricted` 三元两支同值**，覆盖参数被忽略 → 修正为读 `o.*`。
4. **`video.js` 误用 `getConfig().uploadDir`**（不存在）→ 改 `PATHS.uploadDir`。
5. **`settings.js` 误用 `stateBlock`/`confirmDialog` 旧签名** → 按实际签名重写（`(title,message,okText)` / `(kind,{title,desc,actions})`）。

### I. 已知边界（如实记录，不得改写为"已完成"）

- 文本 / 图像 / 视频 / 检索的**真实供应商调用在本仓库内无凭据**：本版交付的是"接入能力 + 治理"，
  各供应商就绪度为 `NOT_CONFIGURED`；填入真实密钥并点「测试连接」成功后才可能变为 `REAL`。
- **双系统联调阻塞（Provider 侧版本已变）**：资料库仓库当前为 **1.1.9**（新增"岗位职责三层映射 G/C/E"），
  而本侧契约按 **1.1.7** 实现；`joint` / `build06` 在 Provider 侧"审批人登记 / 资料夹具批准 / 最终决策票据"
  处返回 403，`joint 54/66`、`build06 43/61`。**已用独立 worktree 在 V0.1.3 基线（`1ed4d28`）复跑，
  失败集合逐条一致** → 属 Provider 侧行为变更导致的阻塞，**非本版引入的回归**；需资料库侧确认后再联调。
- 未部署生产；未启用任何自动出站轮询。

---

## [0.1.3] — 2026-10-14 — Real AI Research & Employee UX Remediation（执行包五阶段）

**基线**：`7001475`（应用版本 0.1.2，schema v7）
**目标/实际版本**：`0.1.3`（执行包 `VFIB_Marketing_OS_V0.1.3_AI_Research_UX_Remediation_Codex`，7 文件 + SHA256_MANIFEST 核验一致）
**schema**：**仍为 v7** —— 本版**零新集合**，只在既有集合上增字段（`research_jobs` 增 `blockedEvent` 等）
**接口契约**：**1.0 不变**
**发布提交**：`b5412cc` ｜ **发布标签**：`v0.1.3`（annotated）｜ **源码包**：`VFIB_MARKETING_OS_V0.1.3_SOURCE.zip`（443 条目，SHA256 `7024229d…`）

### Phase 0 — 源码影响核验与基线（`6df37ba`）

- `reports/PHASE0_BASELINE.md`：逐条核实执行包「现状」描述与源码是否一致，输出差异表；
  导航/路由/权限/研究适配器/任务-审核-发布关系的基线截图与点击路径统计（`UI_EVIDENCE/PHASE0/`）。

### Phase A — 一站式任务空间与交互减法（`31d292a`）

- `content-editor` 由「内容编辑器」升级为**制作工作台**（模块 id 不变 → 深链接与既有测试零破坏）：
  顶部固定任务头（标题/品牌/平台/状态/保存状态/截止）、左栏 Brief+已审研究+上级备注、
  中间「正文｜图片｜视频｜审核」**在任务内**切换、右栏交付物与下一步；不再跳出任务重新选主题。
- 新后端 `lib/mos/routes/studio.js`；新前端 `lib/mos/modules/studio.js`。
- 新套件 `studio`（`tools/mos-e2e-v013-studio.js`）**29/29**；`ui` 套件 110→**111**；
  证据 `UI_EVIDENCE/PHASEA/`（17 截图 + steps.json，18 步）；报告 `reports/PHASE_A_UX.md`。

### Phase B — 真实授权搜索、受限网页读取、证据链与结构化研究作业（`b9edea8`）

- **`lib/mos/adapters/websearch.js` 重写**：供应商注册表（`none/searxng/brave/bing/google/tavily`），
  **不写死供应商**；`providerStatus()` 输出 `readiness`；预算门禁、429/5xx 退避重试、脱敏 trace。
- **`lib/mos/research-fetch.js`（新）**：受限网页读取——复用连接层 SSRF、二进制拒绝、体积/超时上限、
  不可信内容边界包裹（`<<<UNTRUSTED_EXTERNAL_CONTENT …>>>`）。
- **`lib/mos/research-engine.js`（新）**：异步研究作业 `QUEUED→SEARCHING→FETCHING→VERIFYING→ANALYZING→DONE`；
  jobId/进度/**取消**/重试/**幂等（actor+brand+payloadHash，冲突 409）**；`EV-n` 证据句柄解析。
- **诚实性红线（不得回退）**：`RETRIEVAL_ONLY` 与 `AI_RESEARCH_COMPLETE` 同源写入、降级**绝不**冒充完成；
  计费型供应商无预算 → **零出站**；MOCK 通道**拒绝**产出研究结论；FACT 无证据强制降级为 INTERPRETATION。
- 同步 `/api/mos/research/web` 改走同一作业管线，并保留既有 `research.web_blocked` 审计事件。
- 新套件 `research013`（`tools/mos-e2e-v013-research.js`）**79/79**；证据 `TEST_EVIDENCE_MOS_V013_RESEARCH/`、
  `REAL_PROVIDER_EVIDENCE/`；报告 `reports/PHASE_B_REAL_RESEARCH.md`。

### Phase C — key-based 双语、不可翻译保护、品牌减法与 Provider 就绪度（`ab2af8b`）

- **i18n 重写为 key-based**：新增 `public/mos/i18n/zh-CN.js` / `en-US.js`（**各 451 键，一一对应**）；
  `t(key, params)` 支持 `{name}` 插值；11 个统一映射函数（状态/错误码/就绪度/完成度/作业阶段/
  证据缺口/结论类型/网页可读性/交付物/用途/视觉类型）；`bindDom()` 取代全局 DOM 文本匹配。
- **不可翻译节点保护（V0.1.2 完全缺失的真实缺陷）**：`data-notranslate` + `input/textarea/select/option/
  pre/code/script/style/samp/kbd/contenteditable`，逐节点判定且**向下继承**——用户输入、已保存正文、
  AI 原始研究结果、引用原文、URL、上传文件名、日志在英文界面保持原样（真实浏览器 LANG-01a…l **12/12**）。
- `ApiError.message` 经统一错误码映射（服务端原文保留在 `rawMessage`），既有 122 处调用点单点生效；
  `ui.js` 的重复中文状态表改为委托 i18n 资源。
- 语言切换按 `hasUnsaved()` 决定是否重渲染 → **不丢编辑状态**，且只写账户偏好接口。
- **品牌减法**：配图对话框只暴露 品牌/平台/用途/视觉类型/画面说明 + **实时效果预览**；
  模板收进折叠「高级」，无 `#rrggbb` 色号、无 Prompt/供应商输入项。
- **Provider 就绪度**：`image.status().readiness`（MOCK **不计为 REAL**）+ 新 `videoStatus()` =
  `NOT_IMPLEMENTED`（本轮**不做** AI 成片）；集成矩阵新增 `videoProvider`。
- 新套件 `i18n`（`tools/mos-i18n-check.js`）**21/21**；`ui` 111→**123**；`provider` 新增 PC-06a…e。
- 证据 `UI_EVIDENCE/PHASEC/`（24 图 / 23 步、0 控制台错误）；报告 `reports/PHASE_C_CONTENT_I18N.md`。
- 本阶段首次真实浏览器证据即抓到真实缺陷：`studio.js` 使用 `purposeLabel()` 却未导入
  （`node --check` 无法发现，仅浏览器报 `ReferenceError`），修复后固化为 `I18N-16` 断言。

### Phase D — 全量回归、迁移/安全/回滚与 0.1.3 版本登记（本提交）

- 应用版本统一升级 **0.1.3**：`package.json`、`lib/mos/config.js`（`MOS_VERSION`）、`lib/config.js`
  （`appVersion`）、`public/mos.html`（侧栏显示）、`/api/mos/meta`、测试元数据。
  新增 `VER-01/VER-02` 断言强制五处版本一致（禁止"只改包名"或"改了包名不改显示"）。
- **零迁移**：schema 仍 v7（`docs/MIGRATION_AND_ROLLBACK.md` 结论：**0.1.3 无需数据迁移**）。
- **`joint` 4 项失败断言逐一处置（无跳过、无隐瞒）**：
  - `D4-15`/`D4-15b`：原断言从 `/api/mos/integration/workspace` 读枚举明细，但该端点只暴露
    sha256 + 端点摘要 → 改为读权威端点 `/api/mos/integration/contract`，并交叉校验两端点 sha256 一致。
  - `D4-26`：**测试夹具缺陷**（漏了 Provider 必填的 `reuseScope`/`externalAiTransferPolicy`）导致
    预检 FAIL → 送审 409 → 用例**到不了目标代码路径**的假失败；补齐夹具并新增 **`D4-26a` 夹具完整性守卫**。
  - `D4-44`：遗留硬编码 `schemaVersion===5`（v5 是 BUILD-04 时代基线）→ 改为「不低于集成态基线 v5
    且 接口值 = 模块常量」，避免每次升版假失败。
  - 复跑：**`joint 66/66`**。
- **修复两处证据链缺陷**（本版真实缺陷）：① `studio` 证据文件名与汇总器不一致 → **29 条断言被静默漏统计**
  （全量 895 → **924**）；② `summary.json` 头部元数据仍写 0.1.1 → 已改 0.1.3。
- **0.1.2 登记行证据勘误**：其 `joint 64/64` 引用的是**更早一版脚本产出的陈旧证据**（明细串不同且缺
  `D4-15b`），已在 `docs/RELEASE_REGISTER.md` 如实回填，**未删改历史证据文件**。
- 最终口径：`all` **16 套件 797/797** ｜ `joint` **66/66** ｜ `build06` **61/61** ｜ 汇总 **924/924（18 套件）**。
- 交付 `reports/FINAL_ACCEPTANCE_V0.1.3.md`、`reports/OPEN_ITEMS_V0.1.3.md`（**BLOCKED 一律不记 PASS**；
  终裁 **CONDITIONAL**，**不部署生产**，无任何 `PASS_REAL`）。


**基线**：`2fe3841`（应用版本 0.1.1，schema v5）
**目标/实际版本**：`0.1.2`（执行包 `VFIB_Marketing_OS_V0.1.2_AI_Intelligence_Task_Driven_UX_Codex_Pack`，8 文件 SHA256 核验一致）
**schema**：v5 → **v7**（只增不改、幂等迁移）

### Phase 0 — 基线与影响分析（`ee6383d`）

- `PHASE0_BASELINE_AND_IMPACT.md`：导航映射（旧 8 中心→新 5+2，**模块 id 全部不变**→深链接零破坏）、
  ~100 API 端点盘点、迁移策略、6 条红线、BLOCKED 边界（LLM 无凭据 / Web Search 未接凭据 /
  SPECIAL-01 原件未随包 / Skill 待真人审批）。

### Phase A — 任务驱动 UX 与中英双语（`9fca396`）

- **导航重构**：5 主（工作台/策划与情报/内容制作/发布管理/运营分析）+ 2 辅（品牌与素材/审批与管理，按角色可见）；
  20 个模块 id 不变。
- **i18n**：`public/mos/js/i18n.js`——中文为源语言，en-US 精确字典；`t()/applyDom()` + MutationObserver
  异步翻译；语言偏好**服务端持久化**（`PUT /api/mos/auth/preferences`，白名单 zh-CN/en-US）。
- **员工任务工作台**：`my-work` 扩展 `dueThisWeek`/`continueTask`；
  `PUT /api/mos/my-work/continue {taskId}` 服务端继续锚点（越权 403+审计）；`#/content-editor?task=<id>` 深链接。
- schema v6：`users[].prefs = {locale, lastTaskId}`。
- ui 套件 106→**110**（7 项导航断言 + 4 项双语断言）。

### Phase B — AI 情报研究与候选选题（`3a372e3`）

- schema v7：新增 `research_reports` / `research_findings` / `source_evidence` / `topic_proposals` / `research_jobs`。
- **`lib/mos/adapters/websearch.js`（新）**：无凭据一律 `{blocked:true, code:'NOT_CONFIGURED'}`——
  **零伪造发现**；`assertSafeUrl()` SSRF 字面校验（仅 https / 拒私网环回保留段 / 拒内网主机名 / 仅 443）。
- **TRUSTED_DAILY 每日汇编**：从**真实采集** `source_items` 汇编（白名单出站），生成 SourceEvidence
  （contentHash 可追溯）+ FACT 发现（UNVERIFIED 起步）；空库如实空报告。
- **Proposal 状态机**：`AI_RECOMMENDED→PENDING_EDITORIAL_REVIEW→APPROVED/REVISION_REQUESTED/ON_HOLD/REJECTED`；
  新权限 `research.create`（P1/P2/P4）、`editorial.approve`（仅 P1）；P1 一屏审核（6 字段可改，
  editDiff 落审计）；**发现无证据强制 NEEDS_VERIFICATION（fail-closed）**；
  SPECIAL-01 适配：C06 缺公告授权 / C01、C03 缺正式依据 → 待核验且**批准不洗白**。
- 前端情报资讯新增「AI 研究」「选题建议」页签（BLOCKED 如实展示 / 报告证据抽屉 / P1 审核弹窗）。
- 新套件 `research`（tools/mos-e2e-v012-research.js）**55/55**。

### Phase C — 编辑域派工与制作空间（`035e959`）

- **批准入池** `POST /api/mos/topic-proposals/:id/approve-to-pool`：正式 Master Topic
  （`APPROVED_UNSCHEDULED`，与既有四态并存）+ 证据如实链接（不可回溯的发现计入 skipped，不伪造）。
- **批准并安排** `POST /api/mos/topic-proposals/:id/approve-and-schedule`：**幂等 Saga**——
  fail-fast 全量校验（平台/负责人/日期）→ 内存原子变更 → **单次落盘**（绝不出现「审批成功但派工缺半」）；
  `idempotencyKey` 全局唯一（重放返回快照，零新增）；自动创建月度计划（`autoBySaga` 审计）；
  每平台独立 ContentTask + PlanItem。
- **同源视图** `GET /api/mos/editorial/views?view=day|week|month`：同一 PlanItem/Task 数据源过滤聚合，
  不存在第二套计划；`/api/mos/calendar` 新增 `day` 视图。
- Topic 状态机新增 `APPROVED_UNSCHEDULED→PLANNED→ASSIGNED`。
- 前端：提案抽屉三固定操作；内容编辑器四标签工作空间条（Brief/Content/Visuals/Review）。
- 新套件 `editorial`（tools/mos-e2e-v012-editorial.js）**43/43**。

### 全量回归

- **773/773**（13 套件：smoke unit sec sched provider workspace dual e2e e2e02 e2e03 ui research editorial），升版后复跑全绿。
- 交付文档：`PHASE0_BASELINE_AND_IMPACT.md`、`PHASE_A_UI_AND_I18N_REPORT.md`、
  `PHASE_B_AI_INTELLIGENCE_REPORT.md`、`PHASE_C_TASK_WORKFLOW_REPORT.md`、
  `SPECIAL01_SOURCE_MAPPING.md`、`PROVIDER_REAL_MOCK_MATRIX.md`、`SECURITY_REGRESSION_REPORT.md`、
  `E2E_RUN_LOG.md`、`MIGRATION_AND_ROLLBACK.md`、`FINAL_ACCEPTANCE_V0.1.2.md`、`UI_SCREENSHOTS/`。

### 边界与红线（未变）

- 未改企业资料库源码；共享契约 1.0 未动；未建平行账本；四类审批分离；
  S05/声誉专项/线索闭环/U CARD 代理后台**不建设**；**未部署生产**。
- Web Research / 文本·图像 Provider 无凭据 → BLOCKED，不以 Mock 冒充真实；
  41 项 provisional 字典项待 SPECIAL-01 原件核验。

---

## [0.1.1] — 2026-10-13 — V1.2 整改（真实 HTTP 安全负例 + 正式输出门禁）

**基线**：`259a91d`（应用版本 0.1.0，schema v5）
**目标/实际版本**：`0.1.1`（本版**确有应用代码变更**，非仅测试变更，故按 V1.2 要求升版）

### 新增（应用代码）

- **`lib/mos/formalguard.js`（新增，约 200 行）** —— 正式输出门禁的**唯一权威判定**。
  实现 V1.2 B1「Revoked / Deprecated / 权限撤销 / Skill 失效**不得继续生成新正式作品**」：
  - `SKILL_NOT_EFFECTIVE`：正式输出必须落在**已批准生效**的品牌 Skill 上；
    `REFERENCE_ONLY` 只允许测试草稿，不得冒充正式依据。
  - `BRIEF_NOT_READY`：关联 Campaign 的 Marketing Brief 存在未核验宣称/引用时不得正式输出。
  - `LIBRARY_REF_NOT_REUSABLE`：引用的资料库资产当前不可复用
    （已撤回 / 已废止 / 权限撤销 / 非 ACTIVE / 权限未核验通过）。
  - `LIBRARY_REF_INVALIDATED`：该引用已被事件消费登记为**本地失效**。
  - `LIBRARY_REF_NOT_FOUND`：引用在本侧未登记（不猜测、不放行）。
  判定复用 `admissionlib.reuseEligibility()` 与 `skill.usability()`，**不重复实现**可复用规则。

- **`POST /api/mos/formal-output-check`（新增端点）** —— 只判定、不产出、不出站、不落盘；
  与生成端点**共用同一份** `formalguard.evaluate()`，避免「门禁放行、生成阻断」不一致。

- **`lib/mos/workspace-client.js`：安全类拒绝的可观测性**
  - 新增 `SECURITY_REJECTION_CODES`（28 项）与 `securityRejections` 计数；
  - `status().securityRejections` 暴露 `total / byCode / last`（进程内；**不含任何凭据材料**）；
  - `callWithTicket()` / `ensureTicket()` / `health()` 全部纳入记录。

### 修改（应用代码）

- **`lib/mos/routes/creative.js`** —— `POST /api/mos/generation-jobs` 在**任何出站与落盘之前**
  执行正式输出门禁：
  - **TEXT 与 IMAGE 一视同仁**。此前只有 IMAGE 走 `skill.buildPrompt()`，
    **TEXT 的 `outputIntent` 从未被校验** —— 正式文字作品可越过 Skill 门禁（真实缺陷）；
  - 阻断返回 `409 FORMAL_OUTPUT_BLOCKED`，并附结构化 `blockers[]`；
  - 未识别/空 `outputIntent` 一律 fail-closed 阻断（与 `skill.normalizeIntent()` 同源）。
- **`lib/mos/skill.js`** —— 导出 `normalizeIntent` / `INTENT_ALIASES`（**单一来源**，
  供门禁复用，杜绝第二处实现产生的不一致）。**行为未变**。
- **`lib/util.js`** —— `sendError()` 结构化详情新增 `blockers[]` / `intent` 白名单透传
  （仅 code/note/refId/libraryId/skillState，长度受限，不含机密）。
- **版本三处同源升级**：`package.json`、`lib/config.js` 的 `appVersion`、
  `lib/mos/config.js` 的 `MOS_VERSION`；UI 侧 `public/mos.html` 与 `public/mos/js/app.js`
  的回退字面量同步。

### 新增（测试与证据）

- **`tools/mos-e2e-build06-dual.js`（新增，约 960 行）** —— 双进程**真实 HTTP** 安全负例：
  - **INT-02**：过期签名（±窗口两侧）、**nonce 原样重放**、**服务账号撤销**（撤销前 200 → 撤销后 401）、
    公钥轮换后旧私钥立即失效、伪造签名对照；
  - **INT-03**：跨品牌（体/票据不一致 → 403 `BRAND_MISMATCH`；票据品牌不在允许清单 → 403 `BRAND_NOT_ALLOWED`;
    同一资产 VFIB 可解析 / UCARD 403 `NOT_REUSABLE_FOR_SUBJECT`;跨品牌检索结果隔离）、
    高密级资料（executive）对非提权主体不可见 + 高管身份可见的**两面向**验证；
  - **服务端审计证据**：直接读取 **Provider 隔离实例自己的 `db.json`**，
    逐条核对 `integration-call` 审计行的 `code` / `status` / `ok=false`；
  - **B1 端到端门禁**：MOS 侧真实准入 → 取得正式 Asset ID → Provider 撤回 →
    事件消费 → 本地引用失效 → **FORMAL 生成被 409 阻断、TEST_DRAFT 不阻断**；
  - **服务账号撤销后的 MOS 侧**：探测**全部失败且无一条 `ok=true`**（不静默成功）。
- **`tools/run-mos-tests.sh`** —— 新增 `build05` 套件入口。

### 未变更（明确保持）

- **接口契约 1.0 未变**：`PROVIDER_API_OPENAPI_BASELINE.yaml` 三方 SHA256 仍为
  `cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3`（逐字节一致）。
- **数据 schema 仍为 v5**：本版**无**新增集合、**无**迁移。
- 八个工作中心、Published Archive 只在中台归档、S05/声誉/线索/自动发布保持 MARK。

---

## [0.1.0] — 2026-10-11 起累计（历史）

- 0.1.0 期间完成 BUILD-01/02/03 与 V0.1 综合整改（Phase 0—4）、
  V1.1 三包整改（B0—B8：资产准入三必填字段、双重身份票据、事件消费、撤回失效、
  正式资产检索、双系统真实 HTTP 联调、归档隔离）。
- schema v2 → v3 → v4 → v5（只增不改、幂等、可回滚）。
- 详细记录：`docs/BUILD-0*_TEST_REPORT.md`、`docs/CURRENT_ARCHITECTURE.md`、
  `MARKETING_HANDOFF_BUNDLE_V1.1/`、`docs/history/JOINT_ACCEPTANCE_REPORT_V1.1.md`。
