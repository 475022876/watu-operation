# BUILD-03 审计结论与开发计划

> ⚠ **已归档历史材料**（2026-10-13 迁入 `docs/history/`）。BUILD-03 已交付完成，本计划为当时的开发计划，
> 其结论已被 `../BUILD-03_TEST_REPORT.md` 与 `../BUILD-03_SELF_AUDIT.md` 取代。保留原因：D-03（禁止删除历史材料）。

**版本：** VFIB Marketing OS V0.1 · BUILD-03
**日期：** 2026-10-12
**依据：** `VFIB_Marketing_OS_V0.1_Codex_Build_Specification/`（00 主控、01 IA、02 数据模型、03 工作流、04 AI、05 发布、06 集成安全、07 UI、08 测试门槛、09 执行指导、10 追溯与决策、11 检查表）
**结论口径：** 本工程仍是**沙盒原型**，未接通任何真实企业系统；凡 MOCK 均不代表已打通。

---

## 1. 现有工程结构审计（BUILD-01/02 交付面）

### 1.1 分层与职责

| 层 | 文件 | 职责 | 审计结论 |
|---|---|---|---|
| 进程入口 | `server.js` | HTTP、静态资源、CSP、优雅关闭 | 稳定，本阶段不改 |
| 进程配置 | `lib/config.js` | 端口 / 数据目录 / 网络安全 | 已支持 `MOS_PORT`→`PORT`、托管 `0.0.0.0` |
| 安全基座 | `lib/{net,security,password,util,static}.js` | CIDR、Origin/CSRF、scrypt、MIME/魔数 | 与 OA 侧双份，**改动需人工同步** |
| 业务主体 | `lib/mos/*` | 字典、RBAC、路由、审计、存储、适配器 | 单文件 `data/mos.json`，原子落盘 + 写序号防回退 |
| 前端 | `public/mos.html` + `public/mos/js/**` | 原生 ES Module 外壳 | 零 CDN；五态组件齐备 |
| 自检 | `tools/*` + `run-mos-tests.sh` | smoke13 / unit25 / e2e47 / e2e02-63 / ui52 | 每套独立数据目录与随机口令，绝不触碰 `data/` |

### 1.2 BUILD-03 可直接复用的基础（无需重构）

- **三条审批链的骨架已存在**：`review_cases.type ∈ {PROFESSIONAL_REVIEW, PUBLICATION_APPROVAL, ASSET_ADMISSION}`，
  `review_decisions` 已是 append-only，`serialize()` 已按 `type` 输出不同权能。
- **Manifest 绑定机制已成型**（`lib/mos/manifest.js`）：BUILD-03 的资产审批复用同一思路（冻结 sha256 → 审批时重算比对）。
- **`MockLibraryGateway` 已按 06 §2 契约实现**（`searchApproved / resolveAsset / submitAdmission / getAdmissionStatus / verifyFinalAuthorization`），
  且已带 `MOCK_` 前缀与 `MOCK_APPROVED` 限制。
- **`analytics.read` 权限、`/api/mos/review-history` 端点、`publication_metrics` 写入通道** 均已就绪，只缺聚合读与页面。
- **`asset_admissions` / `library_asset_refs` 两个集合已在 schema v2 预置为空数组** —— 本阶段的落点。

### 1.3 审计发现（本阶段必须处理）

