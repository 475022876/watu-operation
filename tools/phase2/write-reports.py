from pathlib import Path
import json,re,subprocess
code='e21da0a';tools='bf27962'
common=f'''日期：2026-10-27。分支：`baseline/consolidation-phase2`。业务修复最终提交：`{code}`；最后专项测试提交：`{tools}`；报告和原始证据为本分支后续归档提交。

功能主干为 `3d738981eb484a96b2a80d57608496800eacfa29`；第一阶段代码为 `6db3c0d1d1a80543c22138e3d4d4a89fd0b698d2`，报告归档与完整回滚点为 `319c5b3f357a8bfc077554e0f95b8ff00c3798df`。已核实提交祖先关系、原树及第一阶段工作树 clean 后创建独立第二阶段工作树。应用保持 **0.1.6 / schema8**。

工作树：`C:/Users/three/.codex/worktrees/baseline-consolidation-phase2/VFIB-Marketing-OS`。所有数据实验使用操作系统临时目录中的合成数据；未读取配置用于真实模型调用，未更改生产数据、密钥、Enterprise Workspace、双系统正式契约或历史分支。未部署、发布、推送 GitHub 或进入第三阶段。

命令中的 `$node` 指 `C:/Users/three/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`（v24.19.0），从上述工作树执行。JSON、原始日志及截图均在 `TEST_EVIDENCE_PHASE2/`。
'''
verification='''
## 验证分层及共同限制

- 本地模拟/组件：H04 安全 13/13，H05 策略 22/22、真实适配器入口负例 3/3，H06 加载/恢复 7/7，M05 组件 6/6。
- 隔离服务集成：原有 17 套回归 880/880；第一阶段保护回归 57/57（其中真实 Chrome 草稿流程 5 项）。第二阶段真实 Chrome 品牌切换 2/2。第二阶段专项合计 53/53；加上上述回归共 990 个断言/用例通过，不代表 990 个独立业务场景。
- 真实外部服务：**NOT VERIFIED / BLOCKED**，未调用真实模型、搜索、企业资料库服务或社媒服务。Workspace 策略测试替身、HTTP 本地桩、TLS 请求参数替身均明确区分，不能作为真实供应商验收。
- 生产验收：**未执行，待人工审核**。仍有异步持久化及跨文件/跨服务一致性风险，见存储风险清单。备份依赖当前 Windows 用户的 DPAPI；不能证明跨机器灾备。
'''
def write(name,title,body):Path(name).write_text('# '+title+'\n\n'+common+'\n'+body+verification,encoding='utf-8')
write('PHASE2_CHANGELOG.md','Phase 2 整改变更记录','''## 变更与回滚点

|事项|提交|原始缺陷与变更|影响模块|
|---|---|---|---|
|H06|d14b6ab|损坏 JSON/未来 schema 曾被改名并播种空库；现抛 MOS_DATABASE_LOAD_BLOCKED，保留原文件；schema8 有效加载不再重写|store.load|
|M05/T09|ac556a9|旧请求及旧弹窗回调可作用到新品牌；现以品牌、host 和 epoch 绑定读取、渲染及写入回调|情报流、来源、研究、选题页面|
|H04|28284c4|地址校验与 fetch 连接分离、跟随跳转、正文无完整超时和大小约束；现统一固定 DNS 的原生 HTTP(S) 传输|文本、图片、视频、搜索及媒体下载|
|H05|75ddf13|高管/未知密级可能退回 PUBLIC，任务引用未在外发前实时授权；现引入严格映射及资料库权威复核|egress、Workspace AI 策略、创作/视频调用上下文|
|补充及验证|285f40f|搜索外发同样执行分级/引用检查；保留上游 HTTP/结构化错误，隐藏上游原始正文；浏览器和适配器测试|搜索、测试工具|
|H06/H05补充|ba8d935|生产缺库禁止自动播种；新库首次落盘失败清空内存；显式失效权限拒绝；加密备份和回滚验证|加载器、资料策略、恢复测试|
|错误说明|e21da0a|未知/高管机密阻断不再提示管理员可以豁免；补齐7项加载器前后证据|文本/图片错误提示、测试|
|复现实验|bf27962|通过 git show 在 VM 读取旧情报源码，重现原始5项失败，不编辑业务源码|M05工具|

H04/H05/H06 为针对当前功能主干的增量实现；M05 参考 `1f0f1f0` 的 epoch 思路并扩展到延迟写回调。没有整目录覆盖。每项独立提交均保留父提交，可在独立审阅/回滚分支检查；相互依赖补丁不应盲目逐个反向应用。

## 测试命令与结果

```powershell
& $node tools/phase2/egress-test.js
& $node tools/phase2/workspace-policy-test.js
& $node tools/phase2/adapter-policy-test.js
& $node tools/phase2/storage-test.js
& $node tools/phase2/intelligence-test.js
& $node tools/phase2/browser-intelligence-test.js
& $node tools/phase2/run-phase1-regression.js
& $node tools/phase2/run-regression.js
& $node tools/phase2/rollback-test.js
```

上述结果均通过。首次全回归保留 `regression-first-run/`：879/880，旧 PC-18 断言要求展示供应商错误原文；按 H04 更新为保留 HTTP 500/结构化错误且不泄露正文，随后完整17套均880通过；最终错误文案调整后又单独运行26项 Provider 契约验证（provider-contract-final.log）。没有删用例或跳过失败来获得通过。

## 尚未解决

剩余 H03 仅完成分类，不宣称全系统事务。真实外部授权、真实 TLS 供应商握手与生产验收未完成。正式契约文件及共享客户端保持不变；缺少可信外发元数据的现有服务将被阻断，须在后续获授权联调中核实。
''')
write('PHASE2_SECURITY_FIXES.md','Phase 2 安全整改说明','''## H04：模型出站边界

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
''')
rows=json.loads(Path('TEST_EVIDENCE_PHASE2/regression/summary.json').read_text())['rows']
table='|原有套件|通过数|进程结果|\n|---|---:|---|\n'
for r in rows:
 s=Path(r['log']).read_text(encoding='utf-8');count=len(re.findall(r'^\s*PASS\b',s,re.M));table+=f"|{r['suite']}|{count}|{'PASS' if r['exitCode']==0 else 'FAIL'}|\n"
