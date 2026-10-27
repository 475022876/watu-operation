# Phase 2 安全整改说明

日期：2026-10-27。分支：`baseline/consolidation-phase2`。业务修复最终提交：`e21da0a`；最后专项测试提交：`bf27962`；报告和原始证据为本分支后续归档提交。

功能主干为 `3d738981eb484a96b2a80d57608496800eacfa29`；第一阶段代码为 `6db3c0d1d1a80543c22138e3d4d4a89fd0b698d2`，报告归档与完整回滚点为 `319c5b3f357a8bfc077554e0f95b8ff00c3798df`。已核实提交祖先关系、原树及第一阶段工作树 clean 后创建独立第二阶段工作树。应用保持 **0.1.6 / schema8**。

工作树：`C:/Users/three/.codex/worktrees/baseline-consolidation-phase2/VFIB-Marketing-OS`。所有数据实验使用操作系统临时目录中的合成数据；未读取配置用于真实模型调用，未更改生产数据、密钥、Enterprise Workspace、双系统正式契约或历史分支。未部署、发布、推送 GitHub 或进入第三阶段。

命令中的 `$node` 指 `C:/Users/three/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`（v24.19.0），从上述工作树执行。JSON、原始日志及截图均在 `TEST_EVIDENCE_PHASE2/`。

## H04：模型出站边界

`provider-http.js` 在同一入口完成 URL/端口/主机白名单、全部 DNS 记录检查及 socket 创建；lookup 只返回已验证地址，保持原 Host/SNI、TLS 证书校验，agent=false，不能注入自定义 lookup 或关闭证书校验。每次重试和媒体下载重新检查。3xx 一律拒绝，不跟随跳转，不转送凭据。测试用环回开关仅非生产有效。

请求体上限2 MiB，默认响应2 MiB，图片生成JSON32 MiB、图片下载20 MiB、视频下载120 MiB，所有响应硬上限120 MiB；响应头16 KiB。默认30秒，总时限最多180秒，覆盖 DNS、连接和响应正文；响应先受限完整读取才交给适配器。拒绝非 identity 压缩编码，避免解压膨胀。超限、断流、取消、超时均失败，不返回半成品成功。真实供应商压缩行为及媒体重定向兼容性仍需后续授权验证；不通过放宽私网/跳转来兼容。

文本、图片、视频保留结构化失败码、HTTP 状态、限流和费用回执，隐藏上游错误正文；搜索也隐藏错误正文。传输异常为固定错误码，不拼接请求正文/Authorization。原有预算预检、Provider 管理、账本与费用诚实性逻辑保留。

## H05：密级和权威授权

|Workspace可信密级（支持对象的key字段）|Marketing OS|默认外发|
|---|---|---|
|open / public|PUBLIC|仍须当前用户授权、isReusable=true、两项AI策略均allowed|
|internal|INTERNAL|同上，不能根据内部标签自动认为可外发|
|confidential|CONFIDENTIAL|默认拒绝；保留已有显式策略限制|
|restricted|RESTRICTED|默认拒绝；不能绕过资料库当前授权和外发策略|
|executive / Executive Confidential / executive_confidential|EXECUTIVE_CONFIDENTIAL|始终拒绝，不受allowRestricted豁免影响|
|未知、缺失可信分类|UNKNOWN|拒绝|

别名只是消费者端识别，不修改正式 Workspace 枚举或 API。通用手工文本的关键词分级属于纵深检查，不能证明自由粘贴内容全部已脱敏；任务/资料引用绝不能依靠关键词或客户端 PUBLIC 声明替代授权。

外发入口从服务端任务、营销Brief、内容版本及资料库关联工作素材汇总引用；不接受客户端空Brief覆盖服务端引用。验证当前有效账号、当前品牌model.invoke权限、引用品牌，按当前MOS用户映射调用现有 verifyAssetUsable，再检查权威响应的 isReusable、classification、aiReusePolicy 和 externalAiTransferPolicy；permissionValid显式false也拒绝。当前用户映射、受限票据、撤权事件和资料库返回仍是既有权威机制，未使用服务身份代替用户。缺元数据、未知引用、跨品牌或已撤权均在模型URL校验前阻断。检查返回后再次校验本地用户权限。跨系统撤权与模型网络发送无法成为一个分布式原子事务，此限制未被掩盖。

创作文本、图片与视频路由传递任务、品牌、操作者、资料引用；文本包装器保留引用上下文。外部搜索同样受分级和引用检查。none/mock没有真实出站，继续保持原有明确模拟标识。

## H06与M05

既有库读取失败、结构错误、未来版本一律安全阻断，不改名、不清空、不播种、不覆盖；生产环境缺库也阻断。有效schema8加载不重写。未新增恢复API或自动修复入口，恢复必须经人工授权在隔离目录校验后操作。非生产全新沙盒仍可初始化，旧版已知schema历史迁移函数保留，本阶段没有对生产执行迁移。

M05将品牌、组件host和epoch一并捕获；成功/错误响应只可更新对应视图；同品牌重复渲染也推进epoch；unmount使在途响应失效；旧弹窗/按钮回调在写请求之前拒绝。已经在品牌切换前发送且被服务器接受的操作不会因切换而撤销；后端权限仍独立负责授权。

## 证据、命令和未决事项

```powershell
& $node tools/phase2/egress-test.js                 # 13/13
& $node tools/phase2/workspace-policy-test.js       # 22/22
& $node tools/phase2/adapter-policy-test.js         # 3/3，文本/图像/视频撤权零模型请求
& $node tools/phase2/storage-test.js               # 7/7
& $node tools/phase2/intelligence-test.js           # 6/6
```

前后JSON见h04、h05-adapter、h06、m05的before与after文件。H05元数据单测的before使用原egress编译版本及缺失守卫的等价替身，仅用于单测对照；真正旧入口的失败证据为h05-adapter-before（git show编译三种原适配器），不能将这些替身写成真实资料库联调。

未决：剩余H03写路径、跨进程JSON并发及断电持久性未修复；真实Workspace元数据是否齐备、真实Provider TLS与大媒体兼容性未验证。正式资产入库和专业/发布审批实现没有被替换。

## 验证分层及共同限制

- 本地模拟/组件：H04 安全 13/13，H05 策略 22/22、真实适配器入口负例 3/3，H06 加载/恢复 7/7，M05 组件 6/6。
- 隔离服务集成：原有 17 套回归 880/880；第一阶段保护回归 57/57（其中真实 Chrome 草稿流程 5 项）。第二阶段真实 Chrome 品牌切换 2/2。第二阶段专项合计 53/53；加上上述回归共 990 个断言/用例通过，不代表 990 个独立业务场景。
- 真实外部服务：**NOT VERIFIED / BLOCKED**，未调用真实模型、搜索、企业资料库服务或社媒服务。Workspace 策略测试替身、HTTP 本地桩、TLS 请求参数替身均明确区分，不能作为真实供应商验收。
- 生产验收：**未执行，待人工审核**。仍有异步持久化及跨文件/跨服务一致性风险，见存储风险清单。备份依赖当前 Windows 用户的 DPAPI；不能证明跨机器灾备。
