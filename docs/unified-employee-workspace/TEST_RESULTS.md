# 统一工作区测试结果

执行日期：2026-11-03。Windows、Node 24.22.1、实际 Chrome。代码提交：`f69dba0`、`456b3a8`。最终结果与此前 P4 数字分别记录，不冒用历史结果。

| 本轮执行命令 | 通过 / 失败 | 证据 |
| --- | --- | --- |
| `node tools/unified/browser-test.cjs` | 40 / 0 | `evidence/browser/results.json` 与模块截图 |
| `node --test tools/unified/api-lifecycle-test.mjs` | 5 / 0 | `evidence/api-lifecycle.log` |
| `node tools/p3/browser-test.cjs` | 32 / 0 | `evidence/p4-flow/browser/results.json` |
| `node tools/p3/api-test.cjs` | 21 / 0 | `evidence/api/api-results.json` |
| `node tools/phase2/run-regression.js` | 17 套全部通过；880 / 0 | `evidence/regression/` |
| `node tools/phase2/run-phase1-regression.js` | 7 套退出码 0 | `evidence/phase1/` |
| `node tools/phase2/workspace-policy-test.js` | 22 / 0 | `evidence/workspace-policy.json` |
| `node tools/phase3a2/h05-version-reference-test.cjs` | 12 / 0 | `evidence/h05-version-reference.json` |

试点工具通过 `MOS_PILOT_EVIDENCE_DIR` 指向本目录相应子目录，防止覆盖 P3/P4 报告。`npm run build:pilot --prefix prototypes/employee-workspace` 类型检查及构建通过；没有新增依赖。旧证据在归档本轮结果后恢复原 Git 内容。

## 40 项浏览器检查的实际内容

六区/17 主入口、角色可见性、15 个既有主页面挂载、5 个关联工作页面、CSS 作用范围、无 iframe/重复侧栏、同平台多账号；实际活动创建与落盘、品牌切换、草稿到新制作面、站内提醒、自由文字选用保存、视频手工保存和未保存保护、PNG 上传、同一任务关联与审核附件保存；语言和手机宽度、操作中阻止切换、管理员撤权、外部网络与页面异常检查。

其中所有模型内容都是本地 Mock；PNG 是明确的合成测试图片，视频验证的是简报手工保存，不是真实模型渲染。合成账号、渠道登记及 DEMO 数据不是社媒授权。

## 首次失败及修复

首次扩展集成为 37 通过 / 1 失败，保存在 `first-integration-run.json`：视频选择同一任务仍触发异步加载，短时编辑可能被随后读取覆盖，未保存检查因此失效。修复同任务无操作、加载期间禁用旧表单及宿主/品牌/任务校验后通过；没有删除该失败检查。

后续又加强了带任务的图片保存、管理员撤权和角色增加不丢视频编辑，最终 40 项全部通过。`failure-*.png` 是开发过程证据，不是最终界面。最终模块截图由最后一次成功运行更新。

## 未执行

真实员工无指导体验验收、其他浏览器/真实手机/屏幕阅读器、真实搜索与大模型、图片/视频模型、真实 Workspace、社媒 OAuth 与自动发布、生产切换和 PG 业务迁移均未执行。不能将上述本机 API 与模拟服务结果称为真实外部联调完成。
