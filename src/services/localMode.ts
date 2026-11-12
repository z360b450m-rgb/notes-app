export const localMode =
  import.meta.env.MODE === 'web' && typeof window !== 'undefined' && !window.electronAPI

export const serverRequiredMessage = '此功能需要连接服务器，当前网页版使用本地模式。'
