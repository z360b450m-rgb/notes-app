import type { NoteEntry } from '@/types'

export const INTERNAL_LINK_SELECTOR = '[data-entry-link]'

/** Remove linked-question nodes entirely for contexts such as review mode. */
export function stripInternalLinks(html: string): string {
  if (!html || !html.includes('data-entry-link')) return html
  if (typeof document === 'undefined') {
    return html.replace(
      /<a\b(?=[^>]*\bdata-entry-link(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)[^>]*>[\s\S]*?<\/a>/gi,
      '',
    )
  }
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll(INTERNAL_LINK_SELECTOR).forEach((link) => link.remove())
  return template.innerHTML
}

export function decorateInternalLinks(root: HTMLElement, entries: NoteEntry[]): void {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
  root.querySelectorAll<HTMLElement>(INTERNAL_LINK_SELECTOR).forEach((link) => {
    const targetId = link.dataset.entryLink?.trim() || ''
    const target = entriesById.get(targetId)
    const valid = !!target
    if (target && link.dataset.entryLinkLabel === 'auto') {
      link.textContent = target.title || '未命名题目'
    }
    link.dataset.entryLinkState = valid ? 'valid' : 'broken'
    link.title = valid ? '点击管理题目链接' : '关联题目已删除或不在当前笔记本中'
    link.setAttribute('role', 'link')
    link.setAttribute('tabindex', '0')
  })
}

export function syncInternalLinkLabels(
  html: string,
  targetId: string,
  oldTitle: string,
  newTitle: string,
): { html: string; changed: boolean } {
  if (!html || !html.includes('data-entry-link')) return { html, changed: false }
  const template = document.createElement('template')
  template.innerHTML = html
  let changed = false

  template.content.querySelectorAll<HTMLElement>(INTERNAL_LINK_SELECTOR).forEach((link) => {
    if (link.dataset.entryLink !== targetId) return
    const isLegacyAutoLabel =
      !link.dataset.entryLinkLabel && (link.textContent || '').trim() === oldTitle.trim()
    if (link.dataset.entryLinkLabel !== 'auto' && !isLegacyAutoLabel) return
    link.dataset.entryLinkLabel = 'auto'
    const nextLabel = newTitle.trim() || '未命名题目'
    if (link.textContent !== nextLabel) link.textContent = nextLabel
    changed = true
  })

  return { html: template.innerHTML, changed }
}

export function internalLinkTarget(event: Event): string | null {
  const target = event.target
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>(INTERNAL_LINK_SELECTOR)?.dataset.entryLink?.trim() || null
}
