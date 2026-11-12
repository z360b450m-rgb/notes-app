const webBuild =
  import.meta.env.MODE === 'web' && typeof window !== 'undefined' && !window.electronAPI

export const localBackendTest =
  webBuild &&
  window.location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '') === '/app' &&
  new URLSearchParams(window.location.search).get('test') === 'local'

export const localMode = webBuild && !localBackendTest

export const serverRequiredMessage = '此功能需要连接服务器，当前网页版使用本地模式。'
