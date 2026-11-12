import { version } from '../../package.json'

// Leave empty until an installer has actually been published.
// Accept only a web URL or a path on this site; never render an executable URL scheme.
export function downloadUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  if (/^\/(?!\/)[^\\\s]*$/.test(url)) return url
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''
  } catch {
    return ''
  }
}

export const siteConfig = {
  name: 'ReNote · 错题集',
  version,
  windowsInstaller: downloadUrl(import.meta.env.VITE_WINDOWS_DOWNLOAD_URL),
  windowsPortable: downloadUrl(import.meta.env.VITE_WINDOWS_PORTABLE_URL),
}
