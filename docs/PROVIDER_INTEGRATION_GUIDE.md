# 供应商接入与运行治理手册（Provider Integration Guide）

**适用版本**：应用 **0.1.4**（V0.1.4 真实接入改造）｜**接口契约**：1.0（未变）｜**schema**：v8
**本手册回答的四件事**：① 真实网页检索与权威站点全文抓取 ② 真实大语言模型（五类产出）
③ 真实 AI 图像 / 视频生成 ④ API 安全与运行管理（密钥、权限、超时重试、费用、外发、日志）

> **诚实性总则（贯穿全文，不得改写）**
> - **未配置 = `NOT_CONFIGURED`**：系统不会用 Mock、占位图、模板文案或"降级结果"冒充真实产出。
> - **`REAL` 只能由真实成功调用证明**：就绪度为 `REAL` 当且仅当调用账本（`provider_calls`）里
>   存在**同一密钥指纹**的成功记录；清除账本即回落 `CONFIGURED_NOT_TESTED`。
> - **费用只认供应商回执**：`cost.amount` 非空仅当供应商明确返回计价；未回执记入
>   `unknownCount`，**绝不按单价推算**。

---

## 1. 四类供应商与用途

| 类别 (`kind`) | 用途 | 已实现模式 | 是否计费 |
| --- | --- | --- | --- |
| `websearch` | 权威官方信息检索（配合 `research-fetch` 做受限全文抓取） | `none` / `searxng` / `brave` / `bing` / `google` / `tavily` | `searxng` 不计费；其余按次计费 |
| `text` | 研究报告 / 资料总结 / 选题 / 英文文案 / 视频脚本 | `none` / `openai` / `deepseek` / `anthropic` | 按 token 计费 |
| `image` | AI 配图与主视觉 | `none` / `openai` | 按张计费 |
| `video` | AI 成片（异步三步） | `none` / `openai`（Sora，已停服）/ `volcengine`（火山方舟）/ `generic` | 按次/按秒计费 |

### 1.1 五类文本任务（`lib/mos/adapters/text.js` · `TASKS`）

| 任务码 | 名称 | 输入 | 说明 |
| --- | --- | --- | --- |
| `SUMMARY` | 资料总结 | `text` | 先 3 条要点，再 150–200 字概述 |
| `REPORT` | 研究报告 | `topic` + `material` + `lang` | 结构：结论先行 → 事实/解读分离 → 风险与合规提示 |
| `TOPIC` | 选题 | `audience` + `material` | 给出 5 个可执行选题，逐个说明依据与风险 |
| `COPY_EN` | 英文文案 | `brief` + `platform` | 英文原生表达（非直译），含 3 个变体 |
| `VIDEO_SCRIPT` | 视频脚本 | `topic` + `durationSec` | 分镜表：镜号/画面/旁白/字幕/时长 |

调用方式（服务端）：

```js
const text = require('./lib/mos/adapters/text');
const r = await text.runTask({ task: 'REPORT', input: { topic: '…', material: '…' }, brandCode: 'VFIB' });
// r.state: 'SUCCEEDED' | 'MOCK' | 'NOT_CONFIGURED' | 'BLOCKED' | 'FAILED'
```

所有提示词都含**防注入基线**：材料里出现的任何"指令"一律视为不可信文本，不得改变任务目标。

---

## 2. 配置的三条途径与优先级

**优先级（高 → 低）**：`环境变量` ＞ `管理页（加密落库 settings.providers[kind]）` ＞ `config.json` ＞ `内置默认`

- 被环境变量锁定的字段在页面上**只读**，并标注 `lockedByEnv`（避免"页面改了但不生效"的误解）。
- 管理页改动即时生效（无需重启）：`effective(kind)` 是四个适配器与 `providercontract` 的**唯一配置来源**。

### 2.1 环境变量

