# BLOCKED_ITEMS_V1.2 —— 外部输入与授权（**如实阻断，不臆造**）

> 依据：B 包 Phase B2「SPECIAL-01 原件未到 → 保持 PROVISIONAL；Skill V1.2 需 Provider 真人批准且 EFFECTIVE；
> AI 无真实凭据则 BLOCKED；UI 不可用时不得写 PASS」
> 原则：**宁可 BLOCKED，不可冒充。** 三项均因**外部输入/授权未到**而阻断，本侧不做任何替代性"证明"。

---

## 1. INT-09 / SPECIAL-01 专业字典 —— **BLOCKED**

| 项 | 值 |
| --- | --- |
| 权威原件 | 《VFIB 全球社交媒体运营与内容生产指导手册》**V1.1**（SPECIAL-01） |
| 保管方 | 企业资料库（正式文件单一权威） |
| 本轮是否随包提供 | ❌ **未提供**（`dictverify.SOURCE_DOCUMENTS.SPECIAL_01.providedToDev === false`） |
| 字典核验状态 | **41 项全部 `provisional: true` / `status: 'UNVERIFIED'`**（实测 `registry()` 条目数 = 41，无一被核验） |

### 41 项的分布（编码集合按主控文档明示建立，**标签一律保持"待核验"**）

| 字典键 | 条目范围 | 条数 | 归属原件 |
| --- | --- | --- | --- |
| `pillars` | `C01–C06` | 6 | SPECIAL_01 |
| `narratives` | `N01–N05` | 5 | SPECIAL_01 |
| `visuals` | `V01–V05` | 5 | VISUAL_SKILL_V12 |
| `motions` | `M01–M05` | 5 | VISUAL_SKILL_V12 |
| `assetCategories` | `A01–A08` | 8 | SPECIAL_01 |
| `templateCodes` | `PPT-01–PPT-08` | 8 | VISUAL_SKILL_V12 |
| `displays` | `D0–D3` | 4 | VISUAL_SKILL_V12 |
| **合计** | — | **41** | — |

### 本侧交付的不是"已核验标签"，而是**防伪造的核验机制**

- **唯一覆盖入口** `applyOverrides()`，且规则明确：
  - 只给 `label` 字符串 → **仅覆盖显示名**，条目**仍然 provisional**（`source: 'config_unverified'`）；
  - 给出 `{label, sourceVersion, evidenceRef, verifiedBy}` → **才**允许标记为已核验，并把
    **来源版本 + 证据引用**落到条目上（可追溯）。
  - ➡ 这条规则**封堵**了"用配置或 AI 文案把待核验标签伪装成正式标签"的路径
    （原实现"给一个字符串即置 `provisional=false`"属自审发现的缺陷，已修正）。
- `verify()` 运行时登记证据到 `settings.dictionaryVerifications`；
  **缺少来源版本或证据引用一律拒绝**，如实返回 `EVIDENCE_REQUIRED`。
- 未取得原件前，API/UI **如实呈现"待核验"**，不显示任何正式栏目/叙事/资产名。

### 解除条件

取得 SPECIAL-01 **V1.1 正式原件**后，**逐条**核对并录入
`label` + `sourceVersion` + `evidenceRef` + `verifiedBy`；**不得**由 AI 创作或推测填充。
Visual 类 4 组（`visuals/motions/templateCodes/displays`）另需 Skill V1.2 正式生效（见下）。

---

## 2. INT-10 / 正式 Skill V1.2 —— **BLOCKED**

| 项 | 值 |
| --- | --- |
| Skill | 《VFIB Visual Brand Guardian Skill》**V1.2** |
| 保管方 | 企业资料库（Skill 单一权威） |
| 本轮状态 | ❌ **未在资料库正式批准 / 未 EFFECTIVE**；系统中当前为 **`REFERENCE_ONLY`** |
| 真人审批记录 | ❌ 未提供（`SOURCE_DOCUMENTS.VISUAL_SKILL_V12.providedToDev === false`） |

### 本侧已做到的（可交付的部分）

- 正式输出门禁**要求 Skill 必须 EFFECTIVE**：`REFERENCE_ONLY` 一律
  `SKILL_NOT_EFFECTIVE` 阻断（`D6-53` 实测通过）——**不用草稿/引用态冒充正式依据**。
- 门禁为**fail-closed**：无 EFFECTIVE Skill 时**必然**阻断，这是正确表现而非缺陷。

