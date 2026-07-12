import type { NoteEntry } from '@/types'
import { db } from '@/services/db'
import { ref } from 'vue'
import JSZip from 'jszip'

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

// Extract base64 <img> tags from HTML, replace with relative paths.
// Returns modified HTML and an array of { filename, data: base64-string }.
const IMG_RE = /<img[^>]+src="data:image\/(png|jpeg|jpg|gif|webp);base64,([^"]+)"/gi

function extractImages(html: string): {
  html: string
  images: { filename: string; data: string }[]
} {
  const images: { filename: string; data: string }[] = []
  let index = 0

  const replaced = html.replace(IMG_RE, (match, ext: string, b64: string) => {
    const mimeExt = ext === 'jpeg' ? 'jpg' : ext
    const filename = `img_${index}_${Date.now().toString(36)}.${mimeExt}`
    images.push({ filename, data: b64 })
    index++
    return match.replace(/src="data:image\/[^"]+"/i, `src="images/${filename}"`)
  })

  return { html: replaced, images }
}

function restoreImages(html: string, imageMap: Map<string, string>): string {
  return html.replace(/<img[^>]+src="images\/([^"]+)"[^>]*>/gi, (match, filename: string) => {
    const b64 = imageMap.get(filename)
    if (!b64) return match
    const ext = filename.split('.').pop()?.toLowerCase() || 'png'
    const mime = ext === 'jpg' ? 'jpeg' : ext
    return match.replace(/src="images\/[^"]+"/i, `src="data:image/${mime};base64,${b64}"`)
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ===================================================================
// @AI-GUIDE: 归档导入导出工具层 (.ctb)
//
// Electron 环境通过 IPC 调用主进程 (adm-zip + 原生对话框)。
// 浏览器环境使用 JSZip 在渲染进程内打包/解包。
// 两种环境产出的 .ctb 文件格式完全一致，可互相导入。
// ===================================================================
export function useBackup(
  getEntries: () => NoteEntry[],
  getNotebookId: () => string,
  reload: () => Promise<void>,
  onToast: (msg: string) => void,
) {
  // Import options modal state
  const importModalVisible = ref(false)
  let importModalResolve: ((value: boolean | null) => void) | null = null

  function handleImportOption(keep: boolean | null) {
    importModalVisible.value = false
    importModalResolve?.(keep)
  }

  async function exportData() {
    // Electron: native dialog + adm-zip
    if (window.electronAPI?.exportArchive) {
      const res = await window.electronAPI.exportArchive()
      onToast(res.message)
      return
    }

    // Browser: JSZip in-memory archive
    const entries = getEntries()
    if (entries.length === 0) {
      onToast('暂无错题可导出')
      return
    }

    try {
      const zip = new JSZip()
      const imagesDir = zip.folder('images')!

      // Deep-clone and extract images
      const exportEntries = JSON.parse(JSON.stringify(entries)) as NoteEntry[]
      for (const entry of exportEntries) {
        for (const field of ['question', 'wrongAnswer', 'correctAnswer'] as const) {
          const html = (entry as Record<string, string>)[field] || ''
          const { html: replaced, images } = extractImages(html)
          ;(entry as Record<string, string>)[field] = replaced
          for (const img of images) {
            imagesDir.file(img.filename, img.data, { base64: true })
          }
        }
      }

      zip.file('data.json', JSON.stringify(exportEntries, null, 2))

      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(blob, `错题本_${timestamp()}.ctb`)
      onToast(`已导出 ${entries.length} 条错题`)
    } catch (err) {
      console.error('导出归档失败', err)
      onToast('导出失败：无法创建归档文件')
    }
  }

  async function importData() {
    // Show import options modal first, wait for user choice
    const keepReviewState = await new Promise<boolean | null>((resolve) => {
      importModalResolve = resolve
      importModalVisible.value = true
    })

    if (keepReviewState === null) return

    // Electron: native dialog + adm-zip
    if (window.electronAPI?.importArchive) {
      const res = await window.electronAPI.importArchive(keepReviewState)
      if (res.success) await reload()
      onToast(res.message)
      return
    }

    // Browser: file picker + JSZip
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.ctb,.zip'

    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      try {
        const zip = await JSZip.loadAsync(file)

        const dataJson = zip.file('data.json')
        if (!dataJson) {
          onToast('导入失败：归档中缺少 data.json')
          return
        }

        const text = await dataJson.async('string')
        const data = JSON.parse(text)

        if (!Array.isArray(data)) {
          onToast('导入失败：数据格式不正确')
          return
        }

        // Collect images from archive
        const imageMap = new Map<string, string>()
        const imagesFolder = zip.folder('images')
        if (imagesFolder) {
          const imageFiles = Object.keys(imagesFolder.files).filter(
            (name) => !imagesFolder.files[name].dir,
          )
          for (const imgPath of imageFiles) {
            const filename = imgPath.replace(/^images\//, '')
            const base64 = await imagesFolder.file(imgPath)!.async('base64')
            imageMap.set(filename, base64)
          }
        }

        let imported = 0
        let skipped = 0

        for (const item of data) {
          if (!item.id || item.question === undefined) {
            skipped++
            continue
          }

          // Restore images in all rich-text fields
          for (const field of ['question', 'wrongAnswer', 'correctAnswer'] as const) {
            if (item[field] && typeof item[field] === 'string' && item[field].includes('images/')) {
              item[field] = restoreImages(item[field], imageMap)
            }
          }

          const sanitized: NoteEntry = {
            ...item,
            id: item.id,
            notebookId: getNotebookId() || item.notebookId || '',
            tags: Array.isArray(item.tags) ? item.tags : [],
            subject: item.subject || '',
            source: item.source || '',
            wrongAnswer: item.wrongAnswer || '',
            correctAnswer: item.correctAnswer || '',
            masteryLevel: keepReviewState ? item.masteryLevel || 0 : 0,
            consecutivePasses: keepReviewState ? item.consecutivePasses || 0 : 0,
            nextReviewDate: keepReviewState ? item.nextReviewDate : undefined,
            lastReviewDate: keepReviewState ? item.lastReviewDate : undefined,
            createdAt: item.createdAt || Date.now(),
            updatedAt: Date.now(),
          }
          await db.put(sanitized)
          imported++
        }

        await reload()

        if (imported === 0) {
          onToast('导入失败：未识别到有效错题数据')
        } else {
          let msg = `成功导入 ${imported} 条` + (!keepReviewState ? ' (已重置进度)' : '')
          if (skipped > 0) msg += `，跳过 ${skipped} 条`
          onToast(msg)
        }
      } catch (err) {
        console.error('导入归档失败', err)
        onToast('导入失败：无法解析归档文件')
      }
    }

    input.click()
  }

  return { exportData, importData, importModalVisible, handleImportOption }
}