| 类别 | 变量 |
| --- | --- |
| 通用 | `MOS_SECRET_KEY`（主密钥，见 §3） |
| 文本 | `MOS_TEXT_PROVIDER` `MOS_TEXT_API_KEY` `MOS_TEXT_BASE_URL` `MOS_TEXT_MODEL` `MOS_TEXT_TIMEOUT_MS` |
| 图像 | `MOS_IMAGE_PROVIDER` `MOS_IMAGE_API_KEY` `MOS_IMAGE_BASE_URL` `MOS_IMAGE_MODEL` `MOS_IMAGE_TIMEOUT_MS` |
| 视频 | `MOS_VIDEO_PROVIDER`（`volcengine` / `openai` / `generic`）`MOS_VIDEO_API_KEY` `MOS_VIDEO_BASE_URL` `MOS_VIDEO_MODEL` `MOS_VIDEO_TIMEOUT_MS` |
| 检索 | `MOS_WEBSEARCH_PROVIDER` `MOS_WEBSEARCH_API_KEY` `MOS_WEBSEARCH_BASE_URL` `MOS_WEBSEARCH_CX` `MOS_WEBSEARCH_MAX_RESULTS` |
| 外发 | `MOS_EGRESS_PROVIDER_HOSTS` `MOS_EGRESS_ALLOW_CONFIDENTIAL` `MOS_EGRESS_ALLOW_RESTRICTED` `MOS_EGRESS_ACK_BY` |

> **测试专用放行**（`MOS_EGRESS_ALLOW_LOOPBACK` / `MOS_EGRESS_ALLOW_HTTP`）只在 `NODE_ENV !== 'production'`
> 且显式置 `1` 时生效；**生产模式下无条件失效**（J-02 断言覆盖）。

---

## 3. 密钥安全（Key 只进不出）

### 3.1 加密方式

- 落库前用 **AES-256-GCM** 封装：`{ v: 1, iv, tag, ct, kf }`，`kf` 是主密钥指纹。
- 主密钥来源优先级：
  1. `MOS_SECRET_KEY` 环境变量（推荐：生产必须用这种方式注入，不入库、不入包）；
  2. `data/.mos-secret.key`（首次启动自动生成，权限 `0600`）；
  3. 兜底派生（会打印告警，**仅限单机试用**）。
- **主密钥轮换后**，旧密文解密会明确返回 `SECRET_KEY_MISMATCH`，页面显示"密钥不可用，请重新录入"，
  **不会**静默失败、更不会退回到 `config.json` 明文。

### 3.2 掩码与指纹

| 场景 | 展示形式 |
| --- | --- |
| ≥12 位密钥 | `sk-••••••••1a2b`（前 3 + 8 圆点 + 后 4） |
| <12 位密钥 | `••••••••`（全掩码） |
| 指纹 | `sha256(密钥)` 前 12 位，用于判断"是不是同一把钥匙"（不泄露密钥） |

- **接口与页面永不返回明文**：`publicView()` 不含 `apiKey` 字段；密钥输入框恒为 `type=password` 且
  保存后**立即清空**（UI 断言 `SET-03/04/05/06/07`）。
- 审计只记**动作**（`changes: ['apiKey:set']`），不记值。

### 3.3 生产要求

```bash
# 生产必须显式注入（32 字节，hex 64 位或 base64）：
export MOS_SECRET_KEY="$(openssl rand -hex 32)"
export NODE_ENV=production
```

> 丢失主密钥 = 所有已存密钥都不可解（只能重新录入）。请与数据备份同等级别保管。

---

## 4. 操作步骤（管理页）

入口：侧边导航 **系统接入**（仅 `MOS_ADMIN` 可见）

1. 选择**模式**（如「OpenAI 兼容」/「Brave Search API」）。选 `未接入` 即彻底关闭该类调用。
2. 填**端点**（必须 `https://`；非 443 端口需在 `MOS_EGRESS_ALLOWED_PORTS` 放行）、**模型名**。
3. 填**超时**（默认 30s，范围 1s–120s）与**重试次数**（默认 1，上限 3）。
4. 粘贴**密钥** → 保存（页面会显示掩码 + 指纹 + 保存人/时间）。
5. 点「测试连接」：发一次**最小真实请求**（文本 16 token；图像 1 张；检索 1 次）。
   - 成功 → 账本记账，就绪度升到 `REAL`；
   - 失败 → 返回错误码与原因（见 §7），就绪度保持 `CONFIGURED_NOT_TESTED`。

