# 六区统一员工工作区

日期：2026-11-03。分支：`codex/unified-employee-workspace`。基线：`0133cc3e9ae07b714f616a4e244de99150267eca`。

本轮解决 P4 只露出任务和审核、无法试用整个平台的问题。六区共 17 个主要入口，以及选题、日历、品牌营销、资产治理等关联页面，挂载在同一个 React 工作区；没有 iframe，没有复制第二套任务库，也不要求跳回多个旧页面完成这些操作。

这是现有能力整合后的完整试用入口，不代表每个页面已全部重新设计或外部模型/社媒已接通。

## 打开与账号

http://unified.localhost:9106/employee-pilot/pilot.html

| 账号 | 用途 |
| --- | --- |
| `pilot_admin` | 六区全部 17 个主要入口、AI 配置状态与平台账号管理 |
| `pilot_maker` | 日常制作、活动、文字、图片素材、视频工作区与送审 |
| `pilot_professional` | VFIB 专业审核 |
| `pilot_publisher` | VFIB 发布审批 |
| `pilot_other` | 仅 UCARD 的权限负例 |

共用公开测试口令：`PilotTest2026A!`。账号只存在于隔离临时数据库，不是正式凭据。不同角色用独立浏览器配置登录；普通制作员工不会获得管理员入口或审批特权。

## 运行

仓库根目录（本轮 Node 24.22.1）：

```powershell
npm ci --ignore-scripts --prefix prototypes/employee-workspace
npm run build:pilot --prefix prototypes/employee-workspace
node tools/unified/preview.cjs
```

运行器复制源码和 public 资源到新建临时目录，不复制原配置、业务库、素材或密钥。它包含系统自带的 DEMO 数据，以及带“合成试用”标记的活动、选题、计划、任务、审核反馈和人工发布渠道登记。没有真实客户或金融事实，没有社媒登录。进程限制外部网络，不能在此验证收费 AI 或真实全网研究。

现有 9083、P2 9094、P3 9095、P4 9104 入口不被替换。当前 9106 服务已更新构建文件且未重置试用库，见 `evidence/preview-refresh.json`。

阅读 [操作步骤](MANUAL_TRIAL.md)、[能力与边界](CAPABILITY_MATRIX.md)、[测试报告](TEST_RESULTS.md)、[实现与回滚](IMPLEMENTATION_AND_ROLLBACK.md)。
