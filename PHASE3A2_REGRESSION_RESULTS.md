# Phase 3A-2 回归结果

日期：2026-10-28。测试对象：本分支 bbd3658 + H05提交5cd6a33 + PG基础设施64195fb及最终修订。测试全部使用隔离数据；外部付费服务关闭。

## 本轮实际执行

| 测试 | 命令 | 通过 | 失败 |
|---|---|---:|---:|
| PG18 Schema/事务/安全 | node tools/phase3a2/run-foundation.cjs | 100 | 0 |
| 原有17套业务回归 | node tools/phase3a2/run-regression.cjs | 880 | 0 |
| Phase1七组 | node tools/phase3a2/run-security-regression.cjs | 57 | 0 |
| Phase2六组 | 同上 | 53 | 0 |
| 新H05负例 | 同上，亦可单跑 test:h05 | 12 | 0 |
| 受控清理辅助测试 | node tools/phase3a2/cleanup-test.cjs | 2 | 0 |

前五行共1102项，清理工具另列2项。PG分组：Schema42、事务13、安全45。历史Phase2的990项不纳入。

原17套逐套计数：unit76、smoke15、egress17、scheduler20、provider-contract26、provider-admin70、workspace-contract36、dual-identity51、e2e48、build02 63、build03 96、v012-research55、v012-editorial43、v013-studio29、v013-research79、i18n21、UI135；合计880。每套退出0，原始日志在 regression/，日期/耗时见 summary.json。

security-regression/ 保留14脚本日志及当前合成JSON/截图。原UI实际启动浏览器检查135项；H07浏览器5项及M05浏览器2项也重新执行，截图分别归档。浏览器测试没有操作生产账号、真实素材或线上服务。browser-original-ui/ 为本轮员工操作页面截图。

## 功能保护

对比基线，server.js、JSON store/config、业务路由、前端、权限字典及正式 Workspace 接口没有修改；业务代码变化仅 H05 字段修复。新增 PG 目录没有被业务启动链导入。package version 0.1.6，schema8 未迁移。

Master Topic、两种日历、市场情报、AI制作、视频、Provider预算账本、多品牌、内容版本/专业审核/发布审批、资料消费者及资产入库均保留原实现与相应回归。测试通过不等于其中所有外部模型/社媒功能已经真实上线。

## 失败和未执行

最终当前测试无失败。原SQL草案42501、初版loader重复执行、首轮75/76断言差异，均保留失败证据并在Schema/事务报告解释，不改写为历史全通过。

未执行：生产数据库/JSON迁移、真实Workspace端到端、付费AI、社媒发布、生产验收、HA/PITR、远程TLS和跨平台负载。模拟模型/隔离消费者通过只标为本地或隔离集成通过。

## 回滚

没有切换业务存储；停止临时集群即可。回归脚本可能更新旧证据路径，本轮结果已复制到 generated-current/，旧历史文件已恢复。正式生产回滚仍需未来切换方案单独审批。