### 为什么仍记 BLOCKED（而非 PASS）

`C 包` 对 INT-10 的解除条件是「**Skill V1.2 正式登记、真人审批、生效及引用**」。
本侧**只有负向证据**（引用态被阻断），**没有**正向证据（一个真实 EFFECTIVE Skill 被成功引用并生成正式作品）。
**不得**以"负例通过"冒充"该项通过"。故记为 **BLOCKED**。

### 解除条件

Provider 侧由**真人**完成 V1.2 Skill 的审批与生效（EFFECTIVE），并提供
审批记录 + 版本 + hash；随后本侧验证：当前有效版本校验、历史版本快照、
生成时授权校验（`skill.version.changed` 事件后旧版不得再被新引用）。

---

## 3. INT-11 / 真实 AI Provider（文字 + 图像）—— **BLOCKED**

| 项 | 值 |
| --- | --- |
| 文本 Provider | `MOS_TEXT_PROVIDER = none`（未配置） |
| 图像 Provider | `MOS_IMAGE_PROVIDER = none`（未配置） |
| 真实供应商非生产密钥 | ❌ 未提供 |
| 费用授权 | ❌ 未获得用户明确授权 |
| 真实调用次数 | **0** |

### 本侧行为（**诚实**）

- 未配置时，生成任务如实返回 `status: NOT_CONFIGURED`（见 `D6-52` 的
  `status=NOT_CONFIGURED`），**不伪造成功、不返回模拟成品冒充真实产出**。
- `MOCK / REAL` 语义在 `docs/MOCK_REAL_MATRIX.md` 中逐项登记；适配层产出的
  `approvalMode` 亦区分 `REAL` / 非 REAL（`D6-46` 实测 `approvalMode=REAL` 是**准入同步**的真实标记，
  与"AI 生成是否为真实调用"是两件事，**不得混用**）。

### 解除条件

提供**真实供应商的非生产密钥** + 用户**明确授权费用**后，在授权测试条件下完成真实文字与图像调用，
并记录：Provider、model ID、**成本**、**敏感资料外发控制**（`canSendToExternalAI` 三重闸门）、
错误恢复行为。**不得**用 MOCK 冒充 REAL。

---

## 4. 其余未完成项（非"外部输入未到"，而是**需要真人动作**）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| **INT-04** 真实授权最终审批人 Staging 签认 | **CONDITIONAL** | 本侧已用**合成**授权主体走通全链（`D6-44`），但**合成身份不能代替真人授权**；须由真实授权人在 Staging 完成签认 |
| **INT-13** 双方完整回归 / 数据恢复 / 权限负例互认 | **CONDITIONAL** | 本侧 `all` 546/546 已跑；**提供方全量回归与数据恢复演练本侧未复跑**，待双方互认 |
| **INT-14** 双方真实签署 / 运行环境确认 | **CONDITIONAL** | 本侧 Release Register 已出（`docs/RELEASE_REGISTER.md`）；**签署栏留空**，待双方书面确认 Staging 环境 |
| **生产部署** | ❌ **未做** | 须用户**另行明确批准** |

---

## 5. 红线复述（本侧全程遵守）

| 禁止项 | 遵守情况 |
| --- | --- |
| 修改 Workspace（企业资料库）源码 | ✅ 未改（`D6-56`：`server.js` mtime Δ=0ms） |
| 将未获批 Skill 伪装为 EFFECTIVE | ✅ 未做（`REFERENCE_ONLY` 一律阻断） |
| 对真实用户擅自授予 `library.asset.approve.final` | ✅ 未做（仅对**合成**身份显式授权） |
| 把合成身份测试标为真人验收 | ✅ 未做（证据文件内明确标注 `syntheticIdentities`） |
| 上传密钥 / 把凭据写入证据 | ✅ 未做（运行期随机生成，仅内存；证据只留 `correlationId`/`code`/`status`） |
| 把 Published Archive 同步到资料库 | ✅ 未做（结构性隔离，见 `PUBLISHED_ARCHIVE_ISOLATION.md`） |
| 开发 S05 / 营销线索闭环 / 独立舆情专项 | ✅ 未做（`D6-57`：权限表 MARK 类命中 0） |
| 未经授权上线生产 | ✅ 未做 |
| 用单元测试冒充真实调用 | ✅ 未做（`build06` 为双进程真实 HTTP + Provider 侧审计比对） |
