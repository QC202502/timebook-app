# 时间账本 · Timebook

把每天的时间记到分钟，允许同一时段记录多件事，也能看清时间花在哪里。

这是供个人电脑使用的本地网页应用。数据留在运行服务的电脑上，无须 Codex 账号、API Key 或数据库服务。**当前为源码试用版，可下载并在自己的电脑上运行；尚未采用标准开源许可证。**

## 下载并使用

准备 [Git](https://git-scm.com/downloads) 和 [Node.js 24](https://nodejs.org/en/download)（安装时包含 npm）。公开源码可直接下载，无需 GitHub 账号、邀请或访问令牌。

在终端复制以下命令：

```bash
git clone https://github.com/QC202502/timebook-app.git
cd timebook-app
node tools/start.mjs
```

第一次会自动下载依赖并构建，可能需要几分钟。看到 `Ready` 后，打开 <http://127.0.0.1:8896/today?mode=real>，开始使用自己的空账本。页面下方“示例体验”使用虚构数据，不写入个人账本。

保持终端运行；按 `Ctrl+C` 停止服务，已保存记录不会因此删除。关机后再次使用，在 `timebook-app` 目录运行同一个 `node tools/start.mjs` 即可，无需每次安装和构建。

不使用 Git 也可以[下载源码 ZIP](https://github.com/QC202502/timebook-app/archive/refs/heads/main.zip)，解压后在该目录运行 `node tools/start.mjs`。ZIP 方式更新时下载新版源码，继续使用原来的数据目录。

已验证环境：macOS、Node.js 24、npm。CI 在 Ubuntu 执行；Windows 原生运行尚未验证，快捷入口会提示使用 WSL。

只监听本机 `127.0.0.1`，默认端口 8896；没有云端登录、多用户隔离或跨设备同步。其他人的电脑打不开你这个地址。修改端口可用 `node tools/start.mjs --port 8887`，同一个账本只运行一个服务。

## 更新版本

先在网页点“备份 JSON”并另存一份，再停止服务，然后在 `timebook-app` 目录运行：

```bash
git pull --ff-only
node tools/start.mjs --rebuild
```

若拉取提示冲突，先处理本地代码改动；不要强制覆盖。重新构建只更新应用依赖和编译产物，账本路径保持不变。启动程序不会自动拉取代码。

## 已有功能

- 拖选时间、分钟微调、提前记录；一级和二级分类，运动动作多选。
- 同时最多三件活动，分别保存；修改一件不会替换另一件。
- 人物多选、近期书目、基于自己记录的快捷建议、视频制作阶段。
- 日、周、月统计；已记录覆盖、活动累计、并行时间分开计算。
- 项目、书籍和人物汇总；CSV 导出。
- 日程图片预览、复制和 PNG 保存；选择公开活动，其余只显示色块。
- JSON 备份、本机历史版本、差异预览、单条或整本恢复。

当前统计使用北京时间（Asia/Shanghai）。未来填写的时间默认按完整区间统计，可选“截至现在”。单个账本目前最多 10,000 条记录。

## 数据在哪里

默认数据在代码目录之外，更新或重新下载代码不会覆盖它：

- macOS：`~/Library/Application Support/TimeLedger-Community/`
- Linux：`~/.local/share/time-ledger-community/`

主文件为 `ledger-v2.json`；版本库为 `ledger-v2.json.versions/`。可以在启动前设置绝对路径 `TIME_LEDGER_HOME`。用同一个目录时只运行一个服务进程。

```bash
TIME_LEDGER_HOME=/absolute/path/to/my-ledger node tools/start.mjs
```

“保存成功”表示数据已写入本机。**本机版本不是异机备份**；请定期点“备份 JSON”，另存到 NAS、移动硬盘等独立位置。详见 [备份与恢复](docs/data-and-recovery.md)。

## 可选扩展与配置

- 分类、颜色、顺序和人物在网页内管理。
- 录入习惯默认从自己的记录学习。安装级运动/项目规则可在 `web/config/profile.ts` 配置并重新构建；默认没有预设人物和私人作息。
- Codex 工作汇总默认关闭，只有指定会话来源后才扫描；参见 [扩展说明](docs/extensions.md)。
- 本地操作日志默认暂停，可在录入面板明确开启。只存操作类型和耗时，不存输入的活动文字，也不会上传。

## 开发与验证

手动安装或开发时，在 `web` 目录依次运行 `npm ci`、`npm run build`、`npm start`；开发服务使用 `npm run dev`。

```bash
cd web
npm test
npm run typecheck
npm run build
npm run test:release
cd ..
node tools/check-release.mjs
```

集成测试自动创建临时数据目录和随机本机端口，验证重启、冲突、并行与备份恢复。测试留下的临时目录位于系统临时目录，便于排查。

[范围与发布检查](docs/release.md) · [本地验证记录](docs/verification.md) · [安全边界](SECURITY.md) · [第三方依赖](docs/third-party.md)

`examples/demo-day.json` 是完全虚构的格式示例，带有 `demo: true` 标记，不可当作个人备份导入。
