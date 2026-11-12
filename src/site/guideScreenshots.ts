export interface GuideScreenshot {
  src: string
  alt: string
  caption: string
  width?: number
  height?: number
  focus?: { x: number; y: number; width: number; height: number }
  marks?: {
    x: number
    y: number
    toX: number
    toY: number
    label: string
    box?: { width: number; height: number }
  }[]
}

const images = import.meta.glob<string>('./assets/guide/*.jpg', { eager: true, import: 'default' })
const shot = (name: string, alt: string, caption: string): GuideScreenshot => {
  const src = images[`./assets/guide/${name}.jpg`]
  if (!src) throw new Error(`Missing guide screenshot: ${name}`)
  return { src, alt, caption }
}
const detail = (
  name: string,
  caption: string,
  focus: NonNullable<GuideScreenshot['focus']>,
  marks: NonNullable<GuideScreenshot['marks']>,
  height = 957,
): GuideScreenshot => ({ ...shot(name, caption, caption), width: 1607, height, focus, marks })
const annotated = (
  name: string,
  caption: string,
  focus: NonNullable<GuideScreenshot['focus']>,
  marks: NonNullable<GuideScreenshot['marks']>,
): GuideScreenshot => ({ ...shot(name, caption, caption), width: 1440, height: 1000, focus, marks })

