# P3 员工体验 API 试点

日期：2026-11-02。分支：`codex/employee-experience-p3`；起点：`c88a414262eb2ba242ac20a648ffc10dc885ca67`。应用仍为 V0.1.6 / schema8 JSON。

状态：文字任务闭环的工程试点已实现并验证；尚未进行生产或真实员工验收，未进入 P4。旧 UI 套件 12 项基线失败仍保留。

## 本地隔离预览

仓库根目录执行（本次实测 Node 24.22.1；使用已有原型子目录依赖）：

```powershell
npm ci --ignore-scripts --prefix prototypes/employee-workspace
npm run build:pilot --prefix prototypes/employee-workspace
node tools/p3/preview.cjs
```

打开 http://p3.localhost:9095/employee-pilot/pilot.html 。只有 `public/employee-pilot/` 是可重建构建产物，不入 Git。P2 的 9094 入口仍为纯模拟原型；原系统入口未替换。

预览工具仅复制 `lib/`、`public/`、`server.js` 到新建临时目录，生成独立 JSON 和合成账号；不复制 config.json、业务数据库、素材或密钥。进程环境只保留基础系统变量，出站网络测试保护禁止非本机访问。不得直接把试点服务指向生产数据。

以下是**本机临时环境的公开测试凭据**，不是正式账号：

| 账号 | 用途 |
| --- | --- |
| `pilot_maker` | 创作，VFIB / UCARD |
| `pilot_professional` | VFIB 专业审核 |
| `pilot_publisher` | VFIB 发布审批 |
| `pilot_other` | 仅 UCARD，越权负例 |

共同测试口令：`PilotTest2026A!`。可在不同浏览器配置中分别登录；同一浏览器切换账号时使用原入口退出或独立无痕配置。试点没有前端角色选择器，不保存登录口令。

## 人工走查

1. 创作者打开任务，直接写正文，或从服务端 Mock Provider 返回的候选中选用正文。
2. 上传合成文件、选择附件并保存；确认送审按钮只在当前版本已确认保存后可用。
3. 提交作品，专业审核员退回并给意见。
4. 作者从同一任务创建修订稿、修改、保存并重提。
5. 专业审核员批准后，独立发布审批人批准；最终明确显示“已批准，尚未发布”。

讨论不送审；文件只走现有工作素材 API，没有宣称模型读取文件。生成只能调用当前隔离服务配置的 Mock Provider，真实收费模型没有启用。

详见 [接口映射](P3_API_MAPPING.md)、[测试报告](P3_TEST_RESULTS.md)、[回滚](P3_ROLLBACK.md) 和 [下一阶段条件](P4_READINESS.md)。