### 4.1 就绪度五档（不新增档位）

| 值 | 含义 |
| --- | --- |
| `REAL` | 配置完整 **且** 账本中存在同一指纹的成功调用（只能用证据说话） |
| `CONFIGURED_NOT_TESTED` | 配置完整但**没有**成功调用记录 |
| `NOT_CONFIGURED` | 未选择供应商或缺少必填项 |
| `NOT_IMPLEMENTED` | 该模式尚无可执行实现（不会出站） |
| `BLOCKED` | 被治理策略阻断（分级/预算/端点/权限），附带原因 |

---

## 5. 各供应商要点与限额建议

### 5.1 网页检索

| 供应商 | 密钥获取 | 建议 `maxResults` | 备注 |
| --- | --- | --- | --- |
| `searxng`（自建） | 无密钥 | 10 | 需在实例开启 `search.formats: [json]`；不计费，适合内网/离线 |
| `brave` | api-dashboard.search.brave.com | 10–20 | 有免费额度，超出按次计费 |
| `bing` | Azure Portal（Bing Search v7） | 10 | 需 `Ocp-Apim-Subscription-Key` |
| `google` | Google Cloud → Custom Search API + `cx` | 10 | **必须在页面填 `cx`**（搜索引擎 ID），否则报 `BAD_REQUEST` |
| `tavily` | tavily.com | 5–10 | 面向 Agent 的检索 API |

全文抓取由 `lib/mos/research-fetch.js` 负责（与检索供应商解耦）：只允许文本类 Content-Type、
体积/超时上限、逐跳 SSRF 复查、不可信内容边界包裹。抓取白名单在 `config.json` 的
`websearch.research.allowedHosts`（**不在管理页**，属于部署级策略）。

### 5.2 文本模型

| 模式 | 端点（默认） | 建议模型 | 参考单价（USD / 百万 token） |
| --- | --- | --- | --- |
| `openai` | `https://api.openai.com` | `gpt-4o-mini`（日常）/ `gpt-4o`（报告） | 输入 0.15 / 输出 0.60（mini 量级，**以账单为准**） |
| `deepseek` | `https://api.deepseek.com` | `deepseek-chat` | 输入约 0.27 / 输出约 1.10 |
| `anthropic` | `https://api.anthropic.com` | `claude-3-5-sonnet-latest` | 输入 3 / 输出 15（Sonnet 量级） |

> 页面上的单价**只用于事前估算**（预算拦截），不参与记账。记账只认回执。

**限额建议**：研究报告类单篇上限 `$0.10`，月度 `$50`（按团队规模调整）；
单价按当前合同填，不确定就填 0（= 不做金额拦截，但记账仍只认回执）。

### 5.3 图像

| 模式 | 端点 | 模型 | 尺寸映射 |
| --- | --- | --- | --- |
| `openai` | `https://api.openai.com` | `gpt-image-1` / `dall-e-3` | 1:1 → `1024x1024`；16:9 → `1536x1024` |

- 支持 `b64_json` 与 `url` 两种返回（url 会二次下载并落盘到 `data/uploads/generated/`）。
- 生成结果**必须**经 Skill 门禁（`formalguard`）才能作为正式作品；测试草稿单独标记。

### 5.4 视频（异步三步，避免长连接重复计费）

```
POST /api/mos/video-renders        → 创建（start：POST {baseUrl}/v1/videos）
GET  /api/mos/video-renders/:id    → 查询 + 自动 check/download
```

