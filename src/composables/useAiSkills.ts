// AI 指令库：用 localStorage 持久化，简单可靠。
// 用户在 AI 问答输入框敲 /<trigger> 即可触发对应 skill 的 systemPrompt。
import { ref, computed } from 'vue'
import type { AiSkill } from '@/types'

const STORAGE_KEY = 'ai_skills_v1'

function genId(): string {
  return 'skill_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

function builtinSeeds(): AiSkill[] {
  // 内置示例 —— 用户可自由编辑或删除。
  // 你想新增 skill 的话，直接在 AI 问答 → 设置面板 → AI 指令库 里添加，
  // 这里只是首次启动的种子。
  const now = Date.now()
  return [
    {
      id: genId(),
      name: '错题讲解',
      trigger: '讲解',
      description: '用引导式提问帮我理清思路，不直接给答案',
      systemPrompt:
        '你是一位苏格拉底式的辅导老师。用户正在复习一道错题。\n' +
        '请按这个顺序回答：\n' +
        '1. 先提一个引导性问题，让我说出自己的思路\n' +
        '2. 指出我可能在哪一步出错\n' +
        '3. 用一个生活化的类比解释关键概念\n' +
        '4. 最后给出完整解题步骤\n' +
        '语气要温和鼓励，回答控制在 200 字以内。',
      scope: 'entry',
      enabled: true,
      updatedAt: now,
    },
    {
      id: genId(),
      name: '极简答案',
      trigger: '答',
      description: '只给关键答案，不要长篇大论',
      systemPrompt: '直接给最关键的答案或结论，不超过 3 句话，禁止使用 markdown 标题和加粗。',
      scope: 'both',
      enabled: true,
      updatedAt: now,
    },
    {
      id: genId(),
      name: '记忆口诀',
      trigger: '口诀',
      description: '为当前知识点编一个朗朗上口的口诀',
      systemPrompt:
        '你是一位擅长编口诀的助记专家。基于当前内容，编 1-2 句押韵、朗朗上口的口诀帮助记忆，' +
        '然后用 1 句话解释口诀含义。',
      scope: 'both',
      enabled: true,
      updatedAt: now,
    },
  ]
}

function load(): AiSkill[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const seeds = builtinSeeds()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeds))
      return seeds
    }
    return JSON.parse(raw) as AiSkill[]
  } catch {
    return builtinSeeds()
  }
}

const skills = ref<AiSkill[]>(load())

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(skills.value))
}

export function useAiSkills() {
  const enabledSkills = computed(() => skills.value.filter((s) => s.enabled))

  function create(partial?: Partial<AiSkill>): AiSkill {
    const now = Date.now()
    const skill: AiSkill = {
      id: genId(),
      name: partial?.name ?? '新指令',
      trigger: partial?.trigger ?? '',
      description: partial?.description ?? '',
      systemPrompt: partial?.systemPrompt ?? '',
      scope: partial?.scope ?? 'both',
      enabled: partial?.enabled ?? true,
      updatedAt: now,
    }
    skills.value.unshift(skill)
    persist()
    return skill
  }

  function update(id: string, patch: Partial<AiSkill>) {
    const idx = skills.value.findIndex((s) => s.id === id)
    if (idx === -1) return
    skills.value[idx] = { ...skills.value[idx], ...patch, updatedAt: Date.now() }
    persist()
  }

  function remove(id: string) {
    skills.value = skills.value.filter((s) => s.id !== id)
    persist()
  }

  function resetToDefaults() {
    skills.value = builtinSeeds()
    persist()
  }

  /**
   * 解析输入框文本，看是否以 /<trigger> 开头。
   * 命中返回 { skill, question }；未命中返回 null。
   */
  function parseTrigger(
    input: string,
    scope: 'entry' | 'global',
  ): { skill: AiSkill; question: string } | null {
    const m = input.match(/^\/(\S+)\s*([\s\S]*)$/)
    if (!m) return null
    const trigger = m[1]
    const rest = m[2].trim()
    const skill = enabledSkills.value.find(
      (s) => s.trigger === trigger && (s.scope === 'both' || s.scope === scope),
    )
    if (!skill) return null
    return { skill, question: rest || input }
  }

  function exportJson(): string {
    return JSON.stringify(skills.value, null, 2)
  }

  function importJson(text: string): boolean {
    try {
      const arr = JSON.parse(text)
      if (!Array.isArray(arr)) return false
      skills.value = arr.map((s) => ({
        ...s,
        id: s.id ?? genId(),
        updatedAt: s.updatedAt ?? Date.now(),
      }))
      persist()
      return true
    } catch {
      return false
    }
  }

  return {
    skills,
    enabledSkills,
    create,
    update,
    remove,
    resetToDefaults,
    parseTrigger,
    exportJson,
    importJson,
  }
}