write('PHASE2_TEST_RESULTS.md','Phase 2 测试结果','''## 前后证据

|测试|修复前|修复后|证据|
|---|---|---|---|
|H04出站|7通过/6失败|13/13|h04-before.json、h04.json|
|H05原适配器撤权|0通过/3失败|3/3|h05-adapter-before.json、h05-adapter.json|
|H05密级/授权策略|单测对照4通过/18失败|22/22|h05-before.json、h05.json；before为原分级+缺失守卫替身|
|H06损坏/缺库/恢复|0通过/7失败|7/7|h06-before.json、h06.json|
|M05/T09组件|1通过/5失败|6/6|m05-before.json、m05.json|
|M05真实Chrome|本阶段新增隔离浏览器场景|2/2|browser-m05/results.json及2张截图|

H04 TLS连接参数测试替换HTTPS request函数，验证固定lookup、原主机SNI、证书校验配置；本地HTTP桩验证正文大小、超时、取消、跳转零跟随，不等于真实公网TLS验证。

## 原有17套回归

'''+table+'''
合计880/880，全部进程exitCode=0。第一轮PC-18因原文泄露断言失败的日志保留在regression-first-run，最终完整运行在regression。错误提示最后调整后provider-contract-final.log再次26/26。没有真实供应商密钥，旧套件L3明确SKIP/BLOCKED，这些跳过项不计入已通过的真实外部验证。

## 第一阶段成果复验

H01 9/9；H02 6/6；H03同步事务16/16；真实隔离HTTP持久化失败5/5；H07组件10/10；损坏副本/恢复6/6；真实Chrome草稿5/5，总计57/57。日志和JSON在phase1-regression。T04旧“允许自动播种”观察用例已改为要求安全阻断，第一阶段历史证据归档原样保留。

## 命令

```powershell
& $node tools/phase2/run-regression.js
& $node tools/phase2/run-phase1-regression.js
& $node tools/phase2/browser-intelligence-test.js
& $node tools/phase2/rollback-test.js
& ./tools/phase2/verify-existing-backup.ps1
# 只读编译319c5b3旧代码并重现失败，预期非零退出：
$env:PHASE2_BEFORE='1'
& $node tools/phase2/egress-test.js
& $node tools/phase2/adapter-policy-test.js
& $node tools/phase2/storage-test.js
& $node tools/phase2/intelligence-test.js
Remove-Item Env:PHASE2_BEFORE
```

专项正常模式命令见PHASE2_SECURITY_FIXES。回滚、备份校验均通过；未对生产执行任何恢复。当前无未解决的本地回归失败；未验证的外部服务与生产验收不能列为通过。
格式检查：业务源码、工具和Markdown的git diff --check通过（diff-check.json）。全目录检查另外报告两份原始UI控制台日志共6处表格末尾制表符；为保留原始证据未改写，未将其归为业务代码通过项。

''')
write('PHASE2_REGRESSION_MATRIX.md','Phase 2 业务回归矩阵','''## 保留能力与证据

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
 git diff --check 319c5b3 HEAD -- lib public tools "*.md"
 git diff --stat 319c5b3 HEAD
```

未决：真实供应商/Workspace/社媒联调、生产容量及跨进程写入、断电恢复、剩余事务风险。未删减已授权业务能力；安全阻断的未知密级或无外发授权内容不属于功能验收通过。
''')
write('PHASE2_STORAGE_RISK_REGISTER.md','Phase 2 存储与剩余事务风险登记','''## 已覆盖与审计方法

第一阶段同步事务仅覆盖editorial两条派工/入池写路径及content新建、编辑、锁定三条路径；本阶段H06只调整加载/阻断，不扩大事务覆盖。使用rg列举save/saveNow/atomicMutation，再读取审核联动、发布与入库关键逻辑。原始位置及静态计数见write-paths.txt、other-write-paths.txt、write-counts.json。静态命中数含辅助调用/分支，不能直接当作独立API数量。

## 后续整改清单（本阶段只审计，不执行）

|编号/级别|代码位置|失败风险|独立后续方案及验收|
|---|---|---|---|
|TX01 High|routes/reviews.js:278、442|审核决定同时变更审核单、内容、任务/入库状态后异步save，可能提前成功；入库分支有await|独立设计本地提交事务和远程授权分段状态；磁盘失败不得成功，绑定manifest/内容版本，重试无重复决定|
|TX02 High|routes/content.js:438|revise增加新版本、废弃旧版本、关闭审核单、任务退回制作后异步save|在独立方案中覆盖完整同步变更，验证失败恢复新旧版本与审批单一致|
|TX03 High|routes/publishing.js:186、262、401、535、581|排期、发布登记、纠错与回执状态/内容联动提前返回；未来外部发布有不可逆副作用|本地原子提交+outbox/幂等发布及补偿状态；先批准独立方案，禁止把社媒副作用包进同步事务|
|TX04 High|routes/admissions.js:280至949|入库申请、审核、远程三步交付及本地引用落库不构成跨系统事务|持久作业/outbox、稳定幂等键、远程回执重查；验证远程成功本地保存失败不重复入库|
|TX05 High|provideradmin.js:574、625、707、733；providerlog.js:74、188|配置、预算策略、调用账本使用save，成功回执与持久化不同步，失败重启可丢成本/限额状态|独立持久预算预留/调用状态机，调用前后结算和重试幂等；不得直接将await网络放入atomicMutation|
|TX06 High|routes/admin.js:66；eventconsumer.js:97至339|权限更新、票据/撤权事件/游标异步保存，重启可能恢复旧状态|先确认durable撤权与游标确认顺序；实时权威核验保留；故障/重启负例|
|TX07 High|routes/research.js:113至447；routes/video.js:254至321；routes/creative.js:526至652|队列/生成作业、账本、文件写入跨await，崩溃可能遗失任务或重复计费|独立作业状态机、幂等供应商提交、结果对账及素材校验，不在本阶段大改|
|TX08 Medium|routes/sources.js；campaigns.js；plans.js；topics.js；tasks.js；channels.js；studio.js|普通业务变更大多save防抖返回，磁盘失败存在虚假成功窗口|按影响逐路径补充持久化确认和rowVersion，先测试再逐项移植|
|TX09 High|store.js:202、446、451|单JSON进程间无锁；saveNow吞错；多个实例可互相覆盖；rename不等于fsync断电耐久性|部署先限制单写者；另行设计真实数据库/锁及迁移方案，未经授权不得迁移；磁盘满/断电/双进程试验|
|TX10 Medium|工作素材文件/数据库引用、uploads|文件和JSON之间没有跨资源事务，可能有孤儿文件或缺失引用|内容哈希、暂存/提交清单、幂等补偿与离线对账，禁止自动删除生产素材|
|OP01 Medium|H06恢复流程|安全阻断改善数据保护，但故障时需人工恢复，不能自动空库继续营业|告警、停写、一致性备份、隔离认证解密/校验、人工批准切换；DPAPI账户需独立灾备方案|

以上分类是静态风险识别，并未宣称逐条注入生产故障。H03剩余项仍未修复，也未进行数据库迁移。旧代码注释中“单进程天然串行/崩溃全部未发生”不能替代跨await、异步save或跨文件事务证据。

## H06恢复操作说明

1. 数据库读取失败即停止实例；保留原mos.json、目录、日志及校验摘要，不改名播种，不直接在原路径试错。
2. 确认人工恢复授权、备份时点、配置/素材/密钥配套及Windows DPAPI账户恢复能力，备份当前损坏文件用于调查。
3. 在隔离目录认证解密经批准备份，核对每项SHA256、JSON/schema8、关联对象/素材、权限与版本。认证失败、缺项、未来schema或不一致时停止，不回退成空库。
4. 隔离验证应用启动与关键业务状态；准备同一时点回滚副本；由人工批准停写后的切换。本阶段没有执行该生产步骤。
5. 只回退代码时也必须使用经验证的健康数据。第一阶段加载器仍有旧自动播种行为，绝不能让回滚代码打开损坏库。

## 可复核命令与结果

```powershell
rg -n 'save\\(|saveNow\\(|atomicMutation' lib/mos/routes -g '*.js'
& $node tools/phase2/storage-test.js     # 7/7
& $node tools/phase2/rollback-test.js    # 健康schema8合成副本加载通过
& ./tools/phase2/verify-existing-backup.ps1  # 9项加密备份重新认证/摘要通过
```

关联提交d14b6ab、ba8d935；最终代码e21da0a。备份摘要`01e85b57c57e786398443140a84a19ac0ba9768f54ef93d00425f2a92c20b596`，位置`D:/运营系统/VFIB-Marketing-OS-Phase1-Evidence-20261027/original-consistent-backup.aesgcm.json`，不包含在审阅源码包中。只有同Windows用户/profile的内存解密被验证；没有证明异地或跨账户恢复。
''')
write('PHASE3_INTEGRATION_READINESS.md','Phase 3 集成准备度与人工验收门禁','''## 第二阶段是否可申请验收

|条件|本阶段结论|证据|
|---|---|---|
|H04修复及安全负例|满足本地审阅条件|h04.json 13/13；拒跳转、固定地址、私网/元数据/混合DNS、超时和限额|
|H05密级及撤权负例|满足本地审阅条件|h05.json22/22；h05-adapter.json3/3；高管/未知/缺元数据拒绝|
|H06生产加载器安全阻断|满足本地审阅条件|h06.json7/7；损坏、未来版本、生产缺库、恢复失败均阻断|
|M05/T09乱序响应|满足本地审阅条件|组件6/6、真实Chrome2/2及截图|
|原有回归无新增失败|满足|17套880/880；首次PC-18变更原因/失败记录保留|
|第一阶段成果有效|满足|57/57；包含真实浏览器409/500/断网|
|回滚可执行|满足已验证范围|Phase1代码archive加载健康合成schema8；加密备份9项认证校验通过|

**结论：第二阶段实现和隔离验证完成，可交人工审阅；尚未生产验收，不能自动进入第三阶段。**

## 仍不具备直接安装/生产集成条件

Postiz与Activepieces均未安装、未连接账号。当前有内容/审核/发布对象及Provider适配边界，可以开展经授权的设计工作，但剩余事务/幂等/回执安全/生产持久化尚未收敛，不建议直接把真实发布与自动化工作流接入异步save路径。Directus仍暂缓；Marketing OS保留唯一员工入口；Enterprise Workspace继续独立并保留最终权限及资产入库批准权。

下一阶段需人工单独确定范围：

1. 审批通过本阶段代码差异、密级表、禁止跳转策略和恢复流程，确认是否接受安全兼容性变化。
2. 为TX01–TX07形成独立事务/作业/outbox方案，优先审批决定、内容修订、预算账本及未来发布，不在现有JSON层机械包裹异步网络。
3. 授权后用测试账户核实Workspace实际返回分类/AI复用/外发元数据以及用户映射、跨品牌、撤权；缺字段继续拒绝，不改正式API绕过。
4. 授权后使用专用低预算模型凭据验证真实TLS、429、超时、大媒体及下载URL兼容性；凭据仅安全配置，不进审阅包或日志。
5. 分别设计Postiz适配器的版本/审批manifest绑定、稳定幂等键、签名回调、重试/死信和发布回执；保持MOS审核最终控制。Activepieces只承担获授权作业执行，不能获得企业资料库全量数据或绕过模型网关。
6. 制定生产单写者限制、可移植备份、恢复演练、告警及发布回滚方案；任何迁移、安装、账号接入或外部发布须新授权。

## 验证命令、提交及未决问题

```powershell
& $node tools/phase2/run-regression.js
& $node tools/phase2/run-phase1-regression.js
& $node tools/phase2/browser-intelligence-test.js
& $node tools/phase2/rollback-test.js
 git log --oneline 319c5b3..HEAD
 git diff --stat 319c5b3 HEAD
```

最终业务修复e21da0a、测试工具bf27962，原始回滚点319c5b3保持。当前本地测试无未解决失败；外部联调、生产验收以及TX风险登记均待后续独立授权。本任务到此停止，不自动部署或启动下一阶段。
''')
print('Generated six Phase2 reports')