单步语义：
1. `start`：提交任务，立即返回 `providerJobId`（**不等待**完成）；
2. `check`：查状态（`queued|running|succeeded|failed|expired`）；
3. `download`：取 MP4（上限 120MB），落盘
   `data/uploads/generated/AI-VIDEO-<brand>-<ts>.mp4`。

**两种下载范式（0.1.5 起）**

| 模式 | 下载方式 | 现状 |
| --- | --- | --- |
| `openai` | `GET /videos/{id}/content` 直接返回二进制 | ⚠ **死路**：OpenAI 已于 2026-09-24 移除 Videos API 及全部 sora-2 别名，无继任 |
| `volcengine` | 先查状态取 `content.video_url`，再 GET 该地址（仍过出站校验） | ✅ 可用；URL 24 小时有效，必须立即下载 |
| `generic` | 按你填的 `contentPath` 取二进制 | 适合自建/私有化服务 |

**火山方舟填法**

| 字段 | 值 |
| --- | --- |
| 供应商 | `volcengine` |
| 端点 | `https://ark.cn-beijing.volces.com/api/v3` |
| 模型 | `doubao-seedance-2-0-mini`（720P ≈0.18 元/秒）/ `doubao-seedance-2-0-fast`（≈0.41）/ `doubao-seedance-2-0`（≈1.5–3.75） |

尺寸填 `16:9` / `9:16` / `1:1` 会原样下发；填像素值（如 `1536x1024`）会被换算成对应 ratio。
**未完成的任务拒绝下载**并返回 `NOT_READY`——不会把状态 JSON 当视频存下来。

未配置时 `POST /api/mos/video-renders` 返回 **HTTP 200 + `ok:false` + `NOT_CONFIGURED`**（不是 5xx），
并**绝不**产出占位视频。

---

## 6. 治理六件事的落点（谁能看见、在哪里生效）

| 要求 | 实现位置 | 行为 |
| --- | --- | --- |
| **密钥安全** | `lib/mos/secrets.js` | AES-256-GCM；掩码 + 指纹；`redactText()` 写日志前统一脱敏 |
| **调用权限** | `lib/mos/rbac.js` + `lib/mos/routes/settings.js` | 配置类接口统一 `settings.manage`（`MOS_ADMIN` 自动涵盖）；调用类 `model.invoke` |
| **超时重试** | `lib/mos/providercontract.js` `withRetry()` | 有界重试：上限 3；仅 `TIMEOUT/RATE_LIMITED/HTTP_ERROR/NETWORK_ERROR` 可重试；遵守 `Retry-After`，否则指数退避（400ms 起，封顶 8s） |
| **费用控制** | `provideradmin.checkBudget()` | 事前拦截（单次预估 + 当月已发生）；`0` = 不设上限；超限 → `PROVIDER_BUDGET_EXCEEDED`，**零出站** |
| **敏感数据外传限制** | `lib/mos/egress.js` | 四级分类 `PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED`；正则识别身份证/银行卡/手机/邮箱/受限标记；取"声明与检测更严者"；`CONFIDENTIAL` 需显式开启，`RESTRICTED` 还需审批人 |
| **日志与错误处理** | `lib/mos/providerlog.js` | 每次调用落账（不含明文/正文）：耗时、重试次数、错误码、tokens、回执金额；滚动保留 2000 条；P50/P95/错误率/费用汇总 |

### 6.1 统一出站闸门（顺序即安全语义）

```
① 数据分级判定 → ② 预算预检 → ③ 端点校验 → ④ 有界重试 → ⑤ 账本记账
```

任一步失败 ⇒ **零出站**（测试用 `calls=0` 证明）。端点校验拒绝：非 https（生产）、非白名单端口、
内网/环回/云元数据地址（DNS **全量**解析后逐个判定）、URL 内嵌账号口令。

---

## 7. 错误码与处置

