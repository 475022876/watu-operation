# P0-03 固定源码、许可与拟复用文件清单

日期：2026-11-02。检查范围：两个官方源码快照、22个选定文件的许可/包声明/直接imports及关键组件段落。未安装依赖、未构建、未运行、未审计所有传递依赖或全部源码。

## 固定快照与来源

| 项目 | 提交 | ZIP大小 | 许可观察 |
|---|---|---:|---|
| LibreChat | f4154b649efa37e1345ccc517a4d8d1ed2178c82 | 24,420,452 bytes | 根LICENSE为MIT；具体依赖/嵌套许可仍须按拟引入范围核对 |
| Plane | b98e1defb0e089d4505712d89ee9e137fd0935cd | 37,579,376 bytes | 根LICENSE.txt为AGPLv3；所读任务组件有AGPL-3.0-only声明 |

LibreChat归档SHA256：8cdf45c5730ac6c67da39c0e981775090d04bcd1dc291fdfa6ee5b69aad70d70。
Plane归档SHA256：18ffd54e72be372faa4d0641741d1b8d247859fff833aa741c2a21b0b8b0bb8a。
各文件官方固定链接、摘要、行数、imports及包声明见LOCKED_SOURCE_MANIFEST.json。摘要是捕获后的完整性核对，不是厂商签名或恶意代码排除证明。

## LibreChat候选清单

| 上游文件（固定commit） | 实际观察 | 处理建议 |
|---|---|---|
| client/src/components/Chat/ChatView.tsx | 219行，25个直接import；结合Recoil、Jotai、表单、路由、聊天包与上下文 | 参考对话/输入/只读状态组织，不复制整个页面 |
| client/src/components/Chat/Input/ChatForm.tsx | 1191行，41个直接import；Provider、上传、工具/审批交互耦合 | 参考发送、附件、草稿恢复交互；不作为可直接移植组件 |
| packages/chat/src/components/pane/ChatPane.tsx | 146行，5个直接import；props组合，但依赖Jotai pane状态、内部UI和样式 | 参考单工作表面和组合方式，自主实现MOS的工作区布局 |
| client/src/hooks/Messages/useMessageActions.tsx | 211行，12个直接import；绑定对话、Provider和mutation | 参考回复级动作，选用到MOS作品需独立适配 |
| client/src/hooks/Messages/useCopyToClipboard.ts | 533行，8个直接import | 复制能力可参考，但不为单个动作引入整个数据模型；暂不复制 |
| packages/chat/src/components/composer/files/FileUpload.tsx | 102行，4个直接import | 仅参考附件入口；MOS文件校验、授权与AI可读性不能替换 |
| packages/client/src/components/TextareaAutosize.tsx | 76行，6个直接import；React、react-textarea-autosize、Field/Focus/cn/CSS | 最接近局部组件候选，但仍需拆依赖和样式；优先独立实现或单独评估上游基础库 |

client/package.json声明React ^18.2.0、react-hook-form、Recoil、React Query以及内部@librechat包；ChatView还实际import Jotai。client/vite.config.ts为567行配置，不能当作MOS新构建默认模板。上述版本仅说明固定快照现状，不是新工程版本选择。

## Plane候选清单

| 上游文件（固定commit） | 实际观察 | 处理建议 |
|---|---|---|
| apps/web/components/issues/issue-detail/root.tsx | 272行，16个直接import；MobX、权限、issue Store、路由、类型 | 参考任务详情组织，不复制源码或Store |
| apps/web/components/issues/issue-detail/main-content.tsx | 187行，21个直接import；富文本、历史、成员、服务及保存状态 | 参考主内容/上下文、保存反馈，不复用其版本服务 |
| apps/web/components/issues/issue-detail-widgets/root.tsx | 68行，5个直接import；组合属性、动作、弹窗 | 参考渐进展示，不增加员工默认面板数量 |
| apps/web/components/issues/issue-detail-widgets/attachments/content.tsx | 38行，5个直接import | 虽小仍有内部依赖和AGPL声明，不按行数判断可直接复制 |
| apps/web/components/issues/issue-layouts/list/roots/project-root.tsx | 40行，6个直接import；MobX、next/navigation、权限及BaseListRoot | 参考任务列表动作，不移植工程项目数据模型 |

apps/web/package.json使用workspace与catalog依赖；直接读取单个package.json无法完整确定解析后的版本。pnpm-workspace.yaml为342行配置。本轮不声称已完成catalog/锁文件和全部包许可解析。preview快照只供设计评估，不作为稳定生产版本推荐。

## 许可与引入决定

**本轮拟直接引入的上游源码文件：0。拟运行的上游服务：0。** 候选表不是已经批准复制的清单。三个界面的工作方式采用独立实现，不复制上游品牌、图标、图片、样式资源或完整页面。

若后续发现值得复用的MIT局部组件，必须先锁定文件及依赖闭包、识别嵌套许可、保留版权/许可声明并记录修改；不能把根MIT等同整个依赖树已审核。Plane源码不默认纳入当前私有MOS；有明确采用意图时，另行评估具体使用/分发/网络服务方式及相应义务或授权路径，不以“内部使用”或“独立服务”简单判断无义务。

本文件是工程使用边界和源码观察，不是对所有商业使用情境的许可结论。未执行npm/pnpm install，也未验证这些项目能在本环境构建。
