# Published Archive 结构性隔离（B1④）

> 需求：B 包 Phase B1 第 4 条
> 「Published Archive 为本中台唯一权威发布业务档案；**不能自动镜像到 Enterprise Library**」
> 契约：C 包「Published Content 禁止自动入库；只有通过独立 Asset Admission、真人最终批准、
> Library 持久化并获得 Asset ID/version 后才可复用」

---

## 1. 结论

**结构性隔离，而非"约定/策略"。** 发布归档与资料库集成之间**不存在任何代码路径**，
因此不存在"忘记关掉镜像"的风险。

---

## 2. 证据

### 2.1 发布路由对集成层**零引用**

```
$ grep -n "adapters/workspace\|adapters/library\|workspace-client\|publishedContentArchive" \
        lib/mos/routes/publishing.js
（无输出 —— 零引用）
```

`lib/mos/routes/publishing.js`（Published Archive 的实现所在）**不 require** 任何
企业资料库适配器或客户端。归档动作**在物理上无法**触发任何出站。

### 2.2 能力声明：两侧都明示"资料库不建发布成品镜像"

| 侧 | 声明 | 位置 |
| --- | --- | --- |
| 本侧（MOS 适配层） | `publishedContentArchive: false` | `lib/mos/adapters/workspace.js:343` |
| 本侧（契约字段清单） | `publishedContentArchive` 列入"仅中台"字段 | `lib/mos/workspace-contract.js:517` |
| **提供方（Provider）** | `capabilities.publishedContentArchive: false` | `oa-system/lib/routes/integrations.js:203` |

➡ **双方独立声明一致**：资料库**不**承担 Published Content 归档职责。
（`build06` 的 `D6-13b` 实测 Provider `/health` 返回
`publishedContentArchive=false`，非纸面声明。）

### 2.3 正式复用必须走**独立准入链**，而非直接归档

复用资料库母版的唯一路径（`build06` 真实双进程实测，`D6-40…D6-47`）：

```
MOS 工作素材上传
  → 建准入单（三必填字段）
  → 独立预检员预检（ASSET_REVIEWER，不含最终审批权）
  → 送审（开 ASSET_ADMISSION 审核单；提交人不得自批）
  → 授权主体最终审批（持有 library.asset.approve.final）
  → 首次同步被拦（申请 ≠ 资产）
  → Provider 侧真人/授权审批 + artifact 上传
  → 重试同步取得 Asset ID / version（approvalMode = REAL）
  → 建立可复用引用
```

**关键不对等**：

| 对象 | 权威方 | 说明 |
| --- | --- | --- |
| **Published Content（发布成品档案）** | **仅 Marketing OS** | 资料库侧恒 `false`，不镜像 |
| **正式可复用母版（Library Asset）** | **仅企业资料库** | 本侧只持有引用（`library_asset_refs`），不复制母版 |

---

## 3. 本轮未变更

- 未新增任何"上传/同步 Published Content 到资料库"的代码或端点。
- `publishedContentArchive` 保持 `false`；契约 **1.0** 未变。
- 发布归档审计仍落在中台自身的 `appendAudit()`（`db.audit_logs`），**不产生集成出站**。

---

## 4. 复现方式

```bash
grep -n "adapters/workspace\|adapters/library\|workspace-client" lib/mos/routes/publishing.js   # 期望：无输出
grep -rn "publishedContentArchive" lib/                                                            # 期望：两处，均 false / 清单项
bash tools/run-mos-tests.sh build06                                                                 # D6-13b：Provider 侧 false
```
