# REAL_PROVIDER_EVIDENCE —— 真实调用证据（脱敏）

## 本次证据的**真实边界**（必读，避免误读为"已接入外部供应商"）
- 检索适配器：`lib/mos/adapters/websearch.js`，供应商 `searxng`（**已实现的真实 HTTP 客户端**：
  真实请求、真实 JSON 解析、真实限流/重试/超时/预算门禁、真实脱敏 trace）。
- 模型通道：`lib/mos/adapters/text.js` 的 `generate()`（OpenAI 兼容 `/chat/completions`，真实 HTTP）。
- 对手方：本机 **契约替身**（`tools/mos-e2e-v013-research.js` 内置 HTTP 服务），
  实现 SearXNG JSON 契约与 OpenAI 兼容契约。**它不是任何商业供应商**。
- 因此判定为：**适配器 = PASS（真实 HTTP 已跑通）**（06 §真实Provider判定）；
  **外部商业供应商 = BLOCKED_NOT_CONFIGURED**（本环境无商业搜索/模型凭据与费用授权）。
  **不得**据此声称已与外部供应商联调。

## 文件
- `provider-contract-log-sanitized.json`：替身记录的真实请求/响应（凭据仅记录存在性，值脱敏）。
- `research-job-trace-sanitized.json`：作业脱敏 trace、报告契约、来源、缺口、成本回执，
  以及降级 / BLOCKED / 预算门禁 / 取消 四类负例样本。

## 无凭据时的行为（同样被测试覆盖）
- 未配置检索 Provider → 作业 `BLOCKED / NOT_CONFIGURED`，**零出站、零发现**。
- 计费型供应商未配置预算上限 → `BUDGET_EXCEEDED`，**零出站**。
- 无模型 → 报告 `RETRIEVAL_ONLY`，**绝不**标记 `AI_RESEARCH_COMPLETE`。
- 内网/回环/私网/带凭据/非 443 端口 → 连接层拒绝（子进程生产口径复检）。