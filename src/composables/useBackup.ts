import type { NoteEntry } from '@/types'
import {
  entryRepository,
  notebookRepository,
  questionGroupRepository,
  reviewLogRepository,
} from '@/services/db'
import { importBrowserArchive } from '@/services/archiveImport'
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
// 网页版导入同时兼容旧版题目数组与桌面版完整归档。
// ===================================================================
export function useBackup(
  getEntries: () => NoteEntry[] | Promise<NoteEntry[]>,
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
    let entries: NoteEntry[]
    try {
      entries = await getEntries()
    } catch {
      onToast('部分题目内容无法加载，请恢复连接后重试导出')
      return
    }
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
          const html = entry[field] || ''
          const { html: replaced, images } = extractImages(html)
          entry[field] = replaced
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

    const targetNotebookId = getNotebookId()
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.ctb,.zip'

    // Keep the caller waiting until import finishes, including notebook refresh.
    await new Promise<void>((resolve) => {
      input.oncancel = () => resolve()
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) {
          resolve()
          return
        }
        let imported = 0
        try {
          const zip = await JSZip.loadAsync(file)
          const result = await importBrowserArchive(zip, targetNotebookId, keepReviewState, {
            entries: entryRepository,
            notebooks: notebookRepository,
            groups: questionGroupRepository,
            logs: reviewLogRepository,
          })
          imported = result.imported
          await reload()
          let msg = `成功导入 ${imported} 条错题` + (!keepReviewState ? ' (已重置进度)' : '')
          if (result.skipped > 0) msg += `，跳过 ${result.skipped} 条无效数据`
          onToast(msg)
        } catch (err) {
          console.error('导入归档失败', err)
          if (imported > 0) {
            onToast(`已导入 ${imported} 条错题，但列表刷新失败，请刷新页面查看`)
          } else {
            onToast(`导入失败：${err instanceof Error ? err.message : '无法解析归档文件'}`)
          }
        } finally {
          resolve()
        }
      }
      input.click()
    })
  }

  return { exportData, importData, importModalVisible, handleImportOption }
}
