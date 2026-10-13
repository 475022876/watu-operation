# SECURITY_REGRESSION.md —— 全量测试 · 安全回归 · 备份与恢复

> 交付包：`MARKETING_HANDOFF_BUNDLE_V1.1/`
> 依据：B 包 B8（浏览器与安全回归）+ `03_HANDOFF_AND_REPORT.md` 第 10 项
> 对应验收：**`INT-12`**（P1–P4 浏览器）、**`INT-13`**（两边完整回归、安全及备份恢复）
> 日期：**2026-10-13**

---

## 0. 结论

| 项 | 结果 |
|---|---|
| **全量回归** | **`610 / 610` 断言通过**（12 个套件，failed = 0） |
| **安全套件（SSRF / 出站收敛）** | **`17 / 17`** |
| **浏览器实测（真实 Chrome/Edge via CDP）** | **`106 / 106`**；**22 张截图**（见 `UI_BROWSER_EVIDENCE/`） |
| **双系统真实 HTTP** | **`64 / 64`** |
| **备份与恢复** | ✅ 机制已验证（原子落盘 + 迁移前备份 + 损坏自动备份重建 + 口令重置） |

**总入口**：

```bash
bash tools/run-mos-tests.sh all          # 11 套件（不含 joint）
bash tools/run-mos-tests.sh joint        # 第 12 套件（需同机存在资料库源码）
```

---

## 1. 全量回归明细（`INT-13` 本侧部分）

证据目录：`TEST_EVIDENCE_MOS_BUILD01/summary.json`（汇总）+ 各套件独立 JSON。
汇总时间：**2026-10-13T14:21:46.653Z**。

| 套件 | 命令 | 断言 | 通过 | 证据文件 |
|---|---|---|---|---|
| `smoke` | `run-mos-tests.sh smoke` | 13 | **13** | `BUILD01/smoke-result.json` |
| `unit` | `unit` | 75 | **75** | `BUILD01/unit-result.json` |
| `sec` | `sec` | 17 | **17** | `BUILD01/security-egress-result.json` |
| `sched` | `sched` | 20 | **20** | `BUILD01/scheduler-result.json` |
| `provider` | `provider` | 21 | **21** | `BUILD01/provider-contract-result.json` |
| `workspace` | `workspace` | 36 | **36** | `BUILD01/workspace-contract-result.json` |
| `dual` | `dual` | 51 | **51** | `BUILD01/dual-identity-result.json` |
| `e2e` | `e2e` | 48 | **48** | `BUILD01/e2e-result.json` |
| `e2e02` | `e2e02` | 63 | **63** | `BUILD02/e2e-build02-result.json` |
| `e2e03` | `e2e03` | 96 | **96** | `BUILD03/e2e-build03-result.json` |
| `ui` | `ui` | 106 | **106** | `BUILD01/ui-check-result.json` |
| **`joint`** | `joint` | **64** | **64** | `BUILD04/dual-e2e-result.json` |
| **合计** | — | **610** | **610** | `summary.json → ok: true` |

> 相比上一版基线（**472/472**），本轮新增/扩展：
> `unit 69→75`、`workspace 30→36`、`dual`（新套件 51）、`joint`（新套件 64）、`ui 97→106`。

**退出码契约**：任一子套件失败 → `run-mos-tests.sh` 退出码非 0（可接 CI）。
**「失败数为零」不等于通过** —— 每个套件内均含**阴性对照**（见 §3）。

---

## 2. 安全套件（`sec` 17/17）逐条

`tools/mos-security-egress-test.js` —— 针对 **SSRF / 出站收敛 / 提示注入**：

### 2.1 出站拒绝矩阵

| 断言 | 覆盖 |
|---|---|
| `SEC-11` | 回环 / 私网 / 云元数据 / IPv6（**含 IPv4-mapped**）/ 非白名单 / `http` / 非标准端口 → **全部拒绝** |
| `SEC-11b` | **生产模式**：测试放行开关（`http` / `loopback`）**一律失效** |
| `SEC-11c` | **生产模式**下 `egressTestFlags` **全为 false** |

### 2.2 重定向逐跳校验（防「合法首跳 → 恶意次跳」）

| 断言 | 覆盖 |
|---|---|
| `SEC-13` | 前置：本地测试源通过出站校验（含**已校验 IP**） |
| `SEC-13a` | 合法**同源**跳转**被跟随**（不是一律拒绝 — 证明校验是真实的，不是拦住一切） |
| `SEC-13b` | 跳转到**非白名单域名** → 拒 |
| `SEC-13c` | 跳转到**云元数据地址** → 拒 |
| `SEC-13d` | 跳转到**私网地址** → 拒（**即使当前跳为同源**） |
| `SEC-13e` | 跳转次数**超上限** → 拒（防重定向环） |

