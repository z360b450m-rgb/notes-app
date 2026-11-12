const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const rootDir = path.resolve(__dirname, '..')
const runtimeDir = path.join(rootDir, '.dev-services')
const statePath = path.join(runtimeDir, 'state.json')
const backendUrl = 'http://127.0.0.1:8000'
const frontendHost = '127.0.0.1'
const frontendPorts = Array.from({ length: 8 }, (_, index) => 5173 + index)
const mysqlHost = process.env.MYSQL_HOST || '127.0.0.1'
const mysqlPort = Number(process.env.MYSQL_PORT || 3306)
const mysqlService = process.env.MYSQL_SERVICE_NAME || 'MySQL80'

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function ensureRuntimeDir() {
  fs.mkdirSync(runtimeDir, { recursive: true })
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

function writeState(state) {
  ensureRuntimeDir()
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function request(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, body }))
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, body: '' })
    })
    req.on('error', () => resolve({ ok: false, body: '' }))
  })
}

function canConnect(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function isPortFree(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host, port }, () => server.close(() => resolve(true)))
  })
}

async function waitFor(check, label, timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return
    await sleep(500)
  }
  throw new Error(`${label}启动超时，请查看 .dev-services 目录中的日志。`)
}

async function backendHealthy() {
  const response = await request(`${backendUrl}/health`)
  return response.ok && response.body.includes('"status":"ok"')
}

async function findFrontend() {
  for (const port of frontendPorts) {
    const url = `http://${frontendHost}:${port}/`
    const response = await request(url)
    if (response.ok && response.body.includes('<title>错题本</title>')) {
      return { port, url }
    }
  }
  return null
}

async function chooseFrontendPort() {
  for (const port of frontendPorts) {
    if (await isPortFree(frontendHost, port)) return port
  }
  throw new Error('5173–5180 端口均被占用，无法启动前端。')
}

function spawnDetached(command, args, logFile) {
  ensureRuntimeDir()
  const logPath = path.join(runtimeDir, logFile)
  const logFd = fs.openSync(logPath, 'a')
  const child = spawn(command, args, {
    cwd: rootDir,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  })
  child.unref()
  fs.closeSync(logFd)
  return { pid: child.pid, logPath }
}

async function ensureMysql() {
  if (await canConnect(mysqlHost, mysqlPort)) {
    return { status: 'running', reused: true }
  }

  if (process.platform !== 'win32' || !['127.0.0.1', 'localhost'].includes(mysqlHost)) {
    throw new Error(`无法连接 MySQL：${mysqlHost}:${mysqlPort}`)
  }

  console.log(`MySQL 未运行，正在启动 Windows 服务 ${mysqlService}…`)
  const result = spawnSync('sc.exe', ['start', mysqlService], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0 && !`${result.stdout}${result.stderr}`.includes('1056')) {
    throw new Error(`无法启动 ${mysqlService}。请以管理员身份启动该服务后重试。`)
  }
  await waitFor(() => canConnect(mysqlHost, mysqlPort), 'MySQL', 20000)
  return { status: 'running', reused: false }
}

function pythonExecutable() {
  const executable = process.platform === 'win32'
    ? path.join(rootDir, '.venv', 'Scripts', 'python.exe')
    : path.join(rootDir, '.venv', 'bin', 'python')
  if (!fs.existsSync(executable)) {
    throw new Error('未找到项目虚拟环境，请先创建 .venv 并安装 requirements.txt。')
  }
  return executable
}

function viteExecutable() {
  const executable = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!fs.existsSync(executable)) {
    throw new Error('未找到前端依赖，请先运行 npm install。')
  }
  return executable
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    })
    child.unref()
    return
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [url], { detached: true, stdio: 'ignore' })
  child.unref()
}

