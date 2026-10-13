# VFIB Visual Brand Guardian Skill V1.2 —— 待审批登记与审批流程准备

> 登记日期：2026-10-14 ｜ 登记工具：`tools/mos-skill-register-pending.js`（零依赖、幂等、原子写入 + 备份 + 审计）
> **当前状态：`PENDING_APPROVAL`（待审批）—— 绝未标记 APPROVED / EFFECTIVE。**

---

## 1. 源文件完整性、版本信息与身份核验

| 项 | 实测结果 |
|---|---|
| 源文件 | `C:\Users\three\Documents\xwechat_files\...\2026-10\VFIB_全球社交媒体运营与内容生产指导手册_V1.1.docx` |
| 大小 / 格式 | 10,103,108 bytes；ZIP magic（`50 4B 03 04`）校验通过，为有效 DOCX |
| SHA256 | `cd8f7fa4f12f952ddbb624b4858a3bab89e320c1fb38499a02f49fbce6e70281` |
| 结构解析 | editor_sdk 解析通过：**417 个结构节点**，14 章 + 附录 A—G，含 30+ 表格与插图 |
| 文档标题 | 《VFIB 全球社交媒体运营与内容生产指导手册》｜V1.1｜完整版 · 员工执行与培训基线 |
| 文件编号 / 日期 | **VFIB-BCG-S01-HANDBOOK-V1.1** ｜ 2026-10-10 |
| 适用范围 | 「VFIB 银行主品牌及其官方数字传播渠道；U CARD 独立营销增长体系另行管理」 |
| 治理说明 | 记录已确定的业务管理原则与建议执行规范；金融业务以最新获批准的权威文件为准 |

### ⚠ 身份差异（必须在审批时核验，登记为待核项 C-1/C-2）

提交方称该文件为**《VFIB Visual Brand Guardian Skill V1.2》**，但文件全文（标题页、文件编号、正文）**未出现**「Visual Brand Guardian」「V1.2」「Skill」任何字样；实际自述版本为 **V1.1 手册**。本登记**如实**按「源文件 = 指导手册 V1.1、Skill 版本 = 1.2（提交方声称）」双轨记录，差异留待最终审批人核验；如需补交正式 Skill 文件，由提交方补充后重新登记。

## 2. 视觉规范结构核验（源文件内定位通过）

| 规范族 | 位置 | 内容 |
|---|---|---|
| 品牌定位 | §2.1—2.2 | 数字金融基础设施定位；Human 等核心创意价值；受众矩阵 |
| 栏目规范 | §2.3 | **C01—C06**（Inside VFIB / Banking Explained / Banking in Action / Institutional Solutions / Digital Finance Insights / Newsroom） |
| 叙事结构 | §3.1 | **N01—N05** 五种叙事结构 |
| 视觉语言 | §3.2—3.3 | **V01—V05** 五种视觉语言 + 视觉一致性和真实性（Light 背景、AI 摄影边界、无黑金特效等） |
| Motion | §6.3 | **M01—M05** Motion Identity（Signature / Financial Flow / Banking Interface / Financial Intelligence / Editorial） |
| 视频表达 | §6.2 | **F01—F04**；§6.5—6.7 四套视频样板 Y-A—Y-D 与十步制作验收 |
| 资产与审核 | §10、§12 | **A01—A08** 八类资产 + 14 项留存；G0—G3 风险等级；十项发布前检查 |
| 待核验 | 附录 G | 「本版实施状态与待核验」表（审批人须逐项处置 → 待核项 C-5） |

## 3. 版本登记（`skill_versions` 集合，现有机制，只增不改）

