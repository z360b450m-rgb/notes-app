// Run after npm run build. Check entry pages as a static host and Electron see them.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'dist')

test('all four entry pages resolve assets from their own directory, including file-based desktop startup', () => {
  for (const entry of ['index.html', 'app/index.html', 'docs/index.html', 'download/index.html']) {
    const htmlPath = path.join(output, entry)
    const html = fs.readFileSync(htmlPath, 'utf8')
    assert.match(html, /lang="zh-CN"/)
    assert.match(html, /<title>[^<]+<\/title>/)
    const resources = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((url) => !/^https?:\/\//.test(url))
    assert.ok(resources.length > 0, entry)
    for (const resource of resources) {
      assert.ok(
        !resource.startsWith('/'),
        `asset must resolve under file://: ${entry}: ${resource}`,
      )
      assert.ok(
        fs.existsSync(path.resolve(path.dirname(htmlPath), resource)),
        `${entry}: missing ${resource}`,
      )
    }
  }
  const html = (entry) => fs.readFileSync(path.join(output, entry), 'utf8')
  const script = (entry) => html(entry).match(/<script[^>]+src="([^"]+)"/)[1]
  assert.notEqual(path.basename(script('index.html')), path.basename(script('app/index.html')))
  assert.equal(path.basename(script('index.html')), path.basename(script('docs/index.html')))
})

test('desktop and PWA launch the workspace entry, with an available worker at the new scope', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8')
  const loadLine = main
    .split('\n')
    .find((line) => line.includes('mainWindow.loadFile('))
    .trim()
  const loadCall = loadLine.slice('mainWindow.loadFile('.length, -1)
  const entry = vm.runInNewContext(loadCall, { path, __dirname: path.join(root, 'electron') })
  assert.equal(entry, path.join(output, 'app', 'index.html'))
  assert.ok(fs.existsSync(entry))
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  assert.equal(new URL(manifest.start_url, 'https://example.test/manifest.json').pathname, '/app/')
  assert.equal(manifest.scope, './app/')
  assert.ok(fs.existsSync(path.join(output, 'app/sw.js')))
})

test('download links stay unavailable until configured and reject executable schemes', () => {
  const bundle = buildSync({
    entryPoints: [path.join(root, 'src/site/config.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    define: {
      'import.meta.env.VITE_WINDOWS_DOWNLOAD_URL': '""',
      'import.meta.env.VITE_WINDOWS_PORTABLE_URL': '""',
    },
    write: false,
  }).outputFiles[0].text
  const compiled = new Module(path.join(__dirname, 'official-site-config.cjs'))
  compiled._compile(bundle, path.join(__dirname, 'official-site-config.cjs'))
  const { downloadUrl, siteConfig } = compiled.exports
  assert.equal(siteConfig.windowsInstaller, '')
  assert.equal(siteConfig.windowsPortable, '')
  assert.equal(downloadUrl('https://example.test/setup.exe'), 'https://example.test/setup.exe')
  assert.equal(downloadUrl('/releases/setup.exe'), '/releases/setup.exe')
  for (const value of [
    undefined,
    '',
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///setup.exe',
    '//outside.test/setup.exe',
    '/\\outside.test/setup.exe',
  ]) {
    assert.equal(downloadUrl(value), '', String(value))
  }
})

test('every guide chapter has a unique shareable ID and homepage chapter links resolve', () => {
  const guide = fs.readFileSync(path.join(root, 'src/site/content/user-guide.md'), 'utf8')
  const headings = [...guide.matchAll(/^## (.+)$/gm)].map((match) => match[1])
  const ids = headings.map((heading) => heading.match(/\{#([a-z0-9-]+)\}$/)?.[1])
  assert.ok(ids.every(Boolean), 'all chapters need a stable ID')
  assert.equal(new Set(ids).size, ids.length)
  const app = fs.readFileSync(path.join(root, 'src/site/SiteApp.vue'), 'utf8')
  for (const match of app.matchAll(/href="\/docs\/#([a-z0-9-]+)"/g)) {
    assert.ok(ids.includes(match[1]), `missing linked chapter ${match[1]}`)
  }
})
