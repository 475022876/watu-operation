# SKILL_AND_DICTIONARY_STATUS.md —— 专业字典 与 正式 Skill 状态

> 交付包：`MARKETING_HANDOFF_BUNDLE_V1.1/`
> 依据：B 包 B6（专业字典）+ B7（真实 Skill）+ `03_HANDOFF_AND_REPORT.md` 第 7 项
> 对应验收：**`INT-09`**（SPECIAL-01 正式字典）、**`INT-10`**（正式 Skill）
> 日期：**2026-10-13**

---

## 0. 结论（先说结论，再说方法）

| 验收项 | 结论 | 一句话理由 |
|---|---|---|
| **`INT-09`** SPECIAL-01 正式字典 | **`BLOCKED`** | 正式**原件从未提供** → 全部相关条目保持 `provisional` / 「待核验」，**不接受想象填充** |
| **`INT-10`** 正式 Skill | **`BLOCKED`** | 官方 Visual Brand Guardian Skill **V1.2 未入库**；本侧**机制已就绪**（登记→批准→生效），但**无可生效的对象** |

> **这不是本侧的失败**，而是**外部材料未到**的如实登记（Provider `BLOCKERS.md` `B-1` / `B-2` 同项）。
> 按 C 包一票否决项：**不得**把 `UNVERIFIED` 字典 / 合成 Skill 标为 `REAL PASS`。

---

## 1. `INT-09` —— SPECIAL-01 专业字典

### 1.1 事实

| 项 | 内容 |
|---|---|
| **应有原件** | 《VFIB 全球社交媒体运营与内容生产指导手册》**V1.1** |
| **保管方** | 企业资料库（正式文件**单一权威**） |
| **是否随包提供** | ❌ **否**（`SOURCE_DOCUMENTS.SPECIAL_01.providedToDev = false`） |
| **本轮是否收到** | ❌ 否（`LIBRARY_HANDOFF_BUNDLE_V1.1` 亦未随附原件） |

### 1.2 依赖该原件的**全部**字典键（逐项核验状态）

| 字典键 | 条目数 | 已核验 | **待核验** | 依据源文件 |
|---|---|---|---|---|
| `pillars`（内容支柱） | 6 | 0 | **6** | SPECIAL_01 |
| `narratives`（叙事） | 5 | 0 | **5** | SPECIAL_01 |
| `assetCategories`（资产类目） | 8 | 0 | **8** | SPECIAL_01 |
| `visuals`（视觉分档） | 5 | 0 | **5** | Visual Brand Guardian Skill V1.2 |
| `motions`（动效分档） | 5 | 0 | **5** | Visual Brand Guardian Skill V1.2 |
| `templateCodes`（模板编码） | 8 | 0 | **8** | Visual Brand Guardian Skill V1.2 |
| `displays`（展示分档） | 4 | 0 | **4** | Visual Brand Guardian Skill V1.2 |
| **合计** | **41** | **0** | **41（100%）** | — |

**核验状态枚举**：`UNVERIFIED`（默认） / `VERIFIED` / `REJECTED`。
本轮 **41/41 全部为 `UNVERIFIED`**，`verified = 0`。

### 1.3 本侧**已做**的正确处置

| # | 处置 | 实现 |
|---|---|---|
| ① | **不臆造**字典值 | 编码集合按主控文档**明示建立**，**不**凭 AI 创作/推测填写为正式栏目/叙事/资产名 |
| ② | **不把 `provisional` 标为 VERIFIED** | `PROVISIONAL_KEYS` 7 项全部登记；`summary().keys[*].unverified` 如实暴露 |
| ③ | **显式列出**「哪些条目是临时的、依据是什么」 | `SOURCE_DOCUMENTS` + `PROVISIONAL_SOURCES` 双向映射，API/UI 可查 |
| ④ | **提供核验通道** | `validateEvidence()` / `applyOverrides()` / `verify()` / `unverify()` —— 原件到位后可**逐条**核验并留痕 |
| ⑤ | **UI 明确标识** | 所有依赖 provisional 条目的界面显示「**待核验**」，**不**以「正式」字样呈现 |

### 1.4 **禁止做**的事（已遵守）

- ❌ 不得自行填入推测的字典条目；
- ❌ 不得把字典标为「已核对」；
- ❌ 不得据此声称 `INT-09` 通过。

### 1.5 解除条件

```
业务方提供 SPECIAL-01 正式原件
  → Provider 逐条核对并移除 provisional 标记
  → 本侧重跑契约套件 + 字典核验套件
  → `INT-09` 方可晋级
```

**唯一正解是「原件到位」，没有任何技术捷径。**

---

## 2. `INT-10` —— 正式 Skill

### 2.1 事实

| 项 | 内容 |
|---|---|
| **应有对象** | VFIB Visual Brand Guardian Skill **V1.2** |
| **保管方** | 企业资料库（Skill **单一权威**） |
| **是否已入库** | ❌ **否** |
| **本侧当前持有的 Skill 状态** | `REFERENCE_ONLY`（**文件规范引用**，非正式批准） |