| 字段 | 值 |
|---|---|
| **待审批记录编号** | **`skv_vfib_guardian_12_pa1`** |
| brandCode / skillCode / version | `VFIB` / `VISUAL_BRAND_GUARDIAN` / `1.2` |
| state | **`PENDING_APPROVAL`** |
| checksum | `cd8f7fa4…70281`（源文件 SHA256，替代原 `UNVERIFIED_FILE_PACKAGE` 占位） |
| approvalRef | 空（审批完成后由审批人回填） |
| 来源关联 | `sourceDocument`：文件名 / 编号 VFIB-BCG-S01-HANDBOOK-V1.1 / 文档版本 1.1 / 日期 2026-10-10 / 大小 / SHA256 / 接收时间 |
| 有效性 | `validity.effectiveFrom/until = null`、`activatedAt = null`（批准后设置） |
| 授权范围 | `authorization.formalOutputAllowed=false`、`testDraftAllowed=false`；最终审批角色 `LIBRARY_FINAL_APPROVER`、权限 `library.asset.approve.final` |
| 适用品牌 | `applicability.brands = ['VFIB']`；`excludes` 明确 **U CARD 不得套用** |
| demo | `false`（真实登记，非演示数据） |

既有记录 `skv_vfib_guardian_12`（REFERENCE_ONLY，文件规范包占位引用）**保持不变**，作为历史引用；本次为**新增**待审批记录。审计事件 `skill.pending_registered` 已落 `audit_events`（actorId `tool:mos-skill-register-pending`）。

## 4. 正式审批流程准备（入口与步骤）

**审批入口（正式）：** 由持有 **`library.asset.approve.final`** 特殊权限的正式身份（`LIBRARY_FINAL_APPROVER` 角色）**本人登录** Marketing OS 后执行审批；**系统不提供、也不得使用任何绕过登录身份的脚本代批**。

**审批前置核验清单（已写入记录 `pendingChecks` C-1…C-6）：**
1. **C-1 身份核验**：确认手册 V1.1 与「Visual Brand Guardian Skill V1.2」的对应关系，或要求提交方补交正式 Skill 文件；
2. **C-2 版本链**：Skill 1.2 vs 源文件 1.1 差异书面确认；
3. **C-3 视觉规范结构**：V01—V05/N01—N05/M01—M05/C01—C06 内容符合性审阅（结构定位已通过）；
4. **C-4 品牌范围**：适用范围限定 VFIB、U CARD 排除（与源文件一致）；
5. **C-5 附录 G 待核验项**：逐项处置；
6. **C-6 SPECIAL-01 字典关联**：与 41 项 provisional 字典的关系确认。

**批准后动作（由审批人触发，当前全部未执行）：** 回填 `approvalRef` → `state='APPROVED'` → 设置 `validity.effectiveFrom` 与 `activatedAt` → 落 `skill.approved` 审计事件。批准后方可用于正式输出（`formalUsable=true`）。

## 5. Marketing OS 调用接口检查（实测）

| 检查点 | 实测结果 |
|---|---|
| `GET /api/mos/skills`（RBAC 保护） | `listSkills(db,'VFIB')` 返回 `skv_vfib_guardian_12=REFERENCE_ONLY, skv_vfib_guardian_12_pa1=PENDING_APPROVAL` ✅ |
| 门禁 `skill.usability(PENDING_APPROVAL)` | **fail-closed**：`formalUsable=false`、`testDraftUsable=false`（待审批 Skill 连测试草稿也不得产出）✅ |
| 门禁 `resolveSkill(db,'VFIB','VISUAL_BRAND_GUARDIAN')` | 首匹配仍为既有 REFERENCE_ONLY 记录 → **既有生成行为零变化**，正式输出照旧被 `formalguard` 阻断 ✅ |
| `POST /api/mos/formal-output-check` / `generation-jobs` | 共用 `formalguard.evaluate` → `skill.usability()`；待审批/未批准 Skill 的 FORMAL 输出必然 `409 FORMAL_OUTPUT_BLOCKED` ✅ |
| U CARD 隔离 | `skv_ucard_independent` 仍 `MISSING_NOT_APPROVED`，未受影响 ✅ |
| 数据安全 | 写盘前备份 `data/mos.json.bak-*`；`data/` 已 gitignore，不入库 ✅ |

## 6. 红线确认

- 本次**仅创建 `PENDING_APPROVAL` 记录**，未标记 APPROVED/EFFECTIVE，未回填 approvalRef；
- 最终审批由持有 `library.asset.approve.final` 的正式身份完成，**未代签**；
- 未修改任何 Skill 门禁代码；U CARD 独立体系未受影响；未部署生产。
