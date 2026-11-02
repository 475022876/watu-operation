# P2 测试结果

执行日期：2026-11-02。运行环境：Windows、Node 24.22.1、本机 Chrome；分支 `codex/employee-experience-p2`。

## 最终执行结果

| 范围 | 命令（仓库根目录） | 结果 | 证据 |
| --- | --- | --- | --- |
| 模拟模型单元测试 | `node --test prototypes/employee-workspace/tests/model.test.mjs` | 49 通过 / 0 失败 | `evidence/model-tests.log` |
| 真实 Chrome 操作本地模拟应用 | `node prototypes/employee-workspace/tools/browser-test.mjs` | 35 通过 / 0 失败 | `evidence/browser/results.json`、截图 |
| 静态服务隔离 | `node prototypes/employee-workspace/tools/isolation-test.mjs` | 10 通过 / 0 失败 | `evidence/isolation-tests.json` |
| 类型检查与构建 | `npm run build --prefix prototypes/employee-workspace` | 通过 | `evidence/build.log` |
| 依赖漏洞核对 | `npm audit --json --prefix prototypes/employee-workspace` | 0 已报告漏洞 | `evidence/npm-audit.json` |

合计 **94 个自动检查通过**，不包含构建和审计，也不借用历史业务测试结果。浏览器执行时间及逐例结果见 JSON；例名描述了实际检查内容。

## 主要覆盖

保存 409、500、离线、未知已保存/未保存；保存中继续编辑；明确冲突比较与草稿恢复；跨品牌/人员草稿隔离；旧生成响应不覆盖当前品牌；附件授权、可读性与请求使用分离；作者不可自审；专业审核和发布审批独立；退回需要意见；修订不继承旧审批；未知审批结果不自动重复；双语切换不改作品正文；移动端无横向溢出；焦点圈定与 Escape 恢复；本标签页刷新恢复；输入 HTML 不执行。

静态服务测试包含 API 拒绝、POST 拒绝、目录穿越拒绝、源码/配置不暴露、外部 Host 拒绝、安全响应头、无会话签发及运行时许可证可访问。浏览器记录仅包含本地静态请求，未发生业务或外部服务调用。

## 开发中发现并修复

初次模型测试 42/43 通过，自由创作保存到任务时空标题问题已修复。初次浏览器测试 18/29 通过；事件值在离开确认之后读取导致情境/品牌错误，以及空已保存作品比较异常，均已修复。第二次 26/29 通过，补足刷新后等待新页面及对话框焦点测试操作。后续扩展用例最终 35/35 通过。早期失败结果和 `failure-*.png` 保留用于追溯，不是最终截图。测试清理临时 Chrome 配置的占用错误已通过等待退出和重试处理。

## 未执行 / 不应视为通过

- 真实员工无指导试用、屏幕阅读器及真实手机软键盘验收。
- 实际 AI、Workspace、数据库、社交媒体、生产权限或生产网络验收。
- 原有 17 套完整业务回归：本轮未运行，原业务源码未修改；不能据此声明真实业务已经完成全面回归。
- 服务端幂等、生产并发、生产恢复：本轮仅模拟交互，尚未实现。

建议人工按原型 README 顺序试用，并记录任务完成时间、卡点、错误理解及无需解释即可完成的比例，再决定 P3。
