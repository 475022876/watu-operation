# SPECIAL-01 来源映射与栏目适配 — VFIB Marketing OS V0.1.2

> 结论：**SPECIAL-01《VFIB 全球社交媒体运营与内容生产指导手册》原件仍未随包交付**。
> 本版所有栏目/叙事/视觉标签的正式名称**仍全部为 `provisional`（待核验）**，与 V1.2 收口时口径一致（41 项 provisional 未减少）。
> V0.1.2 Phase B/C 在此基线上做了**程序性适配**（判定规则可执行），但不臆造任何业务规范。

## 1. 栏目 C01—C06 适配（程序性规则，来源：执行包 02 §SPECIAL-01规则约束）

实现位置：`lib/mos/researchlib.js` `checkCategory()`；提案创建/审核时强制执行（`lib/mos/routes/research.js`）。

| 栏目 | 程序性约束（可机检） | 缺依据时的行为 |
| --- | --- | --- |
| C01 Inside VFIB | 引用须来自**企业正式已核实依据**（`officialEvidenceRef`） | 未提供 → `needsVerification=true`，提案保持待核验 |
| C02 Banking Explained | 通俗且准确（人工判定，无机检） | — |
| C03 Banking in Action | 实际功能/界面须有**企业正式已核实依据** | 未提供 → `needsVerification=true` |
| C04 Institutional Solutions | 不得把目标能力写成已提供（人工判定） | — |
| C05 Digital Finance Insights | 区分事实与观点（人工判定） | — |
| C06 VFIB Newsroom | 须**正式公告授权**（`announcementAuthorized`） | 未提供 → `needsVerification=true`，**批准动作不洗白该标记** |

- 非法栏目（非 C01—C06）→ `400 BAD_PROPOSAL`，直接拒绝。
- `needsVerification` 标记**不因提案被批准而清除**（编辑审核只改 6 个字段，其中无 needsVerification）——批准不洗白。
- 栏目正文说明（`SPECIAL01_NOTES`）逐字来自执行包 02，未自创规范；说明仅作审核参考，不替代人工判定。

## 2. 其余字典项 provisional 状态（不变）

- 来源等级 S1—S4、采集方式 RSS/JSON_API/MANUAL、许可状态 OPEN/LICENSED/METADATA_ONLY/UNVERIFIED：
  来源为执行包/主控文档明文（`source:'SPEC'`）。
- 栏目标签、叙事、视觉等其余条目：`provisional:true, source:'provisional'`（`lib/mos/dict.js` `prov()`），
  标签显示「待核验」，待 SPECIAL-01 原件核验后一次性替换。
- **未新增任何 provisional 项、也未把任何 provisional 项升级为 SPEC**——原件未到，不做臆造升级。

## 3. 待办（阻塞项）

| 项 | 依赖 | 解除条件 |
| --- | --- | --- |
| 41 项 provisional 标签核验 | SPECIAL-01 原件交付 | 业务方逐项确认后由正式身份更新字典 |
| C01/C03/C06 依据登记 | 业务方提供 evidenceRef / 公告授权凭据 | 提案流程中按需登记，机检自动放行 |
