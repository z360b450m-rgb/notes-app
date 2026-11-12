import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import source from './content/user-guide.md?raw'
import { guideFigures } from './guideScreenshots'

export const guideGroups = [
  { id: 'start', title: '开始使用', description: '了解使用条件，创建和管理错题本。', symbol: '01' },
  {
    id: 'organize',
    title: '录入与整理',
    description: '录入文字和图片，导入试卷并管理题组。',
    symbol: '02',
  },
  {
    id: 'learn',
    title: '学习与复习',
    description: '完成复习，使用学习助手、知识库和词库。',
    symbol: '03',
  },
  {
    id: 'manage',
    title: '偏好与数据',
    description: '设置编辑偏好，备份和迁移学习数据。',
    symbol: '04',
  },
] as const

type ChapterMeta = {
  group: (typeof guideGroups)[number]['id']
  description: string
  time: string
  entry: string
}

const chapters: Record<string, ChapterMeta> = {
  overview: {
    group: 'start',
    description: '查阅功能说明、操作步骤和常见问题。',
    time: '导航',
    entry: '按功能选择章节',
  },
  'quick-start': {
    group: 'start',
    description: '创建错题本、录入题目并完成首次复习。',
    time: '3 分钟',
    entry: '官网 → 进入网页版',
  },
  notebooks: {
    group: 'start',
    description: '创建、编辑和排列错题本，查看首页与复习计划。',
    time: '2 分钟',
    entry: '应用首页 → 新建错题本',
  },
  folders: {
    group: 'organize',
    description: '创建文件夹，移动单题或整批题目，管理未归档内容。',
    time: '4 分钟',
    entry: '错题本 → 左侧题目列表 → 新建文件夹',
  },
  classification: {
    group: 'organize',
    description: '设置学科、标签和来源，组合筛选并执行批量操作。',
    time: '4 分钟',
    entry: '错题本 → 左侧分类；题目上方 → 分类信息',
  },
  editing: {
    group: 'organize',
    description: '录入题目和答案，设置格式并添加图片或批注。',
    time: '4 分钟',
    entry: '错题本 → 新建错题',
  },
  'image-text': {
    group: 'organize',
    description: '将照片或截图转换为可编辑文字，裁剪、校对并保留原图。',
    time: '4 分钟',
    entry: '题目、公共材料或答案编辑区 → 导入图片',
  },
  'question-groups': {
    group: 'organize',
    description: '管理公共材料和小题，分别保存答案与复习记录。',
    time: '2 分钟',
    entry: '题目编辑区 → 转为题组',
  },
  importing: {
    group: 'organize',
    description: '导入 PDF 试卷或带题号的文本，核对后保存。',
    time: '4 分钟',
    entry: '工作区 → 更多 → 导入 PDF / 导入文本',
  },
  reviewing: {
    group: 'learn',
    description: '选择复习范围，提交答案与理由，并查看核对结果。',
    time: '4 分钟',
    entry: '工作区工具栏 → 进入复习',
  },
  assistant: {
    group: 'learn',
    description: '发起学习对话，讨论单题或安排关联复习。',
    time: '3 分钟',
    entry: '应用首页 → 开始复习；单题 → 学习助手',
  },
  knowledge: {
    group: 'learn',
    description: '导入学习资料，更新错题索引并设置对话参考范围。',
    time: '4 分钟',
    entry: '学习助手 → 知识库管理',
  },
  vocabulary: {
    group: 'learn',
    description: '创建和导入词库，按计划完成单词训练。',
    time: '3 分钟',
    entry: '错题本插件 → 语言学习',
  },
  statistics: {
    group: 'learn',
    description: '查看总体统计、复习历史和单题记录。',
    time: '2 分钟',
    entry: '工作区工具栏 → 统计',
  },
  backup: {
    group: 'manage',
    description: '导入和导出归档，或生成用于阅读和打印的 PDF。',
    time: '3 分钟',
    entry: '工作区 → 更多 → 导出归档',
  },
  settings: {
    group: 'manage',
    description: '设置保存方式、字号、默认错题本和编辑布局。',
    time: '2 分钟',
    entry: '侧边栏 → 设置',
  },
  shortcuts: {
    group: 'manage',
    description: '查看新建、保存、切换题目和批注的快捷键。',
    time: '1 分钟',
    entry: '错题本工作区',
  },
  faq: {
    group: 'manage',
    description: '处理登录、识别、判卷、保存和服务连接中的常见问题。',
    time: '随时查阅',
    entry: '按遇到的问题查找',
  },
}

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: false })

export const guideSections = source
  .split(/^## /m)
  .slice(1)
  .map((section) => {
    const newline = section.indexOf('\n')
    const heading = section.slice(0, newline).trim()
    const match = heading.match(/^(.+?)\s+\{#([a-z0-9-]+)\}$/)
    if (!match || !chapters[match[2]]) throw new Error(`Unknown guide heading: ${heading}`)
    const body = section.slice(newline + 1).trim()
    const toc: { id: string; title: string; depth: number }[] = []
    const blocks = body.split(/^:::figure ([a-z0-9-]+)\s*$/m).map((part, index) => {
      if (index % 2) {
        if (!guideFigures[part]) throw new Error(`Unknown guide figure: ${part}`)
        return { type: 'figure' as const, figure: guideFigures[part] }
      }
      const tokens = markdown.parse(part, {})
      tokens.forEach((token, tokenIndex) => {
        const level = Number(token.tag.slice(1))
        if (token.type === 'heading_open' && [3, 4].includes(level)) {
          const anchor = `${match[2]}-step-${toc.length + 1}`
          token.attrSet('id', anchor)
          toc.push({ id: anchor, title: tokens[tokenIndex + 1].content, depth: level - 3 })
        }
        // The page title is h1; Markdown h3/h4 become h2/h3.
        if ([3, 4].includes(level) && ['heading_open', 'heading_close'].includes(token.type)) {
          token.tag = `h${level - 1}`
        }
      })
      return {
        type: 'html' as const,
        html: DOMPurify.sanitize(markdown.renderer.render(tokens, markdown.options, {})),
      }
    })
    return {
      ...chapters[match[2]],
      id: match[2],
      title: match[1],
      toc,
      blocks,
      text: body
        .replace(/^:::figure .*$/gm, '')
        .replace(/[#*`>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    }
  })