| 编号 | 发现 | 级别 | 处置 |
|---|---|---|---|
| A-16 | `routes/reviews.js` 的 `PERM_BY_TYPE.ASSET_ADMISSION = 'asset.review'`，与 03 §2.4「最终入库许可是**独立特权** `library.asset.approve.final`」冲突——任何持有 `asset.review` 的人都能执行最终入库审批 | **高（越权）** | 本次拆分为「预检 `asset.review`」与「最终审批 `library.asset.approve.final`」两个动作 |
| A-17 | `asset_admissions` / `library_asset_refs` 在 BUILD-02 仅占位，无任何实现；最终入库流程完全缺失 | 阻断 BUILD-03 | 本次做实（9 步状态机 + 双字段 + 计算判定） |
| A-18 | Analytics / Governance 仍是 `modules/stage.js` 占位页 | 阻断 BUILD-03 | 本次替换为真实页面并删除占位 |
| A-19 | `review_cases.subjectType` 仅处理 `content_version`；决策路由对 `asset_admission` 无联动、无职责分离判定 | 高 | 本次补齐（含「提交人不得自批」与资产内容篡改检测） |
| A-20 | `MockLibraryGateway` 的幂等表是**进程内 Map**，重启即丢；重复同步可能产生双资产 | 中 | 本次由 MOS 侧持久化 `receipt` + `idempotencyKey`，重试先查回执再提交 |
| A-21 | 无 Analytics 端点；`publication_metrics` 可写但无聚合读；「缺失」语义未落地 | 阻断 BUILD-03 | 新增 `GET /api/mos/analytics`，每段带 `available` 与原因 |
| A-22 | `verifyFinalAuthorization` 无调用点（BUILD-02 未接入），Mock 模式下的诚实性边界未被实际使用 | 中 | 本次接入为最终审批的前置校验 |

**结论：骨架（RBAC / 审计 / 审批链 / 适配器 / 存储）可直接支撑 BUILD-03，本阶段仍是**同骨架增量扩建**，不重构。

---

## 2. BUILD-03 范围（09 §4，逐条对齐）

| 序号 | 规格原文 | 本次交付物 | 验收断言 |
|---|---|---|---|
| 1 | 3 条审核链及最终权限 | `ASSET_ADMISSION` 链做实；`library.asset.approve.final` 独立特权与 `asset.review` 分离 | SEC-01：无该权限执行最终审批 → 403 + AuditEvent |
| 2 | AssetAdmission 与 LibraryGateway Mock + 幂等状态 | `routes/admissions.js` + `adapters/library.js` 扩展；`finalApprovalStatus` / `syncStatus` 双字段 | E2E-05 全流程；重复同步不产生双资产 |
| 3 | Approved 检索仅在授权 Mock 或真实库测试条件下可用，明确标 MOCK | `GET /api/mos/library-asset-refs`：沙盒条目与正式检索**分列**，全部带 MOCK 标 | `reuseEligibility` 计算判定恒为 false；Mock 下**永不** `AVAILABLE` |
| 4 | Analytics 真实聚合（未接指标显示缺失） | `GET /api/mos/analytics`：Content / Channels / Operations / AI&Cost 四段 | 未接入指标返回 `available:false` + 原因，**不用 0 或占位数字填充** |
| 5 | 权限 / 审计 / 失败恢复 | 同步失败 → `SYNC_FAILED` 且不可复用；重试幂等；资产被篡改后原批准失效 | SEC-08、E2E-05-11、SEC-02 类比断言 |
| 6 | E2E-05 和 SEC 全部测试 | `tools/mos-e2e-build03.js` | Gate C 全绿 |

**必须可操作（09 §4 精神）：** 上传工作素材 → 提交入库 → 预检 → 最终审批 → 资料库同步 → 结果可见且状态如实。

### 2.1 明确不做（沿用主控禁令，不得越界）

S05 客户增长、品牌声誉/风险登记专项、营销线索移交与闭环、CRM、代理后台、佣金、KYC、银行卡与资金交易、
社交平台自动发布、客户私信机器人、云端视频全自动渲染、复杂广告投放归因、完整 CRM、ComfyUI 自建节点。
**Analytics 只覆盖 00 §4「内容、渠道、计划执行、AI 成本、审核周期」，不做 CAC / 漏斗 / 归因。**

---

## 3. 数据模型增量（schema v2 → v3，只增不改）

`MOS_SCHEMA_VERSION` 由 2 提升为 3。**不新增顶级集合**（`asset_admissions` / `library_asset_refs` 已在 v2 预置），
仅固定其字段形状，因此 v2→v3 迁移是**纯版本号推进 + 形状补全**，对既有数据零风险。

### 3.1 `asset_admissions`（入库申请）

