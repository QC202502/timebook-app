# 可选扩展

## Codex 工作汇总

普通记账不需要 Python，也不会读取 Codex 目录。

启用时需要 Python 3.11+（标准库）以及明确的本地会话、memory 路径。在 `web/.env.local` 写入或由终端传入：

```dotenv
TIME_LEDGER_CODEX_ENABLED=1
TIME_LEDGER_CODEX_SESSIONS=/absolute/path/to/sessions
TIME_LEDGER_CODEX_MEMORY=/absolute/path/to/memory
TIME_LEDGER_CODEX_FIRST_DAY=2030-01-01
```

不使用 memory 时，指定一个空目录。可选 `TIME_LEDGER_CODEX_ARCHIVED` 显式接入归档会话；默认不读取。`TIME_LEDGER_PYTHON` 可指定 Python 可执行文件，`TIME_LEDGER_CODEX_DIR` 可指定独立索引和更正目录。

启用后会在本机索引这些来源中的任务说明、执行起止、回执和产物线索，展示在统计页。不会改写来源、上传内容或把机器耗时算入本人时间。日志格式变动可能造成不完整数据；未结束和无法确定的执行保持待核。

项目规则默认为空，无法确定的事项留在“待归属”，可在页面更正。需要自动识别时，设置 `TIME_LEDGER_CODEX_RULES_FILE` 指向本地 JSON：

```json
{"rules":[["示例项目","sample-project"]],"destinations":[["示例项目","/sample-project/"]]}
```

规则用正则表达式，仅配置自己信任的表达式；不要把私人配置提交到仓库。明确的个人更正优先。

## 快捷组合

网页内的推荐设置可调整工作日与早晨时段。近期书籍和并行候选使用自己的记录，工作项目仍需主动选择。

`web/config/profile.ts` 提供可选的安装级默认：运动组合、项目快捷、接送时段、已知人物、自动项目排除项。默认全部为空或关闭；示例测试配置在 `web/tests/fixtures/`，不会加载到应用。修改配置后重新构建。这个文件会进入浏览器代码，不能放密钥或私密材料。

## 使用分析

操作日志采集默认暂停，网页内可开启/暂停；仅本机保存允许的事件字段。本发行版未打包作者的自动化分析任务和提醒服务，不会自动改推荐规则。