### 2.3 DNS 重绑定 / 上游异常 / 提示注入

| 断言 | 覆盖 |
|---|---|
| `SEC-12` | **DNS 重绑定**：连接**固定绑定已校验 IP**（解析器不再被二次调用，连接未被改指） |
| `SEC-14a` | 上游 **5xx**：**如实返回失败**（`ok=false, items=[]`），**不伪造成功** |
| `SEC-14b` | 私网端点：**直接判定 SSRF 阻断**，**不发起任何请求**（零出站） |
| `SEC-16a` | 上游返回**压缩编码** → 拒（不解压，杜绝**膨胀炸弹**） |
| `SEC-16b` | 响应体**超上限** → 截断拒绝（体积上限生效） |
| `SEC-15a` | **注入文本被当作普通数据解析**（进入条目，**不产生任何指令副作用**） |
| `SEC-15b` | 注入条目的 `canonicalUrl` **追踪参数被剥离**（按数据规范化处理） |
| `SEC-15c` | 解析过程**未污染进程全局状态**（无提示注入执行面） |

---

## 3. 阴性对照（跨套件，「不是自说自话」的证明）

| 类别 | 断言 | 期望失败 | 结果 |
|---|---|---|---|
| 签名伪造 | `joint D4-07` | `401 BAD_SIGNATURE` | ✅ |
| 服务身份越权最终审批 | `joint D4-30` | `403 TICKET_KIND_MISMATCH` | ✅ |
| 未映射用户 | `joint D4-26` | `NO_PROVIDER_USER_MAPPING`（零出站） | ✅ |
| 缺 `fileName` 出站前拦截 | `dual D-24b` | 零出站 | ✅ |
| `reuseScope` 缺失 / `none` | `dual D-24d` | 零出站 | ✅ |
| 许可 `expired` / `unknown` | `unit U-16b5` | 预检 FAIL | ✅ |
| 未知事件类型 | `dual E-06` | 置 `reconcileRequired`（**不静默忽略**） | ✅ |
| 未批准 Skill 正式输出 | `unit` | `outputIntent` **失效关闭** | ✅ |
| 跨品牌票据复用 | `dual D-13` | 拒绝 | ✅ |
| SSRF 全类目 | `sec SEC-11/13b–13e/14b` | 全拒 | ✅ |
| 提示注入 | `sec SEC-15a` | 无副作用 | ✅ |

---

## 4. 浏览器实测（`INT-12`）

| 项 | 值 |
|---|---|
| 驱动方式 | 真实 Chrome / Edge，经 **CDP**（`tools/mos-ui-check.js`） |
| 断言 | **106 / 106** |
| 截图 | **22 张**（本次运行），索引见 `UI_BROWSER_EVIDENCE/README.md` |
| 场景覆盖 | 登录 / 强制改密 / 我的工作 / 工作区 / 品牌总览 / 品牌规范 / 参考资料 / 规划 / 议题 / 情报 / 全部任务 / 战役 / 日历（月·周）/ 情报源（列表·详情）/ 规划与情报**落盘后再载** / **准入对话框（B1-38）** |
| **UI 断言硬要求** | `navigate()` 对未知路由会**静默早返回** → 断言**必须比对期望页头**（只查「有标题」会误判通过） |
| 失败路径 | 浏览器缺失时**按失败计**（不静默跳过） |

**本轮新增 UI 断言（B1 组）**：

| 断言 | 内容 |
|---|---|
| `B1-38` | 准入对话框：`reuseScope` **不预选 `none`**；含 D-06.5 / D-06.4 警示 callout；下拉标签「复用范围（**必填 · 不得为 none**）」 |
| 前端同构拦截 | `reuseScope` 空 → toast「请选择复用范围（必填）」；`none` → toast「该状态无法重提，申请将永久卡死」；`licenseStatus ∈ {unknown,expired}` → toast「需先补齐许可信息」 |

---

## 5. 备份与恢复（`INT-13` 要求）

### 5.1 数据落盘原子性（`lib/mos/store.js`）

| 机制 | 实现 |
|---|---|
| **唯一临时名** | `dataFile + '.' + pid + '.' + seq + '.tmp'` |
| **原子替换** | **回调内同步 `renameSync`**（用异步 rename 会让在途旧快照覆盖新快照 → **丢数据**；已在 BUILD-01 修复，**勿回退**） |
| **写入序号防回退** | 单调 `seq` 校验，拒绝旧快照覆盖 |
| **写前校验** | 关键校验与替换收口为**原子动作** |
| **崩溃残留清理** | `cleanupStaleTmp()` 启动时清理 `*.tmp` |
| **防抖** | 60ms 防抖（**停进程前必须等 ≥1s** —— Windows `SIGTERM` 为硬终止；测试用 `await sleep(1200)`） |

