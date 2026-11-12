import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'workspace-service-worker',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'app/sw.js',
          source: readFileSync(new URL('./sw.js', import.meta.url), 'utf8'),
        })
      },
    },
  ],
  base: './',
  build: {
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
        docs: fileURLToPath(new URL('./docs/index.html', import.meta.url)),
        download: fileURLToPath(new URL('./download/index.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
