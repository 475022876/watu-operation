# 依赖与隔离

只在原型子目录安装依赖，未修改根 package.json 或 lock。安装使用 `--ignore-scripts --no-audit --no-fund`，未执行包生命周期脚本；精确版本与 integrity 见子目录 lock 和 `evidence/dependency-review.json`。

| 包 | 版本 | 用途 / 许可 |
| --- | --- | --- |
| react | 19.3.1 | 运行时 / MIT |
| react-dom | 19.3.1 | 运行时 / MIT |
| @types/react | 19.3.0 | 开发 / MIT |
| @types/react-dom | 19.3.0 | 开发 / MIT |
| typescript | 7.0.2 | 开发 / Apache-2.0 |
| vite | 8.3.5 | 构建 / MIT |

本机实际安装 23 个包，审计元数据含其他平台 optional 包，不应混为实际安装数量。完整许可清单见 `evidence/installed-license-inventory.json`；lightningcss 及平台绑定为 MPL-2.0 构建依赖，未复制其源码到产品。运行时 React/react-dom/scheduler 许可附于 `public/THIRD_PARTY_NOTICES.txt` 并随构建提供。未复制 LibreChat、Plane 等第三方业务项目。

独立静态服务绑定 127.0.0.1，预览使用 `p2.localhost:9094`。服务不代理 API、不读取业务 Cookie、不访问 MOS 数据目录，CSP 禁止 connect-src、worker、frame 和表单网络提交。合成数据只保存在独立主机的 sessionStorage 指定键。禁止输入真实客户或敏感资料；本地缓存不是安全数据保险库。

原业务源码保护核对结果见 `BASELINE_PROTECTION.json`。本轮不是生产安全审计；即使没有已报告依赖漏洞，也不能解释为没有其他风险。