| 字段 | 说明 |
|---|---|
| `workingAssetId` / `assetSha256` | 源工作素材与其内容指纹（审批绑定用） |
| `categoryCode` | A01–A08（沿用字典，`provisional` 标注不变） |
| `submissionMetadata` | `{ title, description, license, sourceRef, tags[] }` |
| `precheck` | `{ state, checks[], checkedBy, checkedAt, failureReasons[] }` |
| `state` | 见 §4 状态机 |
| `finalApprovalStatus` | `PENDING / APPROVED / REJECTED`（**与 syncStatus 相互独立**） |
| `syncStatus` | `NOT_STARTED / PENDING / COMPLETED / FAILED` |
| `approvalMode` | `MOCK / REAL` —— 记录最终授权的实际验证来源 |
| `idempotencyKey` | 幂等键：同键重复同步返回**同一**回执 |
| `receipt` | 资料库回执快照（含 `assetId` / `libraryVersion` / `permissions`） |
| `libraryId` / `libraryVersion` | 真实入库 ID/版本；**Mock 下恒为 null** |
| `history[]` | 追加式流程事件（谁在何时做了什么） |

### 3.2 `library_asset_refs`（可复用资产引用）

| 字段 | 说明 |
|---|---|
| `libraryId` / `version` | 资料库侧标识（Mock 下为 `MOCK_` 前缀） |
| `permissionScope[]` | 授权范围（Mock 下为空） |
| `permissionValid` | 权限是否仍然有效（Mock 恒 false） |
| `assetState` | `ACTIVE / MOCK_SANDBOX / REVOKED` |
| `state` | 引用状态，与 `assetState` 分开 |
| `mock` | 是否沙盒产物（Mock 恒 true） |
| `sourceRef` | 来源（admissionId / publicationId） |
| `lastVerifiedAt` | 权限最近核验时间（安全 TTL 依据，06 §2） |

> **`reuseEligibility` 不进库**：由服务端按 03 §2.4 公式**计算**得出，禁止人工置 true。

---

## 4. AssetAdmission 状态机与判定规则（03 §2.4）

```
WORKING → SUBMITTED → PRECHECK → REVIEWING → FINAL_APPROVAL_PENDING
        → (FINAL_APPROVAL_GRANTED | REJECTED)
        → LIBRARY_SYNC_PENDING → (SYNC_COMPLETED | SYNC_FAILED)
        → AVAILABLE
```

**两条硬规则（服务端强制，不可配置放宽）：**

1. `reuseEligibility = (finalApprovalStatus === 'APPROVED')
                     && (syncStatus === 'COMPLETED')
                     && permissionValid
                     && assetState === 'ACTIVE'
                     && approvalMode === 'REAL'`
   —— 计算得出。Mock 下 `permissionValid=false`、`libraryId=null`、`approvalMode='MOCK'`，
   因此**沙盒申请永远拿不到复用资格**（00 §3「禁止把入库审批 APPROVED 当作已持久化的 AVAILABLE」）。
2. `AVAILABLE` 需要「真实资料库持久化回执 + 权限核验通过」。Mock 模式下终态为
   `SYNC_COMPLETED`（`sandbox:true`），**不是** `AVAILABLE`，且响应显式给出 `availableBlockedReason`。

**失败与恢复（03 §5）：**

- 同步失败 → `SYNC_FAILED`，`reuseEligibility=false`，记录 `errorCode`/`errorMessage`；
- 重试**复用同一 `idempotencyKey`**；重试前先按回执查询（`getAdmissionStatus`）确认是否已成功，
  避免「回执丢失 → 重复入库 → 双资产」；
- 源素材内容变化（sha256 不一致）→ 原审批失效，必须重新预检与审批。

**第三条审核链的权能拆分（A-16 修复）：**

| 步骤 | 动作 | 权限 |
|---|---|---|
| 预检 | `POST /:id/precheck` | `asset.review` |
| 提交最终审批 | `POST /:id/submit-final`（开 `ASSET_ADMISSION` 审核单） | `asset.submit` |
| **最终审批** | `POST /:id/final-decision` | **`library.asset.approve.final`**（独立特权，不随 P1 / MOS_ADMIN 自动获得） |
| 同步 | `POST /:id/sync`、`POST /:id/retry-sync` | `asset.submit` |

