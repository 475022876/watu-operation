# PUBLISHED_CONTENT_ISOLATION.md —— Published Archive 归档隔离证据

> 交付包：`MARKETING_HANDOFF_BUNDLE_V1.1/`
> 依据：B 包 B5（归档隔离）+ `03_HANDOFF_AND_REPORT.md` 第 6 项
> 对应验收：**`INT-08`**（Published Archive 不镜像）
> 日期：**2026-10-13**

---

## 0. 红线原文（用户硬约束）

> 「必须保留 **Published Archive 只在 Marketing OS 归档**，以及**正式资产由企业资料库权威管理**的原则。」

本轮以**三重证据**（代码结构 / 能力声明 / 双系统实测）证明该红线**未被违反**。

---

## 1. 结论

| 判据 | 结果 |
|---|---|
| 发布成品是否被**自动镜像**进企业资料库 | ❌ **没有**（`D4-54` 资产总数 `before=0 after=0`） |
| 发布过程是否产生**任何出站写入** | ❌ **没有**（`D4-55` 事件流 `newItems=0`） |
| Provider **是否提供**发布归档能力 | ❌ 没有（`D4-08`/`D4-41` `publishedContentArchive=false`） |
| 归档是否**只在** Marketing OS 完成 | ✅ 是（`D4-42` `total=1`） |
| 从历史成品提取**母版**是否可直接复用 | ❌ **必须另开独立准入申请**（`D4-56` 不同 `providerAdmissionId` + `FINAL_APPROVAL_REQUIRED`） |
| 正式资产是否仍由**企业资料库权威管理** | ✅ 是（Asset ID / version 只能由 Provider 颁发，`D4-33`） |

**结论：`INT-08` = PASS（本侧范围）。**

---

## 2. 证据一：代码结构隔离（静态不可违反）

### 2.1 归档路由对集成层**零引用**

```bash
$ grep -rn "workspace\|library\|adapters" lib/mos/routes/publishing.js
（无输出）
```

`lib/mos/routes/publishing.js` **不 require** `workspace-client` / `workspace-contract` /
`adapters/workspace` / `adapters/library`。因此：

- 归档路径**在结构上不可能**触发任何资料库出站调用；
- 这不是「策略约定」，而是**模块依赖层面的不可达**。

### 2.2 归档是**物理快照**，不是引用

`publishing.js` 生成发布快照时，把正文与引用资产**物理复制**进
`data/uploads/published/<publicationId>/`：

| 产物 | 内容 |
|---|---|
| `TEXT_SNAPSHOT` → `content.md` | 冻结版本正文（UTF-8 落盘） |
| `MANIFEST` → `manifest.json` | 发布记录、版本、引用资产、URL、时间等元数据 |
| （引用资产本体） | 逐件复制入同一目录 |

**「不可覆盖」**：快照一旦生成即**只读回放**，后续版本变更不会改写既有快照。

---

## 3. 证据二：能力声明（Provider 自述不含归档）

`D4-08` / `D4-41` 实测 `capabilities` 响应：

```json
{
  "knowledgeSearch": true,
  "assetSearch": true,
  "assetResolve": true,
  "admissionSubmit": true,
  "admissionSubmitWithReviews": true,
  "admissionArtifactPush": true,
  "admissionFinalDecision": true,
  "publishedContentArchive": false
}
```

**`publishedContentArchive = false`** —— 提供方**明确声明**不承担发布成品归档。
因此「发布成品回流资料库」**既无接口，也无授权**。

> 与 Provider `BLOCKERS.md` §「附：故意未做」一致：Provider 侧亦未实现任何发布归档路径。

---

## 4. 证据三：双系统实测（运行时行为）

运行标识 **`runTag = 5d00f4e0`**，证据 `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json`。

### 4.1 Phase H 全链路（发布侧）