| 错误码 | 含义 | 处置建议 |
| --- | --- | --- |
| `PROVIDER_NOT_CONFIGURED` | 未配置或缺少必填项 | 到系统接入页补齐模式/端点/密钥 |
| `PROVIDER_UNKNOWN_MODE` | 供应商名不在已实现清单 | 重新选择模式（拼错的 vendor 名**不会**回落到默认端点） |
| `PROVIDER_BLOCKED_DATA_CLASS` | 数据分级不允许外发 | 降级输入，或按流程开启 `CONFIDENTIAL`/`RESTRICTED` 并登记审批人 |
| `PROVIDER_BUDGET_EXCEEDED` | 超出单次/月度上限 | 调整预算或降低单次规模（此时代码**未发出任何请求**） |
| `PROVIDER_TIMEOUT` | 超时（可按策略重试） | 提高超时或换更快的模型；检查网络出口 |
| `PROVIDER_RATE_LIMITED` | 触发限流 | 降低并发；系统会按 `Retry-After` 退避 |
| `PROVIDER_HTTP_ERROR` | 上游 5xx | 重试；持续失败时查看账本 `detail` |
| `PROVIDER_BAD_REQUEST` | 上游 4xx（参数/密钥/权限） | **不要重试**：检查密钥、模型名、`cx`、账户额度 |
| `PROVIDER_NETWORK_ERROR` | DNS/连接失败 | 检查出站白名单、代理、端点域名 |
| `PROVIDER_EMPTY_RESPONSE` | 200 但无可解析内容 | 多为模型拒答或被截断；检查 `max_tokens` |
| `SECRET_KEY_MISMATCH` | 主密钥已更换，旧密文不可解 | 重新录入密钥（旧值无法恢复） |

---

## 8. 自检与证据

```bash
# 单项（推荐先跑，快）
bash tools/run-mos-tests.sh provideradmin     # 52 条：管理接口 + 适配器真实调用 + 分级/预算/重试/账本
bash tools/run-mos-tests.sh provider          # 26 条：契约与就绪度语义
bash tools/run-mos-tests.sh ui                # 真实浏览器（含 SET-01…SET-12）

# 全量
bash tools/run-mos-tests.sh all
```

证据位置：

| 内容 | 路径 |
| --- | --- |
| 供应商管理/适配器调用断言 | `TEST_EVIDENCE_MOS_V014_PROVIDER/provider-admin-result.json` |
| 系统接入页截图 | `UI_EVIDENCE_MOS_BUILD07/SET-*.png` |
| 汇总（扫描全部证据目录） | `TEST_EVIDENCE_MOS_BUILD01/summary.json` |

> `provideradmin` 套件用的是**本地契约替身**：它实现真实协议（`/v1/chat/completions`、`/v1/images/generations`、
> `/v1/videos`、SearXNG `/search`），只更换"对端"，本侧代码路径（出站校验、分级、预算、重试、账本）
> **一行不打折**。因此通过它只能证明"本侧实现正确"，**不能**证明某家供应商的账号可用 ——
> 后者必须由真实密钥的一次成功调用（账本记录）证明。

---

## 9. 常见问题

**Q1：保存了密钥，为什么还是 `CONFIGURED_NOT_TESTED`？**
说明还没有成功调用过。点「测试连接」跑一次真实最小请求，或走一次真实业务调用。

**Q2：页面上的模式/端点改不动？**
该字段被环境变量锁定（页面会显示"由环境变量锁定"），改环境变量或移除后再从页面配置。

**Q3：密钥显示 `••••••••` 但我忘了原值？**
系统无法回读。请重新生成密钥并录入（旧值不可恢复）。

**Q4：预算填 0 是什么意思？**
`0` = 不设上限（仍会记账，但不会事前拦截）。生产建议至少设月度上限。

**Q5：为什么 `RESTRICTED` 数据发不出去？**
默认策略拒绝 `RESTRICTED` 外发（需同时开启开关**并**填写审批人 `acknowledgedBy`）。
这是红线的默认安全姿态，不是缺陷。

**Q6：视频为什么没有"一键出片"？**
异步三步（start/check/download）是刻意设计：长连接会被供应商重复计时并放大失败成本。
页面与接口都会逐次记账，进度可查、可取消。