---

## 5. 路由清单（本阶段新增/变更）

```
# 入库（新增 routes/admissions.js）
GET    /api/mos/asset-admissions?brand=&state=&q=
POST   /api/mos/asset-admissions                    # 从 working_asset 提交（幂等键）
GET    /api/mos/asset-admissions/:id
POST   /api/mos/asset-admissions/:id/precheck       # asset.review
POST   /api/mos/asset-admissions/:id/submit-final   # 开 ASSET_ADMISSION 审核单
POST   /api/mos/asset-admissions/:id/final-decision # library.asset.approve.final
POST   /api/mos/asset-admissions/:id/sync           # 幂等同步
POST   /api/mos/asset-admissions/:id/retry-sync     # 失败重试（先查回执）

# 可复用资产（新增）
GET    /api/mos/library-asset-refs?brand=&q=        # 正式检索（MOCK 恒空）+ 沙盒条目分列

# 分析（新增 routes/analytics.js）
GET    /api/mos/analytics?brand=&section=           # content|channels|operations|aiCost|all

# 变更
POST   /api/mos/review-cases/:id/decision           # 支持 subjectType=asset_admission（含职责分离与篡改检测）
```

---

## 6. 页面清单（01 §2 对齐）

| 中心 | 页面 | 模块文件 | 阶段 |
|---|---|---|---|
| Analytics Center | W07-01 Content / W07-02 Channels / W07-03 Operations / W07-04 AI & Cost | `modules/analytics.js`（四段式） | BUILD-03 |
| Governance & Assets | W08-02 Review History / W08-03 Asset Admission / W08-04 Approved Assets | `modules/governance.js`（三视图） | BUILD-03 |
| Governance & Assets | W08-01 My Reviews | `modules/reviews.js` | BUILD-02（已交付，不改） |

每页必须实现 Loading / Empty / Error / Access Denied / Integration Pending 五态（01 §4）。
`modules/stage.js` 占位页在本阶段**删除**（不再有任何中心引用它）。

---

## 7. 测试计划（Gate C）

| 套件 | 新增断言 |
|---|---|
| unit | schema v3 迁移、Admission 状态机迁移表、`reuseEligibility` 计算判定（Mock 恒 false）、预检规则 |
| e2e03 | **E2E-05** 全流程（WorkingAsset → Submit → Precheck → 最终审批 → MOCK 同步 → 结果）；**SEC-01** 无最终权限 403 + 审计；**SEC-08** 同步失败不可复用 + 幂等重试；**SEC-09** Mock 不冒充正式；**SEC-10** 受限内容拒发；Analytics 缺失语义；Mock 下 AVAILABLE 不可达；资产篡改后原批准失效 |
| ui | Analytics 四段渲染 + Governance 三视图真实写操作 → 刷新仍在 |

命令：`bash tools/run-mos-tests.sh all`（新增 `e2e03` 套件并纳入 all）。

---

## 8. 执行顺序与风险

**顺序：** 1. 字典与状态机 → 2. schema v3 + 迁移 → 3. LibraryGateway 扩展 → 4. 入库路由 → 5. 审核链第三条 →
6. Analytics → 7. 前端 → 8. 测试 → 9. 报告。

**已知风险：**

- **真实资料库仍未接通**：`AVAILABLE` 在 Mock 下**结构性不可达**，这是设计而非缺陷；
  真实可用性需 Gate D（生产集成）单独验证，本阶段不宣称。
- **A01–A08 资产分类标签仍为 `provisional`**：SPECIAL-01 手册未提供，不臆造标签。
- **单文件 JSON 存储**：`asset_admissions` 的 `history[]` 会随流程增长，仍受「单表万级」边界约束。
- **平台指标未接通**：Analytics 的渠道表现依赖人工/导入的 `publication_metrics`，无数据即显示「缺失」。
