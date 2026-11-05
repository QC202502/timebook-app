# 第三方依赖清单

依据本仓库锁文件整理，记录日期 2026-11-05。许可证标识来自 npm 包元数据，不替代依赖包内 LICENSE / NOTICE 正文。发布源代码时保留这些声明；若再分发包含依赖的镜像或二进制包，应随包携带相应许可证和源代码义务说明。

本仓库不打包 node_modules 或平台二进制；npm 安装时按平台下载。包含 LGPL-3.0-or-later 的 libvips 组件须特别保留其授权文件。项目自身尚未选择开源许可证。

Next.js 固定为 15.5.29；暂用 overrides 锁定已修复的 PostCSS 8.5.32、sharp 0.35.5、nanoid 3.3.20、source-map-js 1.2.2。升级后重新执行安装、构建、保存恢复和图片导出验证。npm audit 当前为零已知告警，不代表完整安全审计。

| 包 | 版本 | 许可证标识 | 用途 |
|---|---|---|---|
| @emnapi/runtime | 1.11.3 | MIT | 可选 / 平台相关 |
| @img/colour | 1.1.0 | MIT | 可选 / 平台相关 |
| @img/sharp-darwin-arm64 | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-darwin-x64 | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-freebsd-wasm32 | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-libvips-darwin-arm64 | 1.3.4 | LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-libvips-darwin-x64 | 1.3.4 | LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-libvips-linux-arm | 1.3.4 | LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-libvips-linux-arm64 | 1.3.4 | LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-libvips-linux-ppc64 | 1.3.4 | LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-libvips-linux-riscv64 | 1.3.4 | LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-libvips-linux-s390x | 1.3.4 | LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-libvips-linux-x64 | 1.3.4 | LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-libvips-linuxmusl-arm64 | 1.3.4 | LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.4 | LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-linux-arm | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-linux-arm64 | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-linux-ppc64 | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-linux-riscv64 | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-linux-s390x | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-linux-x64 | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-linuxmusl-arm64 | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-linuxmusl-x64 | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-wasm32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | 可选 / 平台相关 |
| @img/sharp-webcontainers-wasm32 | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| @img/sharp-win32-arm64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-win32-ia32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | 可选 / 平台相关 |
| @img/sharp-win32-x64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | 可选 / 平台相关 |
| @next/env | 15.5.29 | MIT | 运行 |
| @next/swc-darwin-arm64 | 15.5.29 | MIT | 可选 / 平台相关 |
| @next/swc-darwin-x64 | 15.5.29 | MIT | 可选 / 平台相关 |
| @next/swc-linux-arm64-gnu | 15.5.29 | MIT | 可选 / 平台相关 |
| @next/swc-linux-arm64-musl | 15.5.29 | MIT | 可选 / 平台相关 |
| @next/swc-linux-x64-gnu | 15.5.29 | MIT | 可选 / 平台相关 |
| @next/swc-linux-x64-musl | 15.5.29 | MIT | 可选 / 平台相关 |
| @next/swc-win32-arm64-msvc | 15.5.29 | MIT | 可选 / 平台相关 |
| @next/swc-win32-x64-msvc | 15.5.29 | MIT | 可选 / 平台相关 |
| @swc/helpers | 0.5.15 | Apache-2.0 | 运行 |
| @types/node | 20.19.37 | MIT | 开发 |
| @types/react | 19.2.14 | MIT | 开发 |
| @types/react-dom | 19.2.3 | MIT | 开发 |
| caniuse-lite | 1.0.30001777 | CC-BY-4.0 | 运行 |
| client-only | 0.0.1 | MIT | 运行 |
| csstype | 3.2.3 | MIT | 开发 |
| detect-libc | 2.1.2 | Apache-2.0 | 可选 / 平台相关 |
| nanoid | 3.3.20 | MIT | 运行 |
| next | 15.5.29 | MIT | 运行 |
| picocolors | 1.1.1 | ISC | 运行 |
| postcss | 8.5.32 | MIT | 运行 |
| react | 19.2.4 | MIT | 运行 |
| react-dom | 19.2.4 | MIT | 运行 |
| scheduler | 0.27.0 | MIT | 运行 |
| semver | 7.8.6 | ISC | 可选 / 平台相关 |
| sharp | 0.35.5 | Apache-2.0 | 可选 / 平台相关 |
| source-map-js | 1.2.2 | BSD-3-Clause | 运行 |
| styled-jsx | 5.1.6 | MIT | 运行 |
| tslib | 2.8.1 | 0BSD | 运行 |
| typescript | 5.9.3 | Apache-2.0 | 开发 |
| undici-types | 6.21.0 | MIT | 开发 |
