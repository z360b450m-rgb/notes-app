export interface AgentEntryTarget {
  entryId: string
  notebookId?: string
}

// 应用内题目链接使用片段，点击时由错题本工作区打开原题。
export function parseAgentEntryLink(href: string): AgentEntryTarget | null {
  const match = /^#\/notebooks\/([^/]+)\/entries\/([^/?#]+)$/.exec(href)
  const legacy = /^#(?:\/entries\/|entry[-=:])([^/?#]+)$/.exec(href)
  if (!match && !legacy) return null
  try {
    const entryId = decodeURIComponent(match?.[2] ?? legacy![1])
    const notebookId = match ? decodeURIComponent(match[1]) : undefined
    if (!entryId.trim() || (notebookId !== undefined && !notebookId.trim())) return null
    return { entryId, notebookId }
  } catch {
    return null
  }
}
