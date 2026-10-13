# UI_TEST_EVIDENCE —— 真实浏览器工作路径证据

> 对应 `02_MARKETING_OS_CODEX_TASK.md` **Phase M4**「`UI_TEST_EVIDENCE/`（可复现浏览器测试脚本和必要截图，**不暴露凭证**）」。
> 采集时间 **2026-10-13 19:52（GMT+8）** ｜ 基线提交 `3c19e79` ｜ 结果 **97/97 通过**

## 1. 目录内容

| 路径 | 说明 |
|---|---|
| `mos-ui-check.js` | **可复现的浏览器测试脚本**（零依赖，CDP 驱动真实 headless Chrome） |
| `ui-check-result.json` | 本次运行的逐条断言结果（97 条，含页面级有无未捕获异常/console error） |
| `screenshots/01-login.png` | 登录页 |
| `screenshots/02-force-password.png` | 首次登录强制改密闸门 |
| `screenshots/03-my-work.png` | My Work |
| `screenshots/04-workspace-my-work.png` | 工作中心组 1/8 Workspace / My Work |
| `screenshots/05-workspace-projects.png` | 工作中心组 1/8 Workspace / Active Projects |
| `screenshots/06-brand-overview.png` | 工作中心组 2/8 Brand Center / Brand Overview |
| `screenshots/07-brand-guidelines.png` | 工作中心组 2/8 Brand Center / Visual & Guidelines |
| `screenshots/08-brand-reference.png` | 工作中心组 2/8 Brand Center / Reference Library |
| `screenshots/09-planning-list.png` | 工作中心组 3/8 Planning Center / Monthly Planning |
| `screenshots/10-topics.png` | 工作中心组 3/8 Planning Center / Master Topics |
| `screenshots/11-intelligence.png` | 工作中心组 3/8 Planning Center / Intelligence |
| `screenshots/12-all-tasks.png` | 工作中心组 3/8 Planning Center / All Tasks |
| `screenshots/12-content-tasks.png` | 任务综合视图（同一 ContentTask 对象） |
| `screenshots/13-campaigns.png` | 工作中心组 6/8 Marketing Center / Campaigns |
| `screenshots/14-creative-stage.png` | 工作中心组 4/8 Creative Studio |
| `screenshots/15-publishing-stage.png` | 工作中心组 5/8 Publishing Center |
| `screenshots/16-analytics-stage.png` | 工作中心组 7/8 Analytics Center |
| `screenshots/17-governance-stage.png` | 工作中心组 8/8 Governance & Assets |
| `screenshots/18-planning-calendar.png` / `19-...-week.png` | 统一日历（月/周） |
| `screenshots/20-intelligence-sources.png` / `21-...-detail.png` | 来源登记表与来源详情（采集调度面板） |
| `screenshots/22-planning-created-by-ui.png` / `23-...-after-reload.png` | **UI 真实创建后刷新仍存在**（非前端假象） |
| `screenshots/24-intelligence-created-by-ui.png` / `25-...-after-reload.png` | 同上（情报侧） |
| `screenshots/99-error.png` | 异常兜底截图（本次为空白占位，无异常） |

> 八工作中心 = `workspace / brand / planning / creative / publishing / marketing / analytics / governance`，
> 已由 `public/mos/js/app.js` 的 `CENTERS` 定义并由本套件逐中心导航断言（含**页头文案比对**，避免"有标题即通过"的误判）。

## 2. 复现方式

```bash
# 前置：本机可用 Chrome/Edge；Node.js >= 18
cd <repo>
bash tools/run-mos-tests.sh ui        # 等价于：node tools/mos-ui-check.js
```

脚本自行：
1. 在**隔离数据目录**（`data-mos-*`）与**自测端口段 9600+** 启动一次性实例；
2. 用引导账号完成首登改密 → 登录 → 逐中心导航 → 断言**页头文案**与关键元素；
3. 断言**页面级无未捕获异常、无 console error**；
4. 输出截图到 `UI_EVIDENCE_MOS_BUILD01/` 并写 `ui-check-result.json`；
5. 跑完清理临时数据目录。

## 3. 凭证与合规声明

- 本目录**不包含任何口令、密钥、票据或会话 Cookie**；截图中的口令输入框为**首登改密前**的引导流程画面，**不显示明文口令**。
- 测试身份为**隔离实例内的合成账号**，与任何生产账号无关。
- `ui-check-result.json` 已剔除会话 Cookie 与凭据字段。

## 4. 未覆盖（BLOCKED）

以下浏览器路径**因缺外部依赖未执行**，不得视为已通过：

| 路径 | 阻断原因 |
|---|---|
| 企业资料库真实资产检索/引用页（真实数据） | 无真实服务与凭据 → 页面如实显示 `NOT_CONFIGURED` |
| AI 生成作业的成功态（真实出图/出稿） | 无模型凭据 → 页面如实显示 `NOT_CONFIGURED` |
| 真实渠道发布登记后的**平台侧**核验 | 无渠道沙盒账号 |
| 资产撤回后的缓存失效路径 | 需真实 `GET /changes` 与真实撤回事件 |
