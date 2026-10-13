# AI_PROVIDER_AND_SKILL_REPORT.md —— 真实与模拟严格区分

> 对应 `02_MARKETING_OS_CODEX_TASK.md` **Phase M2** + **Phase M4** 交付项。
> 基线提交 `3c19e79` ｜ 观测时间 **2026-10-13 19:5x（GMT+8）** ｜ 环境：本机隔离实例（非生产）

---

## 1. 结论先行（诚实口径）

| 项 | 结论 |
|---|---|
| 真实文本模型端到端 | ⛔ **BLOCKED** —— **无合法取得的模型凭据**。未发生任何真实调用，**未以 Mock 冒充 REAL** |
| 真实图像模型端到端 | ⛔ **BLOCKED** —— 同上 |
| Provider 契约面（health/status/invoke/timeout/rateLimit/costReceipt/errorCode） | ✅ **已实现并通过 21 断言离线自检** |
| Mock 模式 | 存在，但产物**在文件内容内**嵌 MOCK 标记；**绝不**冒充模型输出 |
| 官方 Brand Skill（Visual Brand Guardian V1.2） | ⛔ **NOT_CONFIGURED** —— 原件未提供，**未批准即不得标 EFFECTIVE** |
| SPECIAL-01 专业字典 | 全部保持 **UNVERIFIED（待核验）** |

## 2. Provider 配置现状（`config.json` 实取）

```
mos.text  = {}          → textProvider  = "none"  → NOT_CONFIGURED
mos.image = {}          → imageProvider = "none"  → NOT_CONFIGURED
```
可选真实供应商：文本 `deepseek`、图像 `openai`（**有服务端密钥才会真实调用**，密钥只在服务端）。

### 2.1 精确到「需要什么才能解除阻断」

| Provider | 解除阻断所需（**非敏感键名**） | 说明 |
|---|---|---|
| 文本（DeepSeek 或等价） | `MOS_TEXT_PROVIDER=deepseek` + `MOS_TEXT_API_KEY`（或 `mos.text.apiKey`） | 需**合法取得且已配置凭据**的账号；供应商 DPA / 数据地域 / 训练使用条款须先确认 |
| 图像（OpenAI 或等价） | `MOS_IMAGE_PROVIDER=openai` + `MOS_IMAGE_API_KEY` | 同上；且**品牌 Skill 必须 APPROVED**，否则正式输出一律阻断 |
| 真实端到端自检开关 | `MOS_PROVIDER_LIVE=1` | 未设置时 `PC-L1/L2/L3` **显式输出 SKIP 并记 BLOCKED**，绝不计入通过数 |

## 3. Provider 契约面测试结果（`provider` 套件，21/21）

| 断言 | 验证内容 |
|---|---|
| PC-01…PC-04 | 未配置/选中供应商但无密钥 → `status`/`health`/`invoke` 一律 `NOT_CONFIGURED`，**零出站**，**不产出任何文字或图像** |
| PC-05 / PC-06 | **密钥不外泄**：序列化结果不含密钥；`hasServerKey` 只报布尔 |
| PC-07 / PC-08 | HTTP 与网络错误归类：`429→RATE_LIMITED`、`5xx→HTTP_ERROR`、`4xx→BAD_REQUEST`；`AbortError→TIMEOUT`（可重试） |
| PC-09 / PC-10 | `parseRateLimit` 只回填供应商真实提供的字段；**无费用回执一律 `amount=null`/`confirmed=false`，不凭空推算** |
| PC-11 | MOCK 文本草稿 `state=MOCK` 且**正文首行**醒目标注「（MOCK · 非模型输出）」 |
| PC-12 | MOCK 图像产出**真实落盘的 SVG**，画面内嵌「MOCK 生成图 · 非真实模型输出」+ 提示词快照；同提示词字节可复现 |
| PC-13 | 数据分级：`RESTRICTED`/内部受限内容**默认拒发外模型**（`BLOCKED`，errorCode 明确） |
| PC-14 | 未知供应商明确报错（`UNKNOWN_MODE`），不静默降级 |
| PC-15…PC-20 | 成功/429/5xx/超时/空响应路径的**诚实映射**（超时硬生效、空响应不伪造成成功） |
| PC-21 | `invoke` 未知 op 明确报错，不做静默降级 |
| **PC-L1 / PC-L2 / PC-L3** | ⛔ **SKIP → BLOCKED**（`MOS_PROVIDER_LIVE` 未设置 / 无 `MOS_REAL_*_API_KEY`）。脚本**显式打印 SKIP 提示**，不计入 21 条通过数 |

## 4. 关键诚实性边界（代码级强制）

1. **未配置即不产出**：`generation-jobs` 在 Provider 未配置时把作业状态置为 `NOT_CONFIGURED` 并返回前端，
   **不产出任何"看起来像 AI 生成"的内容**。
2. **Mock 标记在内容里，不只在 UI 角标**：Mock 产物的**文件内容内部**嵌入 MOCK 标记与提示词快照。
3. **预算闸门先于外部调用**：`budgetCheck()` 在调用 Provider **之前**执行；超限即 `BUDGET_EXCEEDED`，**不发起出站请求**。
4. **AI 外发前先判分级（fail closed）**：`RESTRICTED` 在调用任何 Provider 之前阻断（作业 `BLOCKED`、`providerJobId` 为空）；
   未知分级一律 `400 BAD_DATA_CLASS`，不静默降级。
