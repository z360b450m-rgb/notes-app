export interface PdfOption {
  key: string
  text: string
}
export interface PdfQuestion {
  key: string
  source_number: string
  title: string
  stem: string
  kind: 'choice' | 'free_response'
  option_mode?: 'text' | 'image'
  options: PdfOption[]
  asset_keys: string[]
  group_key: string | null
  source_pages: number[]
  correct_answer: string
  explanation: string
  student_answer: string
  warnings: string[]
  answer_status: 'provided' | 'missing'
  standalone_material_text: string
  standalone_asset_keys: string[]
}
export interface PdfGroup {
  key: string
  title: string
  material_text: string
  asset_keys: string[]
  question_keys: string[]
  decision: 'suggested' | 'candidate'
  warnings: string[]
}
export interface PdfAsset {
  key: string
  url: string
  page_number: number
  width: number
  height: number
}
export interface PdfDraft {
  id: string
  notebook_id: string
  filename: string
  status: string
  revision: number
  message: string
  draft: {
    schema_version: 'pdf-question-draft-v1'
    page_count: number
    groups: PdfGroup[]
    questions: PdfQuestion[]
    assets: PdfAsset[]
    notices: string[]
  }
}

export function pdfQuestionIssues(question: PdfQuestion): string[] {
  const issues: string[] = []
  if (!question.stem.trim() && !question.asset_keys.length) issues.push('题干和本题图片均为空')
  if (question.kind !== 'choice') return issues
  if (!question.options.length && question.option_mode === 'image') {
    if (!question.asset_keys.length) issues.push('图形选项缺少本题原图')
    return issues
  }
  if (question.options.length < 2)
    issues.push(`仅有 ${question.options.length} 个文字选项，至少需要 2 个`)
  const keys = question.options.map((option) => option.key)
  const invalid = keys.filter((key) => !/^[A-H]$/.test(key))
  if (invalid.length) issues.push('选项字母须为 A–H，不能留空')
  const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))]
  if (duplicates.length) issues.push(`选项字母重复：${duplicates.join('、')}`)
  const empty = question.options
    .filter((option) => !option.text.trim())
    .map((option) => option.key || '未标注')
  if (empty.length) issues.push(`选项内容为空：${empty.join('、')}`)
  return issues
}
