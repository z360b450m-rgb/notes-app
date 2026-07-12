<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import type { NoteEntry } from '@/types'
import { detectGarbledText, type GarbledSpan } from '@/utils/parsePdf'
import { sanitizeHtml } from '@/utils/sanitize'

const props = defineProps<{
  entries: Partial<NoteEntry>[]
  loading: boolean
}>()

const emit = defineEmits<{
  confirm: [entries: Partial<NoteEntry>[]]
  cancel: []
}>()

// Mutable local copy
const local = ref<Partial<NoteEntry>[]>([])

watch(
  () => props.entries,
  (val) => {
    local.value = val.map((e) => ({ ...e }))
  },
  { immediate: true },
)

// contenteditable element refs, indexed by `${i}` for question, `${i}-wrong` / `${i}-correct` for answers
const questionRefs = ref<Record<string, HTMLElement | null>>({})
const answerRefs = ref<Record<string, HTMLElement | null>>({})

// --- Garbled detection ---
function garbledForEntry(entry: Partial<NoteEntry>): GarbledSpan[] {
  const allText = [entry.question, entry.wrongAnswer, entry.correctAnswer]
    .filter(Boolean)
    .join('\n')
  return detectGarbledText(allText)
}

function hasGarbled(entry: Partial<NoteEntry>): boolean {
  return garbledForEntry(entry).length > 0
}

// --- Sync contenteditable → local ---
function syncQuestion(i: number) {
  const el = questionRefs.value[String(i)]
  if (el) local.value[i].question = el.innerHTML
}

function syncAnswer(i: number, field: 'wrongAnswer' | 'correctAnswer') {
  const el = answerRefs.value[`${i}-${field}`]
  if (el) local.value[i][field] = el.innerHTML
}

// --- Image paste ---
function onPasteQuestion(e: ClipboardEvent, i: number) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile()
      if (!blob) continue
      const reader = new FileReader()
      reader.onload = () => {
        const img = document.createElement('img')
        img.src = reader.result as string
        img.style.maxWidth = '100%'
        img.style.borderRadius = '6px'
        const sel = window.getSelection()
        if (!sel) return
        const range = sel.getRangeAt(0)
        range.deleteContents()
        range.insertNode(img)
        range.collapse(false)
        const br = document.createElement('br')
        range.insertNode(br)
        range.setStartAfter(br)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        syncQuestion(i)
      }
      reader.readAsDataURL(blob)
      break
    }
  }
}

// --- getTextOffset: count characters before a DOM node within a root element ---
function getTextOffset(root: HTMLElement, node: Node, offset: number): number {
  let total = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n = walker.nextNode()
  while (n) {
    if (n === node) {
      total += offset
      break
    }
    total += (n.textContent || '').length
    n = walker.nextNode()
  }
  return total
}

// --- Merge / Split ---

function mergeUp(i: number) {
  if (i <= 0) return
  const target = local.value[i - 1]
  const src = local.value[i]
  target.question = (target.question || '') + '\n' + (src.question || '')
  if (src.wrongAnswer) target.wrongAnswer = (target.wrongAnswer || '') + '\n' + src.wrongAnswer
  if (src.correctAnswer)
    target.correctAnswer = (target.correctAnswer || '') + '\n' + src.correctAnswer
  local.value.splice(i, 1)
  // Clean up orphaned refs
  delete questionRefs.value[String(i)]
  delete answerRefs.value[`${i}-wrong`]
  delete answerRefs.value[`${i}-correct`]
}

function mergeDown(i: number) {
  if (i >= local.value.length - 1) return
  const target = local.value[i]
  const src = local.value[i + 1]
  target.question = (target.question || '') + '\n' + (src.question || '')
  if (src.wrongAnswer)
    target.wrongAnswer = (target.wrongAnswer || '') + '\n' + (target.wrongAnswer || '')
  if (src.correctAnswer)
    target.correctAnswer = (target.correctAnswer || '') + '\n' + (target.correctAnswer || '')
  local.value.splice(i + 1, 1)
  delete questionRefs.value[String(i + 1)]
  delete answerRefs.value[`${i + 1}-wrong`]
  delete answerRefs.value[`${i + 1}-correct`]
}

async function splitAtCursor(i: number) {
  const key = String(i)
  const el = questionRefs.value[key]
  if (!el) return
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return

  const offset = getTextOffset(el, range.startContainer, range.startOffset)
  const fullText = el.innerText || el.textContent || ''
  if (offset <= 0 || offset >= fullText.length) return

  const headText = fullText.slice(0, offset).trim()
  const tailText = fullText.slice(offset).trim()
  if (!headText || !tailText) return

  // Update current card
  el.innerText = headText
  local.value[i].question = headText

  // Insert new card after
  const newEntry: Partial<NoteEntry> = {
    ...local.value[i],
    question: tailText,
    wrongAnswer: '',
    correctAnswer: '',
    tags: [...(local.value[i].tags || [])],
  }
  local.value.splice(i + 1, 0, newEntry)

  // Focus the new card's question element
  await nextTick()
  const newKey = String(i + 1)
  const newEl = questionRefs.value[newKey]
  newEl?.focus()
}

// --- Confirm ---
function handleConfirm() {
  const cleaned = local.value.map((e) => ({
    ...e,
    question: sanitizeHtml(e.question || ''),
    wrongAnswer: sanitizeHtml(e.wrongAnswer || ''),
    correctAnswer: sanitizeHtml(e.correctAnswer || ''),
  }))
  emit('confirm', cleaned)
}

const entryCount = computed(() => local.value.length)
</script>

<template>
  <Transition name="stats">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      @click.self="emit('cancel')"
    >
      <div
        class="bg-white dark:bg-[#1e1e1c] rounded-2xl shadow-xl border border-gray-200 dark:border-[#2e2e2c] w-full max-w-4xl mx-4 h-[90vh] flex flex-col overflow-hidden"
      >
        <!-- === HEADER === -->
        <div
          class="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-[#2e2e2c] flex-shrink-0"
        >
          <div class="flex items-center gap-2.5">
            <h2 class="text-[15px] font-semibold text-gray-800 dark:text-brand-light-gray">
              校对导入结果
            </h2>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
              {{ entryCount }} 题
            </span>
          </div>
          <button
            class="flex items-center justify-center w-7 h-7 rounded-md text-gray-400 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors"
            :disabled="loading"
            @click="emit('cancel')"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- === BODY: scrollable card list === -->
        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div
            v-for="(entry, i) in local"
            :key="i"
            class="bg-white dark:bg-[#141413] border border-gray-100 dark:border-[#2e2e2c] rounded-xl shadow-sm overflow-hidden"
          >
            <!-- Card header -->
            <div
              class="flex items-center gap-2 px-3.5 py-2 border-b border-gray-100 dark:border-[#2e2e2c] bg-brand-light dark:bg-[#1e1e1c]"
            >
              <span class="text-xs font-semibold text-gray-400 dark:text-brand-mid flex-shrink-0">
                #{{ i + 1 }}
              </span>

              <!-- Subject -->
              <input
                v-model="entry.subject"
                class="w-16 text-[11px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-600 dark:text-brand-light-gray outline-none focus:border-accent/40 transition-colors"
                placeholder="学科"
              />

              <!-- Source -->
              <input
                v-model="entry.source"
                class="w-20 text-[11px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-600 dark:text-brand-light-gray outline-none focus:border-accent/40 transition-colors"
                placeholder="来源"
              />

              <!-- Garbled badge -->
              <span
                v-if="hasGarbled(entry)"
                class="ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium flex-shrink-0"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                  />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                含乱码字符
              </span>
            </div>

            <!-- Question -->
            <div class="px-3.5 py-3">
              <div class="text-[11px] text-gray-400 dark:text-brand-mid mb-1 font-semibold">
                题目
              </div>
              <div
                :ref="
                  (el) => {
                    if (el) questionRefs[String(i)] = el as HTMLElement
                  }
                "
                contenteditable="true"
                class="text-sm leading-relaxed outline-none min-h-[40px] rounded-md border border-transparent focus:border-accent/40 focus:bg-gray-50 dark:focus:bg-[#1e1e1c] px-2 py-1.5 transition-colors md-content"
                @input="syncQuestion(i)"
                @paste="onPasteQuestion($event, i)"
                v-html="entry.question || ''"
              />

              <!-- Garbled details -->
              <template v-if="hasGarbled(entry)">
                <div
                  class="mt-1.5 px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-900/15 text-[10px] text-amber-600 dark:text-amber-400"
                >
                  检测到疑似乱码字符（数学公式提取失败）。建议删除乱码后粘贴题目截图代替。
                </div>
                <div class="flex flex-wrap gap-1 mt-1">
                  <span
                    v-for="(g, gi) in garbledForEntry(entry)"
                    :key="gi"
                    class="text-[10px] px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 font-mono cursor-default"
                    :title="g.context"
                  >
                    {{ g.text.length > 8 ? g.text.slice(0, 8) + '...' : g.text }}
                  </span>
                </div>
              </template>
            </div>

            <!-- Answers (if present) -->
            <div
              v-if="entry.wrongAnswer || entry.correctAnswer"
              class="px-3.5 pb-3 border-t border-gray-50 dark:border-[#2a2a28] pt-2 space-y-2"
            >
              <div v-if="entry.wrongAnswer">
                <div class="text-[11px] text-gray-400 dark:text-brand-mid mb-1 font-semibold">
                  错误答案
                </div>
                <div
                  :ref="
                    (el) => {
                      if (el) answerRefs[`${i}-wrong`] = el as HTMLElement
                    }
                  "
                  contenteditable="true"
                  class="text-sm leading-relaxed outline-none min-h-[30px] rounded-md border border-transparent focus:border-accent/40 focus:bg-gray-50 dark:focus:bg-[#1e1e1c] px-2 py-1.5 transition-colors"
                  @input="syncAnswer(i, 'wrongAnswer')"
                  v-html="entry.wrongAnswer || ''"
                />
              </div>
              <div v-if="entry.correctAnswer">
                <div class="text-[11px] text-gray-400 dark:text-brand-mid mb-1 font-semibold">
                  正确答案
                </div>
                <div
                  :ref="
                    (el) => {
                      if (el) answerRefs[`${i}-correct`] = el as HTMLElement
                    }
                  "
                  contenteditable="true"
                  class="text-sm leading-relaxed outline-none min-h-[30px] rounded-md border border-transparent focus:border-accent/40 focus:bg-gray-50 dark:focus:bg-[#1e1e1c] px-2 py-1.5 transition-colors"
                  @input="syncAnswer(i, 'correctAnswer')"
                  v-html="entry.correctAnswer || ''"
                />
              </div>
            </div>

            <!-- Action bar -->
            <div
              class="flex items-center gap-1.5 px-3.5 py-2 border-t border-gray-100 dark:border-[#2e2e2c] bg-gray-50/50 dark:bg-[#1a1a18]"
            >
              <button
                class="text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-[#2e2e2c] text-gray-500 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                :disabled="i === 0"
                @click="mergeUp(i)"
              >
                ↑ 合并到上题
              </button>
              <button
                class="text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-[#2e2e2c] text-gray-500 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                :disabled="i >= entryCount - 1"
                @click="mergeDown(i)"
              >
                ↓ 合并到下题
              </button>
              <button
                class="text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-[#2e2e2c] text-gray-500 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors"
                @click="splitAtCursor(i)"
              >
                ✂ 光标处拆分
              </button>
            </div>
          </div>

          <!-- Empty state -->
          <div
            v-if="entryCount === 0"
            class="text-center py-12 text-sm text-gray-400 dark:text-brand-mid"
          >
            未解析出题目
          </div>
        </div>

        <!-- === FOOTER === -->
        <div
          class="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-[#2e2e2c] flex-shrink-0 bg-brand-light dark:bg-[#1a1a18]"
        >
          <span class="text-[12px] text-gray-400 dark:text-brand-mid">
            共
            <span class="font-semibold text-gray-600 dark:text-brand-light-gray">
              {{ entryCount }}
            </span>
            道题
          </span>
          <div class="flex gap-2">
            <button
              class="px-4 py-2 text-[12px] rounded-lg text-gray-500 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors"
              :disabled="loading"
              @click="emit('cancel')"
            >
              取消
            </button>
            <button
              class="px-5 py-2 text-[12px] font-medium rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              :disabled="loading || entryCount === 0"
              @click="handleConfirm"
            >
              确认导入 {{ entryCount }} 道题
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