| # | 断言 | 实测 |
|---|---|---|
| `D4-49` | 发布链身份就绪（P3 操作员 / `PUBLISHING_APPROVER`，**均非管理员**） | ✅ 200,200 |
| `D4-50` | 内容冻结送审 → 生成 `PUBLICATION_APPROVAL` 审核单 | ✅ `cv_mv6ri2x8_029e5eb84ad2` |
| `D4-51` | 审批通过 → 版本 `APPROVED`（**提交人与审批人分离**） | ✅ `state=APPROVED` |
| `D4-52` | 人工登记实际发布 → `PublicationRecord`（**真实 URL / 实际时间**） | ✅ `pub_mv6ri2xj_feb737f71a29`<br>`url=https://www.linkedin.com/company/vfib-bank/posts/d4-b5` |
| `D4-53` | 归档快照**真实落盘**且正文**可只读回放** | ✅ `artifacts=["TEXT_SNAPSHOT:published/pub_mv6ri2xj_feb737f71a29/content.md","MANIFEST:published/pub_mv6ri2xj_feb737f71a29/manifest.json"]`；`bodyLen=40` |
| `D4-54` | 资料库侧资产总数**发布前后未变化** | ✅ **`before=0 after=0`** |
| `D4-55` | 发布期间资料库变更事件流**零新增** | ✅ `cursorBefore=14 newItems=0 kinds=[]` |
| `D4-56` | 从历史成品提取复用母版 → **独立新准入申请** | ✅ `remasterProviderId=adm_mv6ri2zuf518cd3c` ≠ `firstProviderId=adm_mv6ri1zx49140131`；`code=FINAL_APPROVAL_REQUIRED` |

> **`D4-54` 是本项最硬的证据**：若存在任何自动镜像，`after` 必然 > `before`。
> 实测 `0 → 0`，且是在**一次完整的真实发布**（含真实 URL 登记）之后。

### 4.2 归档面（MOS 侧）

| # | 断言 | 实测 |
|---|---|---|
| `D4-42` | 归档面真实存在 | ✅ `GET /api/mos/publications?brand=VFIB&pageSize=5` → `total=1` |
| `D4-42b` | 归档说明明示「已发布内容**不会**自动进入企业资料库」 | ✅ `note=Published Archive 是 Marketing OS 内的独立权威归档；已发布内容**不会**自动进入企业资料库（00 §1）。` |

---

## 5. 母版提取的正确路径（`D4-56` 详解）

这是最容易踩坑的一环，**必须写清楚**：

```
❌ 错误认知：历史发布成品可以直接「复用」为素材 → 直接引用 → 使用
✅ 正确路径：从历史成品提取母版 = 一份【全新的】工作素材
             → 走【独立的新准入申请】（新的 idempotencyKey）
             → 预检 → 送审 → 独立最终审批 → 入库 → 才可复用
```

**实测**：母版走的准入申请 `providerAdmissionId = adm_mv6ri2zuf518cd3c`，
与首发申请 `adm_mv6ri1zx49140131` **不同**；且同样被 Provider 以
**`409 FINAL_APPROVAL_REQUIRED`** 拦下（**不会**因为「它曾经被发布过」而放行）。

**含义**：发布行为**不产生**任何「免审通行证」。发布成品的**复用价值**必须重新经治理链确认。

---

## 6. 双权威边界（一张表说清）

| 对象 | 权威方 | 本侧能做到的极限 |
|---|---|---|
| **正式资产本体**（Asset ID / version / 生命周期） | **企业资料库** | 只能**申请**（准入）与**引用**（解析验证）；**不能**自造 ID、不能自判可用 |
| **发布成品归档**（PublicationRecord / 快照） | **Marketing OS** | **只有本侧**归档；**绝不**回灌资料库 |
| **Skill 生效版本** | **企业资料库** | 只能读取生效 `hash`；未生效一律 `410`，**不退化成草案** |
| **专业字典正式口径** | **企业资料库** | 只能读取；原件未到 → 全部保持「待核验」（见 `SKILL_AND_DICTIONARY_STATUS.md`） |

---

## 7. 未完成 / 未验证

| 项 | 状态 | 说明 |
|---|---|---|
| 归档快照的**长期留存策略**（清理 / 法务留存期） | `NOT_RUN` | 属运营策略，本轮未定义 |
| 归档内容的**跨品牌隔离**审计 | `NOT_RUN` | 本轮只验证了单品牌（VFIB）路径 |
| 发布链在**真实社交平台**的实际投递 | `NOT_APPLICABLE` | 本轮为「人工登记真实 URL」，**不含**自动发布（自动发布属 **MARK，明确不建设**） |
| 归档快照的**加密与访问审计** | `NOT_RUN` | 当前落盘为明文（本地隔离环境）；生产需另行加固 |

---

## 8. 与 MARK 红线的交叉确认

| MARK 项 | 状态 | 证据 |
|---|---|---|
| S05 客户增长 | **未开发** | `D4-43` `forbidden=[]`（权限表中不存在对应权限点） |
| 品牌声誉专项 | **未开发** | 同上 |
| 营销线索移交与闭环 | **未开发** | 同上 |
| 代理 / 自动发布 | **未开发** | `D4-43`（发布仅「人工登记真实 URL」，**无自动投递**） |