// Coordinates use the original screenshot's pixels; SVG crops and hollow outlines preserve the UI.
export const guideFigures: Record<string, GuideScreenshot> = {
  home: shot('home', '网页版首页', '在首页创建错题本，或进入已有错题本。'),
  editor: shot('editor', '题目与答案编辑区', '题目、错误答案和正确答案分别编辑。'),
  'question-groups': annotated(
    'question-groups',
    '左侧公共材料共用，右侧使用小题导航切换或添加题目。',
    { x: 284, y: 150, width: 1148, height: 530 },
    [
      { x: 860, y: 173, toX: 860, toY: 204, label: '上一小题：切换到同一题组的前一道题。' },
      { x: 959, y: 173, toX: 959, toY: 204, label: '下一小题：公共材料保留，切换当前小题。' },
      {
        x: 1104,
        y: 204,
        toX: 1029,
        toY: 204,
        box: { width: 98, height: 32 },
        label: '添加小题：在当前公共材料下增加题目。',
      },
    ],
  ),
  'group-create': annotated(
    'editor',
    '在普通题目的题目标题行，使用转为题组入口。',
    { x: 810, y: 165, width: 630, height: 180 },
    [
      {
        x: 1365,
        y: 248,
        toX: 1365,
        toY: 204,
        box: { width: 108, height: 32 },
        label: '转为题组位于题目区域右上角，转换后可编辑公共材料。',
      },
    ],
  ),
  importing: annotated(
    'importing',
    '统一分类后，核对识别题数，再确认导入。',
    { x: 448, y: 215, width: 545, height: 570 },
    [
      {
        x: 472,
        y: 570,
        toX: 720,
        toY: 570,
        box: { width: 464, height: 48 },
        label: '设置本次导入统一使用的学科和来源。',
      },
      {
        x: 472,
        y: 676,
        toX: 720,
        toY: 676,
        box: { width: 464, height: 36 },
        label: '核对识别题数和可点选的选择题数量。',
      },
      {
        x: 965,
        y: 725,
        toX: 909,
        toY: 725,
        box: { width: 88, height: 40 },
        label: '检查完成后，单击一键导入。',
      },
    ],
  ),
  reviewing: annotated(
    'reviewing',
    '题干位于上方；在下方填写本次答案及理由，再提交。',
    { x: 284, y: 750, width: 1148, height: 200 },
    [
      {
        x: 1410,
        y: 761,
        toX: 860,
        toY: 819,
        box: { width: 1130, height: 88 },
        label: '我的作答同时接收答案和关键理由。',
      },
      {
        x: 1294,
        y: 916,
        toX: 1370,
        toY: 916,
        box: { width: 112, height: 46 },
        label: '单击提交作答，开始核对答案与理由。',
      },
    ],
  ),
  'review-setup': annotated(
    'review-setup',
    '选择复习范围，核对本轮题数，再开始练习。',
    { x: 415, y: 245, width: 625, height: 510 },
    [
      {
        x: 1017,
        y: 385,
        toX: 720,
        toY: 385,
        box: { width: 534, height: 84 },
        label: '到期复习与自由练习使用不同的题目范围。',
      },
      {
        x: 716,
        y: 646,
        toX: 640,
        toY: 646,
        box: { width: 84, height: 32 },
        label: '本轮题数可限制练习量；右侧显示实际将复习的题数。',
      },
      {
        x: 1008,
        y: 699,
        toX: 941,
        toY: 699,
        box: { width: 88, height: 40 },
        label: '确认范围与题量后，开始练习。',
      },
    ],
  ),
  assistant: shot('assistant', '学习助手对话', '以虚拟语气问题演示学习对话。'),
  'assistant-scope': annotated(
    'assistant',
    '在输入区设置参考范围，通过侧栏管理资料。',
    { x: 284, y: 790, width: 1148, height: 210 },
    [
      {
        x: 572,
        y: 976,
        toX: 572,
        toY: 941,
        box: { width: 118, height: 30 },
        label: '选择知识库用于设置本次提问的参考范围。',
      },
      {
        x: 444,
        y: 967,
        toX: 352,
        toY: 967,
        box: { width: 128, height: 30 },
        label: '知识库管理用于导入资料、管理知识库和更新错题索引。',
      },
    ],
  ),
  knowledge: annotated(
    'knowledge',
    '先选择目标与来源，再执行入库；资料文件使用另一处入口。',
    { x: 325, y: 65, width: 790, height: 875 },
    [
      {
        x: 1065,
        y: 360,
        toX: 710,
        toY: 360,
        box: { width: 660, height: 40 },
        label: '先选目标知识库，再选来源错题本。',
      },
      {
        x: 494,
        y: 407,
        toX: 427,
        toY: 407,
        box: { width: 94, height: 42 },
        label: '执行入库才会更新检索索引。',
      },
      {
        x: 1065,
        y: 507,
        toX: 991,
        toY: 507,
        box: { width: 98, height: 42 },
        label: '导入文件用于导入 Markdown 或 PDF 学习资料。',
      },
    ],
  ),
  vocabulary: annotated(
    'vocabulary',
    '调整每日新学量，设置复习曲线，并展开今日单词预览。',
    { x: 0, y: 0, width: 1340, height: 585 },
    [
      {
        x: 827,
        y: 50,
        toX: 767,
        toY: 50,
        box: { width: 88, height: 40 },
        label: '每日新学用于设置每天的新词数量。',
      },
      {
        x: 904,
        y: 91,
        toX: 904,
        toY: 50,
        box: { width: 118, height: 42 },
        label: '复习曲线可调整答对间隔和答错后的重练时间。',
      },
      { x: 1314, y: 551, toX: 1283, toY: 551, label: '单击箭头展开预览今日单词，再选择词条查看。' },
    ],
  ),
  statistics: shot('statistics', '错题本学习统计', '统计面板显示当前错题本的题目与复习情况。'),
  backup: annotated(
    'backup',
    '打开更多菜单，区分导出归档、导入归档与 PDF 打印。',
    { x: 810, y: 0, width: 630, height: 365 },
    [
      { x: 1400, y: 62, toX: 1400, toY: 31, label: '更多菜单位于工作区工具栏右上角。' },
      {
        x: 1235,
        y: 120,
        toX: 1343,
        toY: 120,
        box: { width: 138, height: 36 },
        label: '导出归档用于备份和迁移。',
      },
      {
        x: 1235,
        y: 199,
        toX: 1343,
        toY: 199,
        box: { width: 138, height: 36 },
        label: '导入归档用于恢复受支持的归档文件。',
      },
    ],
  ),
  settings: annotated(
    'settings',
    '编辑偏好中的自动保存、正文大小和默认笔记本。',
    { x: 145, y: 205, width: 570, height: 315 },
    [
      {
        x: 615,
        y: 300,
        toX: 662,
        toY: 300,
        box: { width: 48, height: 28 },
        label: '自动保存开关决定是否在停止输入后保存。',
      },
      {
        x: 540,
        y: 368,
        toX: 625,
        toY: 368,
        box: { width: 120, height: 40 },
        label: '正文大小控制编辑区域的文字尺寸。',
      },
      {
        x: 455,
        y: 431,
        toX: 582,
        toY: 431,
        box: { width: 214, height: 40 },
        label: '默认笔记本可指定一本，也可恢复上次打开的笔记本。',
      },
    ],
  ),
  'folder-overview': detail(
    'folder-move',
    '文件夹入口、展开状态与未归档位置。',
    { x: 4, y: 506, width: 650, height: 350 },
    [
      { x: 124, y: 517, toX: 124, toY: 547, label: '列表数量旁的文件夹图标用于新建文件夹。' },
      { x: 55, y: 578, toX: 25, toY: 604, label: '单击文件夹左侧箭头，可展开或收起其中的题目。' },
      { x: 72, y: 831, toX: 40, toY: 806, label: '未设置文件夹的题目归入未归档。' },
    ],
  ),
  'folder-move': detail(
    'folder-move',
    '先选中原文件夹内的题目，再使用目标文件夹的移入按钮。',
    { x: 4, y: 506, width: 650, height: 350 },
    [
      { x: 77, y: 517, toX: 77, toY: 546, label: '确认已选题数，本例为 2 题。' },
      { x: 27, y: 628, toX: 52, toY: 652, label: '仅勾选待整理中的两道示例题。' },
      { x: 243, y: 793, toX: 243, toY: 764, label: '鼠标移到目标文件夹行，单击向下箭头移入。' },
    ],
  ),
  'folder-result': detail(
    'folder-result',
    '迁移完成后，原文件夹为 0 题，目标文件夹为 2 题。',
    { x: 4, y: 506, width: 650, height: 350 },
    [
      { x: 345, y: 604, toX: 315, toY: 604, label: '原文件夹题数变为 0。' },
      { x: 345, y: 644, toX: 315, toY: 644, label: '目标文件夹题数变为 2，题目显示在其下。' },
    ],
  ),
  'image-crop': detail(
    'image-crop',
    '拖动选框及四角，保留需要识别的题干与答案。',
    { x: 180, y: 135, width: 1240, height: 866 },
    [
      { x: 1345, y: 184, toX: 1307, toY: 206, label: '拖动四角调整裁剪范围，拖动框内移动选区。' },
      {
        x: 1008,
        y: 962,
        toX: 891,
        toY: 962,
        box: { width: 148, height: 42 },
        label: '单击下一步：转文字，确认选区并开始识别。',
      },
    ],
    1013,
  ),
  'image-text': detail(
    'image-text',
    '真实识别结果可直接修改，再选择文字或图文插入。',
    { x: 340, y: 225, width: 930, height: 565 },
    [
      {
        x: 1247,
        y: 345,
        toX: 1020,
        toY: 488,
        box: { width: 424, height: 270 },
        label: '在右侧校对并修改识别文字。',
      },
      { x: 350, y: 645, toX: 385, toY: 645, label: '勾选同时保留原图，可同时插入文字与图片。' },
      {
        x: 1248,
        y: 735,
        toX: 1185,
        toY: 735,
        box: { width: 98, height: 44 },
        label: '单击插入文字；只需原图时，选择旁边的仅插入图片。',
      },
    ],
    1013,
  ),
  tags: detail(
    'tags',
    '标签支持多选、移除、搜索与创建。',
    { x: 605, y: 62, width: 520, height: 285 },
    [
      {
        x: 870,
        y: 143,
        toX: 708,
        toY: 143,
        label: '已选标签显示在顶部，单击 × 可从当前题目移除。',
      },
      {
        x: 870,
        y: 195,
        toX: 736,
        toY: 195,
        box: { width: 202, height: 44 },
        label: '输入名称，可搜索已有标签。',
      },
      {
        x: 870,
        y: 249,
        toX: 736,
        toY: 249,
        box: { width: 202, height: 36 },
        label: '没有同名标签时，使用创建按钮。',
      },
    ],
  ),
  formatting: detail(
    'formatting',
    '荧光笔主按钮与颜色菜单分别控制标记和颜色。',
    { x: 980, y: 38, width: 620, height: 320 },
    [
      {
        x: 1245,
        y: 51,
        toX: 1245,
        toY: 89,
        box: { width: 62, height: 34 },
        label: '荧光笔主按钮使用最近选择的颜色。',
      },
      { x: 1290, y: 51, toX: 1290, toY: 89, label: '右侧箭头打开颜色菜单。' },
      {
        x: 1395,
        y: 305,
        toX: 1295,
        toY: 305,
        box: { width: 136, height: 30 },
        label: '选择无颜色，可清除所选文字的荧光。',
      },
    ],
  ),
  'question-link': detail(
    'question-link',
    '在关联窗口查找并选择当前错题本中的其他题目。',
    { x: 520, y: 190, width: 620, height: 580 },
    [
      {
        x: 1078,
        y: 299,
        toX: 804,
        toY: 299,
        box: { width: 472, height: 42 },
        label: '搜索题目名称、科目、来源或标签。',
      },
      {
        x: 1078,
        y: 422,
        toX: 804,
        toY: 422,
        box: { width: 472, height: 52 },
        label: '单击题目，将所选文字或光标位置关联到该题。',
      },
    ],
  ),
  layout: detail(
    'layout',
    '进入布局调整后，拖动板块手柄或分隔线。',
    { x: 345, y: 63, width: 1257, height: 752 },
    [
      {
        x: 1540,
        y: 123,
        toX: 1540,
        toY: 89,
        box: { width: 92, height: 38 },
        label: '完成布局用于锁定排列，旁边可恢复默认。',
      },
      { x: 375, y: 235, toX: 430, toY: 198, label: '拖动板块标题旁的手柄，可交换板块位置。' },
      {
        x: 1010,
        y: 594,
        toX: 973,
        toY: 594,
        label: '拖动分隔线，可重新分配题目和答案区域的空间。',
      },
    ],
    1013,
  ),
}
