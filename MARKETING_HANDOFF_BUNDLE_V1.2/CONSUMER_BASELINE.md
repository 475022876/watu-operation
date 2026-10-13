# CONSUMER_BASELINE —— Phase B0 基线锁定

> 日期：2026-10-13｜本侧：VFIB Marketing OS（运营中台，消费方）
> 依据：`VFIB_MarketingOS_Remediation_V1.2/B_Marketing_OS` Phase B0

---

## 1. 版本四元组

| 轴 | 本轮输入（基线） | 本轮实际 | 是否变更 | 单一来源 |
| --- | --- | --- | --- | --- |
| **应用版本** | `0.1.0` | **`0.1.1`** | ✅ 升版 | `package.json` / `lib/config.js:appVersion` / `lib/mos/config.js:MOS_VERSION`（三处**同源**） |
| **接口契约版本** | `1.0` | **`1.0`** | ❌ 未变 | `lib/mos/workspace-contract.js:CONTRACT_VERSION`；Provider `POLICY_VERSION` |
| **数据 schema 版本** | `v5` | **`v5`** | ❌ 未变 | `lib/mos/store.js:MOS_SCHEMA_VERSION`（**无新集合、无迁移**） |
| **整改执行包编号** | `V1.2` | `V1.2` | — | 仅表示交付规格书版本，**≠ API 版本** |

> **升版依据**：本轮**确有应用代码变更**（新增 `lib/mos/formalguard.js` 与 `POST /api/mos/formal-output-check`，
> 并修正 `POST /api/mos/generation-jobs` 对 `TEXT` 从不校验 `outputIntent` 的缺陷），
> 且已通过完整回归（`all` 546/546）与双系统真实联调（61/61）。故按 B 包 Phase B3 升 `0.1.1`。
> **不是**"仅测试变化的空版本升级"。

---

## 2. Git 基线与两端提交

| 侧 | 仓库 | 分支 | 提交 | 应用版本 |
| --- | --- | --- | --- | --- |
| **消费方（本侧，唯一改动方）** | `D:\运营系统\VFIB-Marketing-OS` → `475022876/watu-operation` | `main` | 基线 `259a91d` → 发布提交见 `docs/RELEASE_REGISTER.md` §1 | **0.1.1** |
| **提供方** | `D:\企业数据后台\oa-system-20261004\oa-system` | — | HEAD **`4cbfeef`**（`feat(v1.2): A 包 …` 链） | `package.json` 工作区为 `1.1.8`；其自述 V1.2 `RELEASE_REGISTER.md` 记 **本轮发布版本 `1.1.7`** |

### 2.1 提供方工作区状态（**如实记录，本侧未改动**）

本套件运行时，提供方仓库工作区存在**未提交**改动（由 A 包侧产生，**非本侧所为**）：

```
 M lib/config.js                        | 1 行：appVersion '1.1.7' → '1.1.8'
 M lib/integration/service-accounts.js  | 7 行：rotatePublicKey 增加「已撤销账户不可再轮换」终态校验
 M package.json                         | 1 行：version '1.1.7' → '1.1.8'
 M public/app.html                      | 5 行：版本显示
（另有若干文档 / UIEvidence 的新增与删除）
```

**对本轮结论的影响（诚实声明）**：

- 本侧 `build06` 运行时的提供方**运行期源码** = `4cbfeef` + 上述 3 个代码文件的未提交改动。
- 该改动**不削弱**任何负例结论：`rotatePublicKey` 的加固只让"已撤销账户"多一层拒绝，
  本套件 `D6-18` 的轮换负例使用的是**未撤销**账户（`SA3`），路径不受影响。
- `D6-56` 仅证明**本侧未改**提供方源码（`server.js` mtime Δ=0ms），不代表提供方工作区是干净的。
- 测试时刻关键文件 SHA256（供双方复核是否同一状态）：

| 文件 | SHA256 |
| --- | --- |
| `server.js` | `4379792c498b4539977161203e7ee18020c6ff214e50a757858689248b69b719` |
| `lib/routes/integrations.js` | `f44cd586cb82c1429fa64d27ccdf9f385729caeb21d36b733964903b5be3a2f0` |
| `lib/integration/service-accounts.js` | `a896398bbab602ccfa318e501d7e30a4e02697b240ade6e22d2721dcf78cc1e9` |
| `lib/config.js` | `6759b36933880a6d7d625fffd27b00f1aa8f785b9c7b42a085e882ad42d75657` |
| `package.json` | `494bde379020685b50cea61f483e172f3b0ad05caaa1d07043c8f961bbf705e4` |

---

## 3. 三方 OpenAPI 哈希一致性（契约冻结确认）

