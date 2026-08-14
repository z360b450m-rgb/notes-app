const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')
const pkg = require('../package.json')

const projectRoot = path.resolve(__dirname, '..')
const electronDist = path.join(projectRoot, 'node_modules', 'electron', 'dist')
const builderCache = path.join(projectRoot, '.electron-builder-cache')
const builderBinariesMirror = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
const target = process.argv[2] === 'installer' ? 'nsis' : 'dir'
const releaseName =
  target === 'nsis' ? `cuotiben-${pkg.version}-installer` : `cuotiben-${pkg.version}`
const outputDir = path.join('dist-electron', 'releases', releaseName)

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// The downloaded icon tool uses CommonJS and otherwise inherits the app's ESM package scope.
fs.mkdirSync(builderCache, { recursive: true })
fs.writeFileSync(path.join(builderCache, 'package.json'), '{"type":"commonjs"}\n')

// Electron 42+ no longer downloads its runtime during npm install. Ensure the
// local distribution exists before passing electronDist to electron-builder.
if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  run(process.execPath, [path.join(projectRoot, 'node_modules', 'electron', 'install.js')], {
    NODE_OPTIONS: '--use-system-ca',
  })
}

run('npm.cmd', ['run', 'build', '--', '--configLoader', 'runner'])
run(
  path.join(projectRoot, 'node_modules', '.bin', 'electron-builder.cmd'),
  [
    '--win',
    target,
    '--publish',
    'never',
    `--config.electronDist=${electronDist}`,
    `--config.directories.output=${outputDir}`,
    // Keep Windows resource editing enabled so the configured app icon and
    // version metadata are embedded; disable only Authenticode signing.
    '--config.win.signExecutable=false',
  ],
  {
    NODE_OPTIONS: '--use-system-ca',
    ELECTRON_BUILDER_CACHE: builderCache,
    ELECTRON_BUILDER_BINARIES_MIRROR:
      process.env.ELECTRON_BUILDER_BINARIES_MIRROR || builderBinariesMirror,
  },
)

console.log(`Windows ${target === 'nsis' ? '安装包' : '可运行版本'}已输出到 ${outputDir}`)
