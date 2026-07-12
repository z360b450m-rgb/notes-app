const path = require('path')
const { spawnSync } = require('child_process')
const pkg = require('../package.json')

const projectRoot = path.resolve(__dirname, '..')
const outputDir = path.join('dist-electron', 'releases', `cuotiben-${pkg.version}`)
const electronDist = path.join(projectRoot, 'node_modules', 'electron', 'dist')
const target = process.argv[2] === 'installer' ? 'nsis' : 'dir'

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm.cmd', ['run', 'build', '--', '--configLoader', 'runner'])
run(
  path.join(projectRoot, 'node_modules', '.bin', 'electron-builder.cmd'),
  [
    '--win',
    target,
    `--config.electronDist=${electronDist}`,
    `--config.directories.output=${outputDir}`,
    '--config.win.signAndEditExecutable=false',
  ],
  {
    NODE_OPTIONS: '--use-system-ca',
    ELECTRON_BUILDER_CACHE: path.join(projectRoot, '.electron-builder-cache'),
  },
)

console.log(`Windows ${target === 'nsis' ? '安装包' : '可运行版本'}已输出到 ${outputDir}`)
