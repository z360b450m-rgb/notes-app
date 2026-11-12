import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import './ui-theme.css'
import './workspace-ui.css'
import 'katex/dist/katex.min.css'
import './review-ui.css'
import './interaction-ui.css'
import { installButtonMotion } from './utils/buttonMotion'
import { installMenuMotion } from './utils/menuMotion'
import { registerPdfImportHandler } from './services/pdfImport'
import { importQuestionsFromPdf } from './services/shopkeeperPdfAdapter'

registerPdfImportHandler(importQuestionsFromPdf)
const app = createApp(App)
app.mount('#app')
installButtonMotion()
const appRoot = document.getElementById('app')
if (appRoot) installMenuMotion(appRoot)

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {})
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)))
    }
  }
}
