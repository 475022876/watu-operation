# P2 员工工作区交互原型

独立分支 `codex/employee-experience-p2`，起点 `c5127952fa7d9e627846bb5299fd521d44dcc6f3`。当前 Marketing OS V0.1.6 业务源码及正式 JSON 存储均未切换。

## 本地运行

在本目录使用 Node 22.12+（本次实际 Node 24.22.1）：

```powershell
npm ci --ignore-scripts
npm run build
npm run preview
```

打开 http://p2.localhost:9094/#/tasks 。无需账号密码。顶部“演示情境”可切换合成人员、故障场景及重置演示数据。不要输入真实资料、密钥或客户数据。独立主机名避免复用原 MOS 主机 Cookie；静态服务无业务代理，页面 CSP 禁止网络连接。

## 试用顺序

1. 我的任务 → 继续制作，查看任务要求。
2. 讨论两轮 → 选择一个候选作为当前作品 → 编辑、保存。
3. 提交选定作品审核，确认聊天记录没有进入作品。
4. 切换专业审核员，退回并填写意见；切回作者修改重提。
5. 分别完成专业审核和发布审批，核对“已通过”仍未发布。
6. 演示情境分别选择保存 409 / 500 / 离线 / 结果未知，验证草稿保留、旧版本不可送审。

品牌、人员、权限、文件、AI、保存和审核均为本地模拟。文件只收集元数据，不读取文件正文；模拟生成没有调用模型。不连接 Workspace、MOS API、真实数据库或社媒。sessionStorage 仅保存本标签页合成数据，关闭标签页可能丢失。

## 验证

```powershell
node --test tests/model.test.mjs
node tools/browser-test.mjs
node tools/isolation-test.mjs
```

浏览器与隔离测试从仓库根目录运行；浏览器脚本启动独立 Chrome 配置和本地静态服务。详见 `../../docs/p2-employee-experience/TEST_RESULTS.md`。本原型没有完成真实员工可用性验收，也不是生产权限实现。
