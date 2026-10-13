# UI_BROWSER_EVIDENCE —— 真实浏览器操作证据

> 采集方式：**真实 Chrome + CDP**（`tools/mos-ui-check.js`），非无头截图工具伪造。
> 采集时间：**2026-10-13 22:20（+08:00）**，与 `ui` 套件 **106/106** 通过同一次运行。
> 采集对象：本机隔离实例（`MOS_DATA_DIR` 指向临时目录，**`data/` 未被触碰**）。
> 结论：**本目录只包含同一轮运行的截图**；不含任何历史遗留图（已剔除）。

---

## 1. 为什么这些截图能作为 B8 的证据

| 要求（B8 / INT-12） | 本目录如何满足 |
|---|---|
| 真实浏览器 | `mos-ui-check.js` 启动真实 Chrome 并通过 DevTools Protocol 驱动（非 JSDOM/非 HTTP 断言） |
| 真实点击 | 所有流程走 **真实 DOM 事件**（`Input.dispatchMouseEvent` / `insertText`），不是直接调后端 API |
| 关键截图 | 见 §2 索引 |
| 失败路径 | 见 §3（表单必填拦截、口令策略拒绝、治理页拒绝态） |
| 无浏览器时记 `NOT_RUN` | 本轮**有**浏览器，故为 `PASS`（INT-12） |

---

## 2. 截图索引

| 文件 | 对应验收点 | 说明 |
|---|---|---|
| `01-login.png` | INT-12 / 认证 | 登录页 |
| `02-force-password.png` | 安全基线 | 首登强制改密（口令策略真实生效） |
| `03-my-work.png` | P1 任务 | 我的工作台 |
| `04-workspace-my-work.png` | 八工作中心 | 工作区 · 我的工作 |
| `05-workspace-projects.png` | 八工作中心 | 工作区 · 项目 |
| `06-brand-overview.png` | 品牌中心 | 品牌总览 |
| `07-brand-guidelines.png` | 品牌中心 | 品牌规范 |
| `08-brand-reference.png` | 品牌中心 | 品牌语料库 |
| `09-planning-list.png` | P1 策划 | 策划列表 |
| `10-topics.png` | P1 选题 | 选题库 |
| `11-intelligence.png` | P1 情报 | 情报中心 |
| `12-all-tasks.png` | P2 内容 | 全部任务 |
| `13-campaigns.png` | P3 营销活动 | 活动列表 |
| `18-planning-calendar.png` | P1 排期 | 月历视图 |
| `19-planning-calendar-week.png` | P1 排期 | 周视图 |
| `20-intelligence-sources.png` | P1 情报源 | 来源登记表（含「MANUAL / 不自动」标识） |
| `21-intelligence-source-detail.png` | P1 情报源 | 来源详情（采集入口，失败如实降级） |
| `22-planning-created-by-ui.png` | **UI 真实写入** | 通过**界面**创建策划条目（不是 API 直写） |
| `23-planning-after-reload.png` | **持久化** | 刷新后仍在（证明真实落盘） |
| `24-intelligence-created-by-ui.png` | **UI 真实写入** | 通过**界面**创建情报条目 |
| `25-intelligence-after-reload.png` | **持久化** | 刷新后仍在 |
| **`B1-38-admission-dialog.png`** | **B1 / INT-05** | **准入申请表单**：资料区 / 二级目录 / 密级 / 许可状态 / 复用范围 / 外部 AI 策略六个下拉，**全部选项来自契约端点**，且复用范围**不预选 none** |

> `B1-38-admission-dialog.png` 是 B1 的核心 UI 证据，与 `ADMISSION_FIELDS_UI_DATA_MIGRATION.md` 配套。

---

## 3. 失败路径与拒绝态（由 `ui` 套件断言，非截图）

| 场景 | 断言 |
|---|---|
| 准入表单缺必填项 | 前端拦截：对话框**不关闭** + toast 文案匹配；取消后**无残留遮罩** |
| 复用范围选 `none` | 前端拦截并说明「会退回修订且无法重提」（D-06.5） |
| 许可状态选 `unknown` / `expired` | 前端拦截并说明「无法完成准入，需补充许可信息」（D-06.4） |
| 资料区→二级目录联动 | 选项随资料区变化，且**全部属于所选一级区** |
| 口令策略 | 弱口令被拒（`02-force-password.png` 对应流程） |
| 页面级异常 | 断言「无未捕获异常」「无控制台 error 输出」 |

---

## 4. 复现命令

```bash
bash tools/run-mos-tests.sh ui
# 截图输出：UI_EVIDENCE_MOS_BUILD01/
```

> 若本机无 Chrome/Chromium，该套件会**如实失败并提示**，不会静默跳过。