### 2.2 本侧**机制**已就绪（三态闭环）

| 状态 | 语义 | 可用性 |
|---|---|---|
| `MISSING_NOT_APPROVED` | 不存在 / 未登记 | `formalUsable=false`、`testDraftUsable=false` |
| `REFERENCE_ONLY` | 仅作**参考/测试草稿** | `formalUsable=false`、`testDraftUsable=true` |
| `APPROVED` | 已批准，**可用于正式输出** | `formalUsable=true`、`testDraftUsable=true` |

**关键不变量**：

| 不变量 | 实现 |
|---|---|
| 非 `APPROVED` 的 Skill **不得用于正式品牌输出** | `usability()` 只对 `APPROVED` 返回 `formalUsable=true` |
| 未生效版本引用一律 `410`，**绝不退化成草案** | Provider 侧生效 hash 服务端冻结 |
| 输出意图门禁**失效关闭** | `normalizeIntent()` 未识别的 `outputIntent` **一律阻断**（BUILD-02 自检 A-11 修复，**勿回退**） |
| 提示词**可复现** | 提示词由 `buildPrompt()` **程序化合成**，记录 `effective_rule_hash` |
| 生效版本变更可感知 | Provider 事件 `skill.version.changed` → 本侧登记失效（旧版本缓存不得再用） |

### 2.3 本侧**已做**的正确处置

- Skill **机制**已锁定并验证：登记（`DRAFT`）→ 批准（`APPROVED`，**仍不可正式引用**）→ 生效（`EFFECTIVE`，`hash` 服务端冻结）；
- `REFERENCE_ONLY` 状态**如实呈现**，不伪装为「已批准」；
- 正式输出路径**结构性拦截**（`formalUsable=false` + `outputIntent` 失效关闭）。

### 2.4 **禁止做**的事（已遵守）

- ❌ 不得擅自把任何 Skill 标为 `EFFECTIVE`（用户明令禁止）；
- ❌ 不得用**合成 Skill** 冒充官方 Skill；
- ❌ 不得据 `REFERENCE_ONLY` 生成「正式」视觉/模板/显示分档标签。

### 2.5 解除条件

```
业务方提供 Visual Brand Guardian Skill V1.2 正式材料
  → 登记（DRAFT）
  → 由持 library.skill.approve.effective 的【真人】批准并生效
  → 本侧获取生效 hash 并记录生成快照
  → `INT-10` 方可晋级
```

---

## 3. 相关契约端点（机制侧已全部就位）

| 端点 | 方法 | 路径 | 服务 scope | 票据 kind |
|---|---|---|---|---|
| `SKILL_GET` | `GET` | `/api/integrations/marketing/skills/:id` | `skills.read` | `service` |

**本侧仅消费 `skills.read`** —— **不**持有 `library.skill.approve.effective`，
即**架构上不可能**由消费方自行把 Skill 标为生效。

---

## 4. 测试覆盖

| 套件 | 命令 | 覆盖 |
|---|---|---|
| `workspace` | `bash tools/run-mos-tests.sh workspace` | `WC-06`（端点数与路径前缀一致，**含文档未列出的 skills**）、`WC-31`（事件类型字面量含 `skill.version.changed`） |
| `dual` | `bash tools/run-mos-tests.sh dual` | `E-*` 组中 `skill.version.changed` 触发本地引用失效 |
| `unit` | `bash tools/run-mos-tests.sh unit` | `outputIntent` 失效关闭；`usability()` 三态 |
| `joint` | `node tools/mos-e2e-build04-dual.js` | Phase A `D4-04`（**最终审批权不继承**，Skill 生效权同理） |

**结果**：`workspace 36/36`、`dual 51/51`、`unit 75/75`、`joint 64/64` —— **全绿**。

---

## 5. 一项容易误解的对比（避免被误读为「本侧没做」）

| 维度 | 状态 |
|---|---|
| **机制**是否就绪？ | ✅ **是** —— 状态机、门禁、失效、审计、端点全部实现并测通 |
| **对象**是否可用？ | ❌ **否** —— 官方材料未到，**没有任何合法对象**可供生效 |
| 因此 `INT-10` 应记为何？ | **`BLOCKED`**（**不是** `FAIL`，也**不是** `PASS`） |

> 「机制就绪」**永远不能**替代「对象已生效」。C 包一票否决项明确禁止这种替换。

---

## 6. 未完成 / 未验证

| 项 | 状态 | 说明 |
|---|---|---|
| SPECIAL-01 原件逐条核验 | `BLOCKED` | 原件未提供（Provider `B-1`） |
| Visual Brand Guardian Skill V1.2 入库与生效 | `BLOCKED` | 材料未提供（Provider `B-2`） |
| 跨系统**真人** Skill 生效路径 | `NOT_RUN` | 需双方会同（Provider `B-3`） |
| 字典条目的**业务影响面**评估 | `NOT_RUN` | 若业务方**依赖**这些枚举做判定，必须知道**当前是临时口径**，可能在原件到位后变更 |