5. **费用只取回执**：成本只取供应商确认回执，无回执即「缺失」，**不估算、不做汇率换算**（PC-10 + `AN-04`）。
6. **前端不含密钥**：`SEC-07-a` 断言前端 bundle 与 API 响应不含类似密钥的字面量；`SEC-07-b` 断言 `hasServerKey=false` 时不宣称已配置。

## 5. 品牌 Skill（Visual Brand Guardian V1.2）

| 项 | 现状 |
|---|---|
| 官方原件 | ⛔ **未提供**（`docs/MOCK_REAL_MATRIX.md` 项 13；`DV-02` 断言如实声明「本轮未随包提供」） |
| `usability()` 门禁 | `APPROVED` 才 `formalUsable`；`REFERENCE_ONLY` **仅**允许生成显式标注的测试草稿；`MISSING_NOT_APPROVED` 全部阻断 |
| `outputIntent` 门禁 | **失效关闭**：未识别取值一律按未授权阻断，**绝不**静默降级为测试草稿（BUILD-02 修复 A-11，勿回退） |
| 跨品牌套用 | ✅ 已阻断：`E2E03-18 U CARD 未批准 Skill 时正式输出被阻塞（不得套用 VFIB 规则）` |
| 生成任务规则快照 | 历史 `GenerationJob` 锁定规则版本/哈希（本侧已实现）；⚠ **规则版本变更的自动感知依赖 `skill.version.changed` 事件**（本轮已补齐该事件类型，见 `CONTRACT_DIFF.md` D-02）。写入侧 |
| 「文件存在 ≠ 已批准」 | ✅ `DV-01`…`DV-04` 断言：`provisional` 项标签恒为「待核验」，不存在伪造的官方名称 |
| 未经授权不得标 EFFECTIVE | ✅ 无任何"自动置为 EFFECTIVE"的入口；配置覆盖**只改显示名**、不洗成正式 |

### 5.1 解除阻断所需

1. **SPECIAL-01 完整内容字典原件** + 逐条**证据引用**（用于 `POST /api/mos/dictionaries/verify` 登记）。
2. **Visual Brand Guardian Skill V1.2 原件** + 该版本的**批准记录**（由**本人专属授权身份**在资料库侧完成，留可核实审计）。
3. 本侧随后：登记核验 → 逐项从 `UNVERIFIED` 转 `VERIFIED` → Skill 取得 `EFFECTIVE` 后才可用于正式输出。

## 6. 资讯采集与调度（Phase M2 第二段）

| 项 | 结果 | 证据 |
|---|---|---|
| 来源抓取 | **REAL**（真实 HTTP 出站） | `sec` 17 断言 |
| 出站 allowlist + SSRF 防御 | ✅ REAL | `SEC-11 出站拒绝矩阵：回环/私网/元数据/IPv6(含 IPv4-mapped)/非白名单/http/非标准端口 全部拒绝` |
| 逐跳重定向校验 | ✅ REAL | `SEC-13a…13e`（同源放行；非白名单/云元数据/私网/超次数一律拒） |
| DNS 重绑定防护 | ✅ REAL | `SEC-12 连接固定绑定已校验 IP（解析器不再被二次调用）` |
| 压缩炸弹 / 体积上限 | ✅ REAL | `SEC-16a`、`SEC-16b` |
| 注入文本按**数据**处理 | ✅ REAL | `SEC-15a/b/c`（不产生任何指令副作用） |
| 生产模式下测试开关失效 | ✅ REAL | `SEC-11b`、`SEC-11c` |
| 调度**默认关闭** | ✅ REAL | `SCH-API-01`；`scheduler.enabled=false` |
| 重复/失效来源 | ✅ REAL | 时间桶幂等 + 有界失败（`sched` 20 断言） |
| 未核验来源 fail closed | ✅ REAL | `SCH-API-05`、`E2E-01b` |
| **生产自动采集须人工显式开启** | ✅ REAL | `SCH-API-07`（开关双向可用、状态如实回读）；`SCH-API-08` 非法取值 400 |
| **对公网来源的真实抓取回归** | ⛔ **BLOCKED** | 来源**许可（robots/服务条款/授权）未获业务确认**；不得规避网站许可 |

## 7. 汇总表

| 能力 | 状态 | 版本/标识 | 时间 | 证据 |
|---|---|---|---|---|
| 文本 Provider 契约面 | ✅ 已实现 | contract v1；provider `none` | 2026-10-13 | `provider` 21/21 |
| 文本 Provider **真实端到端** | ⛔ **BLOCKED（无凭据）** | — | 2026-10-13 | `PC-L1` SKIP |
| 图像 Provider 契约面 | ✅ 已实现 | 同上 | 2026-10-13 | `provider` 21/21 |
| 图像 Provider **真实端到端** | ⛔ **BLOCKED（无凭据）** | — | 2026-10-13 | `PC-L2` SKIP |
| 品牌 Skill 真实生效版本 | ⛔ **NOT_CONFIGURED** | 无 APPROVED 版本 | 2026-10-13 | `E2E03-18`、`DV-01…04` |
| 资讯采集（真实出站） | ✅ REAL | — | 2026-10-13 | `sec` 17/17 |
| 资讯调度 | ✅ REAL_NOT_VERIFIED（默认关闭） | `enabled=false` | 2026-10-13 | `sched` 20/20 |
| 公网来源真实抓取 | ⛔ **BLOCKED（许可未确认）** | — | 2026-10-13 | — |
