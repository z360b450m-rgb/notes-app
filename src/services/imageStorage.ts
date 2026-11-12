const IMAGE_SCHEME_PREFIX = 'cuotiben-image://local/'
const RELATIVE_IMAGE_PREFIX = 'images/'

export function isRelativeImagePath(source: string): boolean {
  return source.replace(/^\.\//, '').startsWith(RELATIVE_IMAGE_PREFIX)
}

export function toDisplayImageUrl(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!isRelativeImagePath(normalized) || typeof window === 'undefined' || !window.electronAPI) {
    return relativePath
  }
  return IMAGE_SCHEME_PREFIX + normalized.split('/').map(encodeURIComponent).join('/')
}

export function toDisplayHtml(html: string): string {
  if (!html || typeof window === 'undefined' || !window.electronAPI) return html
  return html.replace(
    /(<img\b[^>]*?\bsrc=["'])(\.?\/?images\/[^"']+)(["'][^>]*>)/gi,
    (_match, prefix: string, source: string, suffix: string) =>
      `${prefix}${toDisplayImageUrl(source)}${suffix}`,
  )
}

export function toStorageHtml(html: string): string {
  if (!html) return html
  return html.replace(
    /(<img\b[^>]*?\bsrc=["'])cuotiben-image:\/\/local\/([^"']+)(["'][^>]*>)/gi,
    (_match, prefix: string, encodedPath: string, suffix: string) => {
      try {
        const relativePath = decodeURIComponent(encodedPath)
        return isRelativeImagePath(relativePath) ? `${prefix}${relativePath}${suffix}` : _match
      } catch {
        return _match
      }
    },
  )
}

async function sourceToBlob(source: Blob | string): Promise<Blob> {
  if (source instanceof Blob) return source
  const response = await fetch(source)
  if (!response.ok) throw new Error('Unable to read the selected image')
  return response.blob()
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the selected image'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

/**
 * Convert Electron-only local image paths back to data URLs before an entry is
 * sent to the API. The server and browser clients cannot resolve images/... on
 * this device, while Electron still keeps the on-disk representation locally.
 */
export async function toRemoteHtml(html: string): Promise<string> {
  if (!html || typeof window === 'undefined' || !window.electronAPI) return html

  const sources = new Set<string>()
  const sourcePattern = /<img\b[^>]*?\bsrc=["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = sourcePattern.exec(html))) {
    if (isRelativeImagePath(match[1])) sources.add(match[1].replace(/^\.\//, ''))
  }
  if (sources.size === 0) return html

  const replacements = await Promise.all(
    [...sources].map(async (source) => {
      try {
        const blob = await sourceToBlob(toDisplayImageUrl(source))
        return [source, await blobToDataUrl(blob)] as const
      } catch {
        return [source, source] as const
      }
    }),
  )
  const replacementMap = new Map(replacements)

  return html.replace(
    /(<img\b[^>]*?\bsrc=["'])(\.?\/?images\/[^"']+)(["'][^>]*>)/gi,
    (original, prefix: string, source: string, suffix: string) => {
      const replacement = replacementMap.get(source.replace(/^\.\//, ''))
      return replacement && replacement !== source ? `${prefix}${replacement}${suffix}` : original
    },
  )
}

export async function saveImage(
  notebookId: string,
  source: Blob | string,
): Promise<{ relativePath: string; displayUrl: string }> {
  if (!notebookId) throw new Error('A notebook must be selected before adding an image')

  if (typeof source === 'string') {
    if (source.startsWith(IMAGE_SCHEME_PREFIX)) {
      const relativePath = decodeURIComponent(source.slice(IMAGE_SCHEME_PREFIX.length))
      return { relativePath, displayUrl: source }
    }
    if (isRelativeImagePath(source)) {
      return { relativePath: source, displayUrl: toDisplayImageUrl(source) }
    }
  }

  const blob = await sourceToBlob(source)
  if (!window.electronAPI?.saveImage) {
    const dataUrl = await blobToDataUrl(blob)
    return { relativePath: dataUrl, displayUrl: dataUrl }
  }

  const mimeType = blob.type.toLowerCase() || 'image/png'
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const relativePath = await window.electronAPI.saveImage(notebookId, bytes, mimeType)
  return { relativePath, displayUrl: toDisplayImageUrl(relativePath) }
}