### 5.2 迁移前备份

| 机制 | 实现 |
|---|---|
| 版本迁移**只增不改**、**幂等** | `migrate()`（v1→v2→v3→v4→**v5**） |
| 迁移前生成 `data/mos.json.bak-*` | 可整体还原 |
| **回滚路径** | 停服后还原 `data/mos.json.bak-*`；或把 `mosSchemaVersion` 改回旧值 + 删除新增集合字段（旧版代码不读该集合，**可直接运行**） |
| **损坏自动处置** | `mos.json` 解析失败 → 自动备份为 `mos.json.broken-<ts>` 并重建（**不会静默丢数据**） |

**v4 → v5 迁移内容**（本轮新增）：`library_tickets` / `library_event_cursors` / `library_invalidations` / `library_admission_jobs`。
回滚细则见 `ADMISSION_FIELDS_UI_DATA_MIGRATION.md` §5。

### 5.3 凭据恢复

| 场景 | 正解 |
|---|---|
| 引导管理员口令丢失 | `tools/mos-reset-password.js`（**保留业务数据**；**先停服再跑**） |
| 需要改名 | 同工具 `--rename <旧账号>:<新账号>`（**只改登录名，保留 `user.id` 与 `user_roles`**，吊销旧会话 + 落审计） |
| 口令策略 | **「至少 8 位」是全局安全基线，三处一致强制**（重置工具 / `identity.changePassword()` / `identity.upsertUser()`）—— **勿为方便放宽** |

### 5.4 密钥与凭据卫生

| 机制 | 实现 |
|---|---|
| 口令**只存 scrypt 哈希** | `data/mos.json`（**不可逆推**） |
| 初始口令**只打印一次** | 首启时打印；**不落盘、不落日志** |
| 一次性凭据防回灌 | `loadDb()` 中 `delete db._initialPasswordOnce / _demoCredentialsOnce`（防御性清除） |
| 密钥扫描 | `tools/secret-scan.js`（交付包/源码包交付前跑） |
| **从不打印**私钥/票据/口令 | 证据脱敏正则 `SECRET_KEY_RE` + 长 base64 兜底 |

---

## 6. 隔离性证明（测试不污染真实数据）

| 机制 | 实现 |
|---|---|
| 每个子套件**独立数据目录** | `MOS_DATA_DIR` 指向临时目录 |
| **运行期随机口令** | 每套件独立生成，互不干扰 |
| **`MOS_DATA_DIR` 隔离曾被捕绕过**（A-09，已修） | `lib/mos/config.js getMosConfig()` **必先**调用 `lib/config.js getConfig()`；**勿回退** |
| `joint` 双系统 | MOS 临时目录 + Provider 独立目录；运行后**均清理**（`D4-48` 校验 `data/` 未被触碰） |
| 端口互斥 | MOS 9080 / 自测 9500–9699 / **B4 双系统 MOS 9550–9559 + Provider 9750–9759**；OA 占用段不重叠 |

---

## 7. 未完成 / 未验证

| 项 | 状态 | 说明 |
|---|---|---|
| **两边**完整回归（Provider 侧 `run-tests-v113.sh`） | `REAL_NOT_VERIFIED` | 见 Provider `BLOCKERS.md` `B-3`：本轮 Provider 为**单侧**；本侧不代跑、不代签 |
| 跨主机 / TLS 下的安全回归 | `NOT_RUN` | 需真实 TLS 环境（Provider `B-5`） |
| 生产部署态安全验证 | `NOT_RUN` | 用户明令**不得部署生产**（Provider `B-6`） |
| 备份**定时任务**（cron / 保留策略） | `NOT_RUN` | 当前为手动/迁移时自动；生产需另行设计 |
| 离线**恢复演练**（真实还原 + 校验） | `NOT_RUN` | 回滚路径已在文档中给出，但未做一次端到端演练 |
| 依赖漏洞扫描（SCA） | `NOT_APPLICABLE` | **零第三方依赖**（仅 Node 内置模块） |

> ⚠ 按 C 包 `04` 节原文：「**不得只引用单方报告**」。故 `INT-13` 本侧记「本侧 PASS + 联合项 `REAL_NOT_VERIFIED`」，
> **最终状态由双方会同确认**。
