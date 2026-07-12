import type { NoteEntry } from '@/types'

// ===================================================================
// @AI-GUIDE: PDF 导出工具层
// 纯格式化 + I/O 逻辑。按学科分组生成 HTML, 通过 window.print()
// 触发打印。生成内容的结构变更必须在此处实现, 不可在组件中拼接。
// ===================================================================
export function useExport(onToast: (msg: string) => void) {
  function exportPDF(entries: NoteEntry[]) {
    if (entries.length === 0) {
      onToast('暂无错题可导出')
      return
    }

    // Group by subject
    const groups: Record<string, NoteEntry[]> = {}
    for (const entry of entries) {
      const subj = entry.subject || '未分类'
      if (!groups[subj]) groups[subj] = []
      groups[subj].push(entry)
    }

    const now = new Date().toLocaleDateString('zh-CN')

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>错题本</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; color: #1a1a1a; padding: 32px; max-width: 210mm; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .date { font-size: 12px; color: #999; margin-bottom: 24px; }
  .subject { font-size: 16px; font-weight: 700; margin: 20px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
  .card { margin-bottom: 20px; padding: 14px 16px; border: 1px solid #e5e7eb; border-radius: 10px; page-break-inside: avoid; }
  .card-title { font-size: 11px; color: #999; margin-bottom: 6px; }
  .question { font-size: 14px; line-height: 1.6; margin-bottom: 10px; }
  .answer-label { font-size: 11px; font-weight: 600; margin-bottom: 4px; }
  .wrong { color: #ef4444; font-size: 13px; line-height: 1.5; margin-bottom: 6px; }
  .correct { color: #22c55e; font-size: 13px; line-height: 1.5; }
  hr { border: none; border-top: 1px dashed #e5e7eb; margin: 8px 0; }

  @media print {
    body { padding: 16px; }
    .card { border-color: #d1d5db; }
  }
</style>
</head>
<body>
<h1>错题本</h1>
<div class="date">导出日期：${now} · 共 ${entries.length} 题</div>
${Object.entries(groups)
  .map(
    ([subject, items]) => `
<div class="subject">${subject} (${items.length})</div>
${items
  .map(
    (e) => `
<div class="card">
  <div class="card-title">${e.source || ''} ${e.tags && e.tags.length > 0 ? '· ' + e.tags.join(', ') : ''}</div>
  <div class="question">${e.question || '(无题目)'}</div>
  ${e.wrongAnswer ? `<div class="answer-label">我的答案</div><div class="wrong">${e.wrongAnswer}</div>` : ''}
  ${e.wrongAnswer && e.correctAnswer ? '<hr>' : ''}
  ${e.correctAnswer ? `<div class="answer-label">正确答案</div><div class="correct">${e.correctAnswer}</div>` : ''}
</div>`,
  )
  .join('\n')}`,
  )
  .join('\n')}
</body>
</html>`

    const w = window.open('', '_blank')
    if (!w) {
      onToast('弹窗被拦截，请允许本站弹窗后重试')
      return
    }
    w.document.write(html)
    w.document.close()
    w.onload = () => {
      setTimeout(() => {
        w.print()
      }, 500)
    }
  }

  return { exportPDF }
}