| # | 来源 | SHA256 |
| --- | --- | --- |
| 1 | V1.2 C 包 `C_Shared_Contract/PROVIDER_API_OPENAPI_BASELINE.yaml` | `cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3` |
| 2 | 本仓库副本 `docs/integration_three_pack_v1.1/C_Shared_Contract/PROVIDER_API_OPENAPI_BASELINE.yaml` | `cd3cc198…`（同） |
| 3 | 提供方 `LIBRARY_HANDOFF_BUNDLE_V1.1/PROVIDER_API_OPENAPI.yaml` | `cd3cc198…`（同） |
| 4 | 提供方 **`LIBRARY_HANDOFF_BUNDLE_V1.2/PROVIDER_API_OPENAPI.yaml` + 其 `OPENAPI_SHA256.txt`** | `cd3cc198…`（同） |

➡ **四处逐字节一致**，契约 **1.0** 冻结可确认，**无需重算契约基线**；本轮**未改**共享契约。

---

## 4. 运行与端口

| 用途 | 端口 |
| --- | --- |
| 运营中台（MOS）本机默认 | **9080** |
| MOS 自检/隔离实例 | 9500–9699 |
| 双系统真实联调（`build06` / `joint`）· MOS | 9550–9559（`joint`） / **9560–9569**（`build06`，实测 `9564`） |
| 双系统真实联调（`build06` / `joint`）· Provider | 9750–9759（`joint`） / **9760–9769**（`build06`，实测 `9765`） |
| 资料库（OA）默认 | 8080（本侧**不**使用其占用段） |

---

## 5. 自检基线

| 命令 | 本轮结果 |
| --- | --- |
| `bash tools/run-mos-tests.sh all`（11 套件） | **546/546** |
| `bash tools/run-mos-tests.sh build06` | **61/61** |
| `bash tools/run-mos-tests.sh joint` | **64/64** |
| `bash tools/run-mos-tests.sh all` + `build06` 汇总 | **671/671** |

> **口径说明**：`run-mos-tests.sh` 打印的「汇总」扫描**全部**证据目录；`all` 自身 11 套件为 546/546，
> 计入 `joint`（64）与 `build06`（61）后为 **671/671**。各套件明细见 `TEST_EVIDENCE_INDEX.md` §4。

> `joint` / `build06` 需同机存在资料库源码，**刻意不纳入 `all`**（避免他机 CI 假失败）。

---

## 6. 14 项联合验收：V1.1 → V1.2 变化

| ID | V1.1 报告 | **V1.2 本侧判定** | 依据（本轮） |
| --- | --- | --- | --- |
| INT-01 | PASS | **PASS** | 双独立进程 HTTP 证据保留（`build06` 双进程真实启动 `D6-00/01/31`）；跨主机 TLS 另作部署验收 |
| INT-02 | CONDITIONAL | **PASS** | `D6-14…D6-19`（过期/未来时间戳、nonce 重放、账号撤销、公钥轮换、伪造签名对照）+ 审计行对号 |
| INT-03 | CONDITIONAL | **PASS** | `D6-20…D6-28`（跨品牌×3、高密级两面向、internal 对照） |
| INT-04 | CONDITIONAL | **CONDITIONAL** | 合成授权主体仅证明控制机制；**真人**最终审批人 Staging 签认未完成 |
| INT-05 | PASS | **PASS** | `all` 546/546 回归 + `D6-41/45/46/47`（三必填字段、幂等、Asset ID、失败不可复用） |
| INT-06 | CONDITIONAL | **CONDITIONAL** | 门禁对 `REFERENCE_ONLY` **fail-closed 已验证**（`D6-53`）；但**无 EFFECTIVE 正式 Skill** 可正向验证 |
| INT-07 | PASS | **PASS** | `D6-49` 撤回 → 事件消费 → 本地引用 `permissionValid=false`；`D6-50/51` 门禁联动 |
| INT-08 | PASS | **PASS** | Published Archive 结构性隔离（见 `PUBLISHED_ARCHIVE_ISOLATION.md`） |
| INT-09 | BLOCKED | **BLOCKED** | SPECIAL-01 原件未到，41 项保持 PROVISIONAL（见 `BLOCKED_ITEMS_V1.2.md`） |
| INT-10 | BLOCKED | **BLOCKED** | Skill V1.2 无 Provider 真人批准与 EFFECTIVE（同上） |
| INT-11 | BLOCKED | **BLOCKED** | 无真实供应商非生产密钥与费用授权（同上） |
| INT-12 | PASS | **PASS** | `ui` 106/106 + 28 张真实浏览器截图归档 |
| INT-13 | CONDITIONAL | **CONDITIONAL** | 本侧全量回归已跑；**提供方全量回归与数据恢复演练本侧未复跑**，权限负例互认待双方确认 |
| INT-14 | CONDITIONAL | **CONDITIONAL** | 本侧 Release Register 已出；**双方真实签署未完成**，运行环境（Staging）确认待双方书面确认 |

**合计：PASS 7 / CONDITIONAL 4 / BLOCKED 3 / FAIL 0 → 联合验收 `CONDITIONAL`。**

> 不得以 `FAIL 0` 推定通过：3 项 BLOCKED 均为**外部输入未到**，只有实际补齐才可解除。