async function startServices({ shouldOpen }) {
  console.log('正在检查开发环境…')
  const previousState = readState()
  const ownedState = previousState?.rootDir === rootDir ? previousState : null
  const mysql = await ensureMysql()

  let backend = { reused: true, pid: null, url: backendUrl }
  if (await backendHealthy()) {
    if (!ownedState?.backend?.reused && processExists(ownedState?.backend?.pid)) {
      backend = ownedState.backend
    }
  } else {
    console.log('正在启动 FastAPI 后端…')
    const processInfo = spawnDetached(
      pythonExecutable(),
      ['-m', 'uvicorn', 'src.db_sql.main:app', '--host', '127.0.0.1', '--port', '8000', '--reload'],
      'backend.log',
    )
    backend = { reused: false, pid: processInfo.pid, url: backendUrl, log: processInfo.logPath }
    await waitFor(backendHealthy, 'FastAPI')
  }

  let frontend = await findFrontend()
  if (frontend) {
    const sameOwnedFrontend = !ownedState?.frontend?.reused
      && processExists(ownedState?.frontend?.pid)
      && ownedState.frontend.url === frontend.url
    frontend = sameOwnedFrontend
      ? ownedState.frontend
      : { ...frontend, reused: true, pid: null }
  } else {
    const port = await chooseFrontendPort()
    console.log(`正在启动 Vite 前端（端口 ${port}）…`)
    const processInfo = spawnDetached(
      process.execPath,
      [viteExecutable(), '--host', frontendHost, '--port', String(port), '--strictPort'],
      'frontend.log',
    )
    frontend = {
      port,
      url: `http://${frontendHost}:${port}/`,
      reused: false,
      pid: processInfo.pid,
      log: processInfo.logPath,
    }
    await waitFor(async () => {
      const response = await request(frontend.url)
      return response.ok
    }, 'Vite')
  }

  writeState({
    rootDir,
    startedAt: new Date().toISOString(),
    mysql,
    backend,
    frontend,
  })

  console.log('\n全部服务已就绪：')
  console.log(`  前端：${frontend.url}${frontend.reused ? '（已在运行）' : ''}`)
  console.log(`  后端：${backendUrl}${backend.reused ? '（已在运行）' : ''}`)
  console.log(`  文档：${backendUrl}/docs`)
  console.log(`  MySQL：${mysqlHost}:${mysqlPort}${mysql.reused ? '（已在运行）' : ''}`)
  console.log('  日志：.dev-services\\backend.log / frontend.log')

  if (shouldOpen) openBrowser(frontend.url)
}

function processExists(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function stopProcessTree(pid, label) {
  if (!processExists(pid)) return
  console.log(`正在停止${label}（PID ${pid}）…`)
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      process.kill(pid, 'SIGTERM')
    }
  }
}

async function stopServices() {
  const state = readState()
  if (!state || state.rootDir !== rootDir) {
    console.log('没有找到由统一启动器创建的运行记录。')
    return
  }

  if (!state.frontend?.reused) stopProcessTree(state.frontend?.pid, '前端')
  if (!state.backend?.reused) stopProcessTree(state.backend?.pid, '后端')
  fs.rmSync(statePath, { force: true })
  console.log('统一启动器创建的前端和后端已停止；MySQL 服务保持运行。')
}

async function showStatus() {
  const mysql = await canConnect(mysqlHost, mysqlPort)
  const backend = await backendHealthy()
  const frontend = await findFrontend()
  console.log(`MySQL：${mysql ? '运行中' : '未连接'}（${mysqlHost}:${mysqlPort}）`)
  console.log(`后端：${backend ? '运行中' : '未启动'}（${backendUrl}）`)
  console.log(`前端：${frontend ? `运行中（${frontend.url}）` : '未启动'}`)
}

async function main() {
  const command = process.argv[2] || 'start'
  if (command === 'start') {
    await startServices({ shouldOpen: !process.argv.includes('--no-open') })
    return
  }
  if (command === 'stop') {
    await stopServices()
    return
  }
  if (command === 'status') {
    await showStatus()
    return
  }
  throw new Error('用法：node scripts/dev-services.cjs <start|stop|status> [--no-open]')
}

main().catch((error) => {
  console.error(`\n启动失败：${error.message}`)
  process.exitCode = 1
})
