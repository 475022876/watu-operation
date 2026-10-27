# Phase 2 业务回归矩阵

日期：2026-10-27。分支：`baseline/consolidation-phase2`。业务修复最终提交：`e21da0a`；最后专项测试提交：`bf27962`；报告和原始证据为本分支后续归档提交。

功能主干为 `3d738981eb484a96b2a80d57608496800eacfa29`；第一阶段代码为 `6db3c0d1d1a80543c22138e3d4d4a89fd0b698d2`，报告归档与完整回滚点为 `319c5b3f357a8bfc077554e0f95b8ff00c3798df`。已核实提交祖先关系、原树及第一阶段工作树 clean 后创建独立第二阶段工作树。应用保持 **0.1.6 / schema8**。

工作树：`C:/Users/three/.codex/worktrees/baseline-consolidation-phase2/VFIB-Marketing-OS`。所有数据实验使用操作系统临时目录中的合成数据；未读取配置用于真实模型调用，未更改生产数据、密钥、Enterprise Workspace、双系统正式契约或历史分支。未部署、发布、推送 GitHub 或进入第三阶段。

命令中的 `$node` 指 `C:/Users/three/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`（v24.19.0），从上述工作树执行。JSON、原始日志及截图均在 `TEST_EVIDENCE_PHASE2/`。

## 保留能力与证据

|必须保留能力|相关验证|结果及边界|
|---|---|---|
|Master Topic、派工、多品牌权限|unit、build02、v012-editorial、H01/H02|通过；含跨品牌幂等与撤权派工负例|
|市场情报、来源、研究|scheduler、v012-research、v013-research、M05组件与Chrome|通过；搜索/研究外部服务为本地桩或未配置阻断|
|内容日历、发布日历|v012-editorial、build02、ui-check|通过；未调用真实社媒|
|内容版本、文案制作|build02、H03、H07组件/HTTP/Chrome|通过；409/500/断网保留草稿且不提交旧版本|
|AI图片、Provider管理|provider-contract、provider-admin、H04、H05-adapter|通过；图片真实API未验收|
|视频工作区、视频制作路由|v013-studio、ui-check、H05-video负例|通过；真实视频生成/下载未验收|
|专业审核、发布审批及版本绑定|build02、build03、H03/H07|通过；并不意味着剩余异步审批写入已获得事务保障|
|预算及调用账本|provider-admin、provider-contract、v013-research|通过；原有预算/费用回执诚实性保留|
|企业资料库消费者接口、用户映射|workspace-contract、dual-identity、H05|通过本地桩；当前正式契约和客户端未改|
|正式资产入库机制|build03、workspace-contract、dual-identity|通过本地桩；未修改企业资料库及其最终批准权限|
|中英文与原有页面|i18n-check21、ui-check135|通过；截图见generated-current/UI_EVIDENCE_MOS_BUILD01|
|历史审计、持久化与恢复|unit、build03、H03、H06、rollback|通过本阶段范围；异步账本及审计持久化风险仍登记|

## 第一阶段不回退

H01仍绑定Actor/Brand/Proposal/Normalized Payload并在冲突409；H02仍读取当前负责人品牌content.edit权限；H03原有显式atomicMutation覆盖不减少；H07保存失败保留草稿并终止旧版本锁定/送审。对应57项回归全部通过。

## 代码与数据完整性

`integrity.json`对原工作树429个文件、第一阶段工作树529个文件核对摘要，未变化、HEAD及状态未变化；正式契约、Workspace适配器/客户端/事件消费者、审核、发布、入库模块及package.json与319c5b3相同。创作和视频路由仅逐项增加外发上下文，没有目录替换、功能移除或版本升级。保留能力以这些测试和差异为证，不声称所有V0.1.6功能均已完成真实生产验收。

```powershell
& $node tools/phase2/run-regression.js              # 17套880通过
& $node tools/phase2/run-phase1-regression.js       # 57通过
& $node tools/phase2/browser-intelligence-test.js    # 2通过
 git diff --check 319c5b3 HEAD
 git diff --stat 319c5b3 HEAD
```

未决：真实供应商/Workspace/社媒联调、生产容量及跨进程写入、断电恢复、剩余事务风险。未删减已授权业务能力；安全阻断的未知密级或无外发授权内容不属于功能验收通过。

## 验证分层及共同限制

- 本地模拟/组件：H04 安全 13/13，H05 策略 22/22、真实适配器入口负例 3/3，H06 加载/恢复 7/7，M05 组件 6/6。
- 隔离服务集成：原有 17 套回归 880/880；第一阶段保护回归 57/57（其中真实 Chrome 草稿流程 5 项）。第二阶段真实 Chrome 品牌切换 2/2。第二阶段专项合计 53/53；加上上述回归共 990 个断言/用例通过，不代表 990 个独立业务场景。
- 真实外部服务：**NOT VERIFIED / BLOCKED**，未调用真实模型、搜索、企业资料库服务或社媒服务。Workspace 策略测试替身、HTTP 本地桩、TLS 请求参数替身均明确区分，不能作为真实供应商验收。
- 生产验收：**未执行，待人工审核**。仍有异步持久化及跨文件/跨服务一致性风险，见存储风险清单。备份依赖当前 Windows 用户的 DPAPI；不能证明跨机器灾备。
