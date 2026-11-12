import { ref } from 'vue'
import { useNotebooks } from './useNotebooks'
import { entryRepository, questionGroupRepository } from '@/services/db'
import type { NoteEntry } from '@/types'

export function useDesignExamples() {
  const busy = ref(false)
  const error = ref('')
  const { notebooks, createNotebook } = useNotebooks()
  async function create(): Promise<string | undefined> {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      const existing = notebooks.value.find((n) => n.instructions === 'design-showcase-v1')
      if (existing) return existing.id
      const nb = await createNotebook(
        '设计展示',
        '高亮 · 链接 · 选择题 · 共享材料 · 长文本',
        'design-showcase-v1',
      )
      const now = Date.now()
      const ids = Array.from({ length: 6 }, () => crypto.randomUUID())
      const groupId = crypto.randomUUID()
      const link = (index: number, label: string) =>
        `<a data-entry-link="${ids[index]}">${label}</a>`
      const highlight = (color: string, text: string) =>
        `<span style="background-color:${color};color:#393832">${text}</span>`
      const samples = [
        {
          title: '01 · 高亮与链接',
          subject: '设计指南',
          tags: ['高亮', '题目链接'],
          question: `<p><strong>这是一份可以直接编辑的设计展示。</strong></p><p>用不同颜色区分：${highlight('#fff59d', '黄色：核心概念')}、${highlight('#b9f6ca', '绿色：正确思路')}、${highlight('#ffccbc', '橙色：易错提醒')}。</p><p>题目之间也可以互相连接：${link(1, '查看选择题示例')}，${link(2, '查看富文本笔记')}。</p><p>高亮和链接可以叠加：${highlight('#fff59d', link(1, '高亮的题目链接'))}。点击链接可查看链接管理和跳转。</p>`,
          wrongAnswer:
            '<p>只记答案，忽略了<strong>条件和推理过程</strong>。</p><p><span style="background-color:#ffccbc;color:#393832">易错点：高亮整段会让重点失去层次。</span></p>',
          correctAnswer:
            '<p><strong>建议使用方式</strong></p><ol><li>选中文字，再点工具栏荧光笔。</li><li>给关键条件加高亮，结论加粗。</li><li>用题目链接连接相关知识点。</li></ol><p>试试拖动分隔条、隐藏答案，以及切换深色主题。</p>',
        },
        {
          title: '02 · 选择题与答案对照',
          subject: '英语',
          tags: ['选择题', '重点'],
          question:
            '<p><strong>Choose the correct answer.</strong></p><p>If I ___ more time, I would read the book again.</p><p>A. have</p><p>B. had</p><p>C. will have</p><p>D. am having</p>',
          wrongAnswer: '<p>A. have</p><p>把假设的情境误当成了真实情况。</p>',
          correctAnswer: `<p><strong>B. had</strong></p><p>这是对现在情况的虚拟假设：${highlight('#fff59d', 'If + 一般过去时，would + 动词原形')}。</p><p>进入复习后，可体验选项点击和答题反馈。</p>`,
        },
        {
          title: '03 · 富文本与结构化笔记',
          subject: '设计指南',
          tags: ['加粗', '列表', '表格'],
          question:
            '<p><strong style="font-size:22px">建立有层次的学习笔记</strong></p><p>普通正文负责解释，<strong>加粗文字</strong>负责强调，<em>斜体文字</em>用于补充，<u>下划线</u>用于提示。</p><blockquote>好的笔记应该让下一次复习更容易。</blockquote><ul><li>第一层：问题与条件</li><li>第二层：错误思路</li><li>第三层：正确解法与回顾</li></ul>',
          wrongAnswer:
            '<p><s>把所有内容都设成重点。</s></p><p>一整页没有段落，回看时找不到关键结论。</p>',
          correctAnswer: `<table><thead><tr><th>用途</th><th>推荐格式</th></tr></thead><tbody><tr><td>结论</td><td><strong>加粗</strong></td></tr><tr><td>条件</td><td>${highlight('#fff59d', '高亮')}</td></tr><tr><td>步骤</td><td>有序列表</td></tr></tbody></table><p>关联阅读：${link(0, '高亮与链接')}。</p>`,
        },
        {
          title: '04 · 阅读材料 / 主旨题',
          subject: '语文',
          tags: ['公共材料', '阅读理解'],
          groupId,
          subQuestionOrder: 0,
          question: '<p><strong>问题一：</strong>文中的“慢下来”表达了怎样的生活态度？</p>',
          wrongAnswer: '<p>什么都不做，等待机会出现。</p>',
          correctAnswer: `<p>${highlight('#b9f6ca', '主动观察、专注当下，而不是消极停滞。')}</p><p>结合材料中“看见细节”和“听见自己的想法”作答。</p>`,
        },
        {
          title: '05 · 阅读材料 / 细节题',
          subject: '语文',
          tags: ['公共材料', '关联题'],
          groupId,
          subQuestionOrder: 1,
          question: '<p><strong>问题二：</strong>作者为什么提到树影和街角的花？</p>',
          wrongAnswer: '<p>单纯为了介绍街道的风景。</p>',
          correctAnswer: `<p>通过具体细节，说明放慢脚步后可以发现被忽略的美。</p><p>与上一小题关联：${link(3, '回看主旨题')}。</p>`,
        },
        {
          title: '06 · 长文本与滚动布局',
          subject: '学习方法',
          tags: ['长文本', '布局'],
          question:
            '<p><strong>如何复盘一次错误？</strong></p>' +
            Array.from(
              { length: 8 },
              (_, i) =>
                `<p><strong>${i + 1}. ${['重读条件', '回忆思路', '定位偏差', '对照解析', '提炼规律', '寻找关联', '重新作答', '安排复习'][i]}</strong></p><p>先用自己的语言解释这个环节，再写下可以执行的下一步。区分知识缺口与操作失误，保持记录简短、具体，避免只抄写答案。展开题目区域后，可以查看完整内容；拖动分隔条能调整阅读空间。</p>`,
            ).join(''),
          wrongAnswer: '<p>看懂解析后就认为已经掌握，没有再次独立作答。</p>',
          correctAnswer: `<p><strong>闭环：定位问题 → 提炼规则 → 独立重做 → 间隔复习。</strong></p><p>${highlight('#fff59d', '看懂不等于会做。')}</p><p>参考：${link(2, '结构化笔记')}。</p>`,
        },
      ]
      await questionGroupRepository.put(nb.id, {
        id: groupId,
        notebookId: nb.id,
        title: '慢下来，才看得见',
        material: `<p><strong style="font-size:22px">慢下来，才看得见</strong></p><p>我们习惯匆忙走过熟悉的街道，目光追着下一个目的地。直到某个午后，我停下脚步，看见树影在墙上缓缓移动，也看见街角一朵刚刚开放的花。</p><p>${highlight('#fff59d', '慢下来，并不是停止前行，而是重新找回观察的能力。')}当外面的声音安静一点，我们也更容易听见自己的想法。</p><p>这段材料对应两道小题。可以用“上一小题 / 下一小题”切换，公共材料保持共享。</p>`,
        createdAt: now,
        updatedAt: now,
      })
      for (const [index, sample] of samples.entries()) {
        const entry: NoteEntry = {
          ...sample,
          id: ids[index],
          notebookId: nb.id,
          source: '设计展示示例',
          folder: '',
          sortOrder: index,
          createdAt: now + index,
          updatedAt: now - index,
          reviewCount: 0,
          masteryLevel: 0,
          nextReviewDate: now,
        }
        await entryRepository.put(nb.id, entry)
      }
      return nb.id
    } catch (e) {
      error.value = e instanceof Error ? e.message : '创建示例失败'
    } finally {
      busy.value = false
    }
  }
  return { busy, error, create }
}
