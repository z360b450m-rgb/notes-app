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
      let relativePath: string
      try {
        relativePath = decodeURIComponent(encodedPath)
      } catch {
        return _match
      }
      return isRelativeImagePath(relativePath) ? `${prefix}${relativePath}${suffix}` : _match
    },
  )
}

async function sourceToBlob(source: Blob | string): Promise<Blob> {
  if (source instanceof Blob) return source
  const response = await fetch(source)
  if (!response.ok) throw new Error('Unable to read the selected image')
  return response.blob()
}

export async function saveImage(
  notebookId: string,
  source: Blob | string,
): Promise<{ relativePath: string; displayUrl: string }> {
  if (!notebookId) throw new Error('A notebook must be selected before adding an image')
  if (!window.electronAPI?.saveImage) {
    throw new Error('Image folder storage is available in the desktop app')
  }

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
  const mimeType = blob.type.toLowerCase() || 'image/png'
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const relativePath = await window.electronAPI.saveImage(notebookId, bytes, mimeType)
  return { relativePath, displayUrl: toDisplayImageUrl(relativePath) }
}
