# OPEN ITEMS —— 尚未完成事项清单（V0.1 综合整改 Phase 0—4 收口）

- **对应执行包**：`05_TRACEABILITY_AND_OPEN_ITEMS.md` §「待核验：不得自行假定已经通过」
- **原则**：**未完成真实接口对接的功能一律明确标注 MOCK / NOT_CONFIGURED / BLOCKED / NOT_VERIFIED，
  绝不以模拟结果冒充正式功能**。
- 生成时间：2026-10-13。与 `reports/FINAL_AUDIT.md` §7、`reports/PHASE3_INTEGRATIONS.md` §9 同源。

---

## 1. 阻塞项（需外部输入才能推进）

| # | 事项 | 状态 | 阻塞原因 | 解除条件 |
|---|---|---|---|---|
| 1 | **真实文本 Provider** 端到端调用 | **NOT_CONFIGURED / BLOCKED** | 无供应商合同、API Key 与数据使用/保存政策 | 提供凭据后配置 `MOS_TEXT_PROVIDER` / `MOS_TEXT_API_KEY`（网关可换 `MOS_TEXT_BASE_URL`） |
| 2 | **真实图像 Provider** 端到端调用 | **NOT_CONFIGURED / BLOCKED** | 同上 | `MOS_IMAGE_PROVIDER` / `MOS_IMAGE_API_KEY` |
| 3 | **与真实 Enterprise Workspace 联调** | **NOT_VERIFIED** | 无可用服务实例与服务账户密钥；final approver 身份绑定与撤回/版本通知未确认 | 提供服务地址 + 双方公私钥；按 `docs/INTEGRATION_WORKSPACE_CONTRACT.md` 启用 |
| 4 | **SPECIAL-01 V1.1 手册**核验（N/V/M/资产/视频标准命名与指导内容） | **BLOCKED** | 权威原件**未随包提供** | 提供手册 → `POST /api/mos/dictionaries/verify`（须 `sourceVersion` + `evidenceRef`） |
| 5 | **Visual Brand Guardian Skill V1.2** 是否正式入库并获批 | **BLOCKED** | 同上；当前源码明确标记 `REFERENCE_ONLY` | 提供原件与最终批准状态 |
| 6 | **首批资讯采集来源清单**及版权/机器人协议 | **待业务确认** | 白名单当前仅示例；**自动采集 ≠ 获得转载许可** | 业务方批准来源清单与授权说明 |

## 2. 本轮明确不做（NOT_APPLICABLE / 单独立项）

| # | 事项 | 状态 | 说明 |
|---|---|---|---|
| 7 | **多实例**采集部署 | **NOT_APPLICABLE（本轮）** | 单文件 JSON 存储 → **明确只支持单实例**；心跳锁阻止并发采集；多实例属生产化议题 |
| 8 | **生产数据库**路线 | **未纳入本轮** | 维持 JSON 单文件 + schema 可迁移（v1→v2→v3→v4，只增不改） |
| 9 | **生产部署** | **未执行** | 遵循「未经批准，不得直接部署生产环境」 |
| 10 | **浏览器测试环境**（A-04） | **DONE（未 BLOCKED）** | 本机 Chrome 154.0.8037.93 可用，`ui` 套件以 CDP 驱动真实 Chrome，未跳过 |

## 3. MARK 类能力（**未建设**，须专项讨论后再立项）

| MARK | 内容 | 本轮处置 |
|---|---|---|
| MARK-S05 | 获客漏斗 / CAC / 激活消费 / 客户生命周期 / CRM | **未建设**（无菜单、无接口、无实体） |
| MARK-RISK | 独立品牌舆情监测与声誉事件登记 | **未建设** |
| MARK-LEAD | 营销线索移交、状态反馈、业务闭环、代理运营/佣金 | **未建设** |
| MARK-VIDEO | 多轨编辑器、端到端 AI 视频渲染与配音 | **未建设**（Video Workspace 维持轻量，无自动渲染） |
| MARK-AUTOPOST | 未经单独授权的社交平台自动发布 | **未建设**（仅人工发布） |

## 4. 已在代码/文档中如实标注的「非真实」能力

| 能力 | 标注 |
|---|---|
| 身份认证 | `mock`（本地隔离身份，非企业 SSO/OIDC） |
| 知识库检索 | `mock`（沙盒数据，结果标注 MOCK） |
| 企业资料库（沙盒） | `mock`（`MOCK_` 前缀 / `permissionValid:false` / **`AVAILABLE` 结构性不可达**） |
| 文本 / 图像模型 | `none`（默认）→ UI 与 API 均显示 **NOT_CONFIGURED**，**不生成任何内容** |
| 平台指标 API / 归因 | 未接通；Analytics 缺失即 `available:false` + `missing[]`，**不 0 填充、不估算** |
| 专业字典 provisional 项 | **全部待核验**（标签显示「待核验」，**不臆造官方名称**） |

---

> 上表任何一项的解除，均须保留**原始回执/证据**，并把状态改为 `REAL` / `VERIFIED` 时同步更新
> `docs/MOCK_REAL_MATRIX.md` 与 `docs/API_CONTRACT_AND_INTEGRATION_STATUS.md`。
