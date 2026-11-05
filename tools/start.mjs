// One local entry point; never opens a tunnel, changes data paths or pulls code.
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('../web/', import.meta.url))
const args = process.argv.slice(2)
let port = 8896, rebuild = false
const usage = '用法：node tools/start.mjs [--rebuild] [--port 8896]'
let child

function run(command, argv, env) {
  return new Promise((resolve, reject) => {
    child = spawn(command, argv, { cwd: web, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      child = undefined
      if (code === 0) resolve()
      else reject(new Error(signal ? `已停止（${signal}）。` : `命令未完成（退出码 ${code}），请查看上方提示后重试。`))
    })
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (child) child.kill(signal)
    else process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}

try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rebuild') rebuild = true
    else if (args[i] === '--port' && /^\d+$/.test(args[i + 1] || '')) port = Number(args[++i])
    else if (args[i] === '--help' && args.length === 1) { console.log(usage); process.exit(0) }
    else throw new Error(usage)
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口必须在 1024–65535 之间。')
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('请先安装 Node.js 24（含 npm）：https://nodejs.org/en/download')
  if (process.platform === 'win32') throw new Error('Windows 原生安装尚未验证，请使用 WSL 中的 Node.js 24。')
  if (process.env.TIME_LEDGER_BUILD_DIR) throw new Error('快捷启动使用默认构建目录；自定义构建目录请按开发方式启动。')

  await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', () => reject(new Error(`端口 ${port} 无法使用。若 Timebook 已运行，请直接打开原页面；否则用 --port 指定其他端口。不要同时启动两个服务使用同一账本。`)))
    probe.listen(port, '127.0.0.1', () => probe.close(resolve))
  })

  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
  const next = path.join(web, 'node_modules', 'next', 'dist', 'bin', 'next')
  const buildId = path.join(web, '.next', 'BUILD_ID')
  if (rebuild || !existsSync(next) || !existsSync(buildId)) {
    // A failed install/build must not leave a previously successful build runnable.
    rmSync(buildId, { force: true })
    console.log('\n首次安装或重新构建：下载依赖可能需要几分钟。\n')
    await run('npm', ['ci'], env)
    await run(process.execPath, [next, 'build'], env)
  }
  console.log(`\nTimebook 将在 http://127.0.0.1:${port}/today?mode=real 启动。`)
  console.log('看到 Ready 后打开链接。保持此终端运行，按 Ctrl+C 停止；已保存记录仍在本机。\n')
  await run(process.execPath, [next, 'start', '--hostname', '127.0.0.1', '--port', String(port)], env)
} catch (error) {
  console.error(`\nTimebook：${error.message}`)
  process.exitCode = 1
}
