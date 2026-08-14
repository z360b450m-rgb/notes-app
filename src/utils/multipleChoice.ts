export interface MultipleChoiceOption {
  key: string
  content: string
}

export interface MultipleChoiceQuestion {
  stem: string
  options: MultipleChoiceOption[]
  correctOption: string | null
}

// Besides normal punctuation, some exam sources use “A①②③” with no separator.
const CIRCLED_NUMBER = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const OPTION_END = `[.．、:：)）]\\s*|(?=[${CIRCLED_NUMBER}])|(?=[ \\t]*$)`
const OPTION_LINE = new RegExp(`^\\s*([A-H])\\s*(?:${OPTION_END})`, 'im')
const OPTION_BLOCK = new RegExp(
  `^\\s*([A-H])\\s*(?:${OPTION_END})([\\s\\S]*?)(?=^\\s*[A-H]\\s*(?:${OPTION_END})|(?![\\s\\S]))`,
  'gim',
)

function normalize(value: string): string {
  return (
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&nbsp;/gi, ' ')
      // Text copied from a document often keeps every option on one line.
      .replace(new RegExp(`\\s+([A-H])\\s*(?:${OPTION_END})`, 'gm'), '\n$1. ')
  )
}

/** Recognizes the common A. / B. / C. / D. style while keeping rich text intact. */
export function parseMultipleChoice(
  question: string,
  correctAnswer = '',
): MultipleChoiceQuestion | null {
  const source = normalize(question)
  const firstOption = source.match(OPTION_LINE)
  if (!firstOption || firstOption.index === undefined) return null

  const options: MultipleChoiceOption[] = []
  const optionSource = source.slice(firstOption.index)
  OPTION_BLOCK.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = OPTION_BLOCK.exec(optionSource))) {
    const content = match[2].trim()
    if (content) options.push({ key: match[1].toUpperCase(), content })
  }
  if (options.length < 2) return null

  const answer = normalize(correctAnswer)
  const labelled = answer.match(/(?:正确答案|答案|answer)\s*[:：]?\s*([A-H])/i)
  const standalone = answer.match(/^\s*([A-H])(?:\s|[.．、:：)）]|$)/im)
  const correctOption = (labelled?.[1] || standalone?.[1] || '').toUpperCase()

  return {
    stem: source.slice(0, firstOption.index).trim(),
    options,
    correctOption: options.some((option) => option.key === correctOption) ? correctOption : null,
  }
}
