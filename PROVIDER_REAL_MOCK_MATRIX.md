# Provider REAL / MOCK / BLOCKED 矩阵 — VFIB Marketing OS V0.1.2

> 原则（执行包 06/07）：**不得将代码结构存在、fixture、模拟账或自述结果当成真实 Provider PASS**。
> 每项能力如实标注 REAL / MOCK / BLOCKED；缺凭据一律 BLOCKED，不以 Mock 冒充真实。

## 1. 研究域能力（V0.1.2 Phase B 新增）

| 能力 | 状态 | 依据 | 证据 |
| --- | --- | --- | --- |
| 每日情报汇编 TRUSTED_DAILY | **REAL（受限）** | 从**真实采集**的 `source_items`（出站主机白名单 `mos.egress.allowedHosts` + SSRF 判定 + 降级如实记录）汇编；空库 → 如实空报告，不编造 | `TEST_EVIDENCE_MOS_V012_RESEARCH/`（RD 系列：真实 HTTP 创建采集源 → ingest → 汇编 REAL 报告） |
| SourceEvidence 证据链 | **REAL** | contentHash 取自真实内容摘要（或 sha256(url\|title) 兜底），逐条可追溯 | 同上（RP/RD 系列 + 审计落盘直读） |
| Web 研究 WEB_RESEARCH | **BLOCKED** | `MOS_WEBSEARCH_PROVIDER` / `MOS_WEBSEARCH_API_KEY` 未配置 → `adapters/websearch.js search()` 返回 `{blocked:true, code:'NOT_CONFIGURED'}`；报告整体 BLOCKED，**零伪造发现**；接入点 `PROVIDER_NOT_IMPLEMENTED` 预留 | research 套件 WB-01~03（BLOCKED 如实落库） |
| SSRF 出站防护 | **REAL** | `assertSafeUrl()`：仅 https、拒私网/环回/保留 IP 段、拒内网主机名、仅 443 端口；7 项字面负例全过 | research 套件 SS 系列 |

## 2. 既有 Provider 能力（继承 V1.2，未变化）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 文本生成 Provider | **BLOCKED** | 无真实 API 凭据（`NOT_CONFIGURED`）；Provider Contract 套件 21 项负例全过 |
| 图像生成 Provider | **BLOCKED** | 同上 |
| Provider 集成账户/撤销 | **REAL（协议层）** | 契约符合性已验证（真实 HTTP 负例），真实调用待凭据 |
| 企业资料库适配层 | **NOT_VERIFIED** | 按 Workspace V1.1.7 逐字节实现，**未真实联调**（`LIBRARY_HANDOFF_BUNDLE` 未交付） |
| 采集 ingest（RSS/JSON_API） | **REAL（白名单内）** | 真实 HTTP 抓取，主机白名单 + 永久/瞬时失败分级，失败降级如实记录 |

## 3. 门禁与诚实性机制（防止 Mock 冒充真实）

- 发现（Finding）无证据 → **强制 NEEDS_VERIFICATION**（`findingVerification()` fail-closed，不得 VERIFIED）。
- Skill 门禁**失效关闭**（`normalizeIntent()`）；正式输出门禁 `formalguard.js` 为唯一权威判定（V0.1.1 起）。
- Web Research 无凭据整体 BLOCKED 并在报告与 UI 中**如实展示**（情报资讯 → AI 研究页签显示阻断原因）。
- 测试隔离实例从不注入真实凭据；`MOS_DATA_DIR` 隔离强依赖 `getConfig()`（A-09 修复，勿回退）。
