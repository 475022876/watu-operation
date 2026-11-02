# P4 稳定与试用准备

日期：2026-11-02。分支 `codex/employee-experience-p4`，起点 `95c24deaff853eb310deea0f99953fcb8d0a0f88`。代码提交 `82f473b6a8ce343a2e264d9cf9fc7bf815ce2a66`。

状态：技术稳定性检查完成，等待真实员工试用和人工验收。没有替换原入口、生产部署或自动进入下一阶段。应用仍是 V0.1.6、schema8 JSON。

## 隔离预览

仓库根目录执行（本轮实测 Node 24.22.1，原型子目录依赖未变化）：

```powershell
npm ci --ignore-scripts --prefix prototypes/employee-workspace
npm run build:pilot --prefix prototypes/employee-workspace
node tools/p4/preview.cjs
```

地址：http://p4.localhost:9104/employee-pilot/pilot.html 。使用独立临时服务、合成数据和本地 Mock Provider；不读取原业务数据库、配置、素材和生产密钥。旧 P3 / P2 服务不被替换。普通业务服务器的 Node 最低要求未改；本轮试点构建与工具使用上述实际验证环境。

合成测试账号：`pilot_maker`（制作）、`pilot_professional`（VFIB 专业审核）、`pilot_publisher`（VFIB 发布审批）、`pilot_other`（仅 UCARD）。共用公开测试口令 `PilotTest2026A!`，不是正式凭据。不同人员请用独立浏览器配置登录；同一配置中的标签页共享登录 Cookie。

## 报告

- [改动与保留边界](P4_CHANGELOG.md)
- [12 项旧 UI 失败核对](P4_LEGACY_UI_RECONCILIATION.md)
- [本轮测试结果](P4_TEST_RESULTS.md)
- [键盘、语言与窄屏](P4_ACCESSIBILITY_AND_LOCALE.md)
- [入口切换演练及回滚](P4_CUTOVER_AND_ROLLBACK.md)
- [员工试用记录表](P4_EMPLOYEE_TRIAL.md)

本轮试点与稳定性检查 97 项通过，原有 17 套 880 项通过。真实 AI、Workspace、社媒、生产与员工无指导试用均未验收，不能用自动通过数替代它们。
