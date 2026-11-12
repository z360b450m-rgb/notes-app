export function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const unique = new Map<string, T>()
  for (const item of items) unique.set(item.id, item)
  return Array.from(unique.values())
}

export function prependById<T extends { id: string }>(items: readonly T[], item: T): T[] {
  return [item, ...items.filter((existing) => existing.id !== item.id)]
}

export function appendById<T extends { id: string }>(items: readonly T[], item: T): T[] {
  return [...items.filter((existing) => existing.id !== item.id), item]
}
