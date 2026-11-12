# 点击交互与 Ant Design 样式对应清单

审查日期：2026-10-22。审查对象：当前工作区代码。已完成死代码清理，并将共享交互规范扩展到主工作台、错题本首页、AI 聊天、知识库、导入、复习统计、设置登录与插件模块；下方统计与附录按当前代码刷新。

## 结论

审查发现各处自行实现按钮、菜单、选项和确认框，相同动作的外观与反馈不够统一。现已建立共享命令菜单、模态确认、气泡确认、分段选择、按钮与字段样式，并在应用各模块接入。保留现有暖灰背景、橙色强调和深色主题；以下规范参考 [Ant Design 组件目录](https://ant.design/components/overview-cn/)和各组件文档。

项目使用 Vue；所给网站的示例属于 React 组件 API。本次以现有 Vue、Reka UI 和原生 dialog 实现对应的外观、行为和状态规范，没有引入 React 组件依赖。

## 审查口径

扫描 `src` 下全部 60 个 Vue 文件，其中 51 个文件包含本次采集的事件：

| 静态代码项 | 数量 | 如何理解 |
| --- | ---: | --- |
| `@click` 声明 | 341 | 应用 322，官网/使用文档 19；同一动作可能在多处出现 |
| 明确位于 `v-if="false"` 内的点击声明 | 0 | 旧侧栏图标栏的 5 处声明已删除 |
| 仅阻止冒泡等、没有处理表达式的点击声明 | 8 | 不是新的业务操作 |
| 有处理表达式且不在上述固定隐藏分支的点击声明 | 333 | 应用 314，官网 19；仍包含关闭遮罩、事件委托、循环模板 |
| `@dblclick` | 1 | 题目列表双击重命名 |
| `@pointerdown` / `@mousedown` | 12 / 18 | 包括拖动、尺寸调整、选区保留、遮罩关闭 |
| `@submit` | 10 | 9 个表单提交，1 个子组件提交事件监听 |
| `@select` | 19 | 包括共享菜单命令选择和子组件选中事件，不等于 19 个新增 DOM 点击 |
| 带 `href` 的链接声明 | 39 | 导航、下载、外部链接；部分与点击声明重叠 |
| 原生选择/文件控件及底层选择器触发点 | 24 | 包括无 `@click` 的 checkbox、radio、select、range、file 和库组件触发点；受控共享选择器另见附录 D |

这些数量不能相加成为“功能总数”。本报告是源码静态审查，条件分支未全部运行验证；循环条目和复用组件会在运行时生成多个控件。附录逐项保留代码行、事件及处理表达式。选择器实例、富文本事件委托和绘图另行补充。

## 一套通用样式规则

| 用户想做什么 | 对应组件 | 本项目建议外观与反馈 |
| --- | --- | --- |
| 完成本区域主要动作 | [Button](https://ant.design/components/button-cn/) | 橙色实心主按钮；同一操作区域仅一个，例如“开始练习”“确认导入”“保存修改” |
| 取消、返回、次要动作 | [Button](https://ant.design/components/button-cn/) | 默认描边或文本按钮，避免与确认按钮同等抢眼 |
| 添加次级条目 | [Button](https://ant.design/components/button-cn/) | 如“添加选项”“添加小题”，使用轻量按钮，列表末尾添加可用虚线样式 |
| 图标动作 | [Tooltip](https://ant.design/components/tooltip-cn/) + Button | 上/下一题、关闭、链接、撤销使用统一尺寸的图标按钮，提供名称、焦点态与禁用态 |
| 从一组命令中执行一个 | [Dropdown](https://ant.design/components/dropdown-cn/) | 更多、导入/导出、截屏/拍照/导图、重命名/删除：图标加文字菜单；危险项用红字并分组 |
| 选择字段值 | [Select](https://ant.design/components/select-cn/) | 板块、来源、字号、图片尺寸等：输入框式触发器，展示当前值、下拉箭头与选中项 |
| 选择多个值 | [Select](https://ant.design/components/select-cn/) / [Checkbox](https://ant.design/components/checkbox-cn/) | 标签编辑用多选 Select，已选值以可移除 Tag 展示；复习范围/批量勾选用 Checkbox |
| 少量互斥选项 | [Radio](https://ant.design/components/radio-cn/) / [Segmented](https://ant.design/components/segmented-cn/) | 所有选项可见并明确唯一选中项；分段外观适合模式与紧凑视图切换 |
| 立即启停一个设置 | [Switch](https://ant.design/components/switch-cn/) | 深色模式、自动保存：轨道加滑块；与等待提交的表单勾选区分 |
| 展开内容或切换页面片段 | [Collapse](https://ant.design/components/collapse-cn/) / [Tabs](https://ant.design/components/tabs-cn/) | 展开用箭头与标题；同层内容切换用标签页与活动指示，不混为普通主按钮 |
| 小范围操作确认 | [Popconfirm](https://ant.design/components/popconfirm-cn/) | 靠近触发处提示，例如删除文件夹、移除关联、移除索引；明确实际后果 |
| 事务、批量删除或离开前决策 | [Modal](https://ant.design/components/modal-cn/) | 统一标题、内容、底部动作；破坏性确认红色，取消低强调；表单失败保留输入 |
| 依附当前任务的侧面面板 | [Drawer](https://ant.design/components/drawer-cn/) | 适合窄屏侧栏或工作区内辅助详情；已有全页设置可保持全页结构 |
| 短暂操作结果 | [Message](https://ant.design/components/message-cn/) | 保存/复制等轻量结果；频繁自动保存优先使用页内状态，不反复弹出 |
| 需回看或带后续动作的结果 | [Notification](https://ant.design/components/notification-cn/) + [Progress](https://ant.design/components/progress-cn/) | 长任务完成/失败、查看结果、重试；可定位回任务，不能只闪过一句话 |

命令菜单与字段选择的区分，直接依据 [Dropdown 文档](https://ant.design/components/dropdown-cn/)；即时开关与待提交勾选的区别依据 [Switch 文档](https://ant.design/components/switch-cn/)。具体控件取舍与品牌配色属于本项目建议。

## 按模块覆盖所有功能

同一行中的取消、关闭和确认统一遵循上表；具体事件处理表达式见后面的逐文件附录。

| 模块 / 用户点击动作 | 对应 Ant Design 组件 | 建议呈现方式 |
| --- | --- | --- |
| 启动失败重新加载；工作区题目加载失败重试；空白页新建、打开首题、清空筛选 | [Button](https://ant.design/components/button-cn/) | 错误/空态说明下给出明确动作；只有优先动作使用主色，重试时 loading |
| 顶部返回首页、展开侧栏、进入/退出复习、绘图、统计、新建、保存 | [Button](https://ant.design/components/button-cn/) + [Tooltip](https://ant.design/components/tooltip-cn/) | 新建或开始复习按当前任务确定主次；辅助入口使用文本/图标；模式开启有选中态 |
| 顶部更多、JSON/PDF 导出、JSON/文本/PDF 导入、删除 | [Dropdown](https://ant.design/components/dropdown-cn/) | 导入、导出、危险操作分组；删除单独分隔，导入后进入对应流程 |
| 搜索题目、错题本、知识库条目、官网文档 | [Input](https://ant.design/components/input-cn/) | 搜索图标、清空、输入焦点明确；有提交动作时使用 Search 形式，结果数量/空结果就地说明 |
| 侧栏板块、来源、标签、掌握度筛选；选中筛选条件与清除 | [Radio](https://ant.design/components/radio-cn/) / [Tag](https://ant.design/components/tag-cn/) | 当前每个维度是单值；行式选中或受控单选标签，允许取消的维度保留取消逻辑；计数低强调 |
| 侧栏各筛选区收起/展开、来源区收起、筛选总开关 | [Collapse](https://ant.design/components/collapse-cn/) | 标题与箭头固定对齐，显示是否展开；内容隐藏不丢筛选状态 |
| 板块/来源/标签新增、快速新增、重命名、删除、是否全局 | [Dropdown](https://ant.design/components/dropdown-cn/) + [Input](https://ant.design/components/input-cn/) + [Checkbox](https://ant.design/components/checkbox-cn/) + [Popconfirm](https://ant.design/components/popconfirm-cn/) | 行尾省略号收命令；编辑使用行内输入；全局选项随创建提交；删除确认写清作用范围 |
| 全选/逐项选中、取消选择、批量打标签、批量导出、批量删除 | [Checkbox](https://ant.design/components/checkbox-cn/) + [Dropdown](https://ant.design/components/dropdown-cn/) + [Modal](https://ant.design/components/modal-cn/) | 全选支持半选态；仅选中后显示批量工具条和数量；危险确认列出影响数量 |
| 文件夹展开/选择、新建、重命名、删除、移动所选题目；题目排序 | [Tree](https://ant.design/components/tree-cn/) + [Dropdown](https://ant.design/components/dropdown-cn/) | 层级、展开和选中区分；移动可选目标；排序显示当前选项。删除文件夹使用气泡确认 |
| 点击题目打开、Ctrl/Shift 多选、双击标题重命名、拖动题目排序 | [Tree](https://ant.design/components/tree-cn/) / 可选列表 + [Checkbox](https://ant.design/components/checkbox-cn/) + [Typography](https://ant.design/components/typography-cn/) | 保留紧凑题目列表；活动项与批量勾选分开；行尾菜单也提供重命名入口，兼容触屏 |
| 错题本首页导航、打开错题本/复习、创建/编辑/删除错题本、统计重试、设置/设计示例 | [Tabs](https://ant.design/components/tabs-cn/) / 导航 + [Modal](https://ant.design/components/modal-cn/) + [Form](https://ant.design/components/form-cn/) | 导航显示当前位置；卡片只突出打开动作，管理动作收进菜单；删除错题本使用明确确认 |
| 题目板块/来源选择、标签多选及创建/移除、批量标签 | [Select](https://ant.design/components/select-cn/) + [Tag](https://ant.design/components/tag-cn/) | 板块/来源单选，标签多选；搜索与新建清楚分开；移除某题标签不等于删除全局标签 |
| 加粗、荧光开关、荧光选色、清除颜色、内部题目链接、图片尺寸 | [Button](https://ant.design/components/button-cn/) + [ColorPicker](https://ant.design/components/color-picker-cn/) / [Popover](https://ant.design/components/popover-cn/) + [Select](https://ant.design/components/select-cn/) | 格式按钮有按下/混合态；有限色卡可保留小浮层；图片尺寸仅选中图片时显示；执行格式后保留编辑选区 |
| 插入图片中的截屏/拍照/文件导入；更多中的调整布局/重置布局 | [Dropdown](https://ant.design/components/dropdown-cn/) + [Upload](https://ant.design/components/upload-cn/) | 两组命令菜单；图片入口含图标与文字；文件读取进入后续处理，当前富文本实现可保留原生文件选择器 |
| 答案显示/隐藏、复习记录展开、题组上一/下一小题、添加小题、转为题组 | [Button](https://ant.design/components/button-cn/) + [Collapse](https://ant.design/components/collapse-cn/) + [Modal](https://ant.design/components/modal-cn/) | 局部显示控制用轻量文字按钮；题组导航展示位置；转换操作确认说明结果 |
| 打开/选择/解除题目链接；点击富文本内部链接跳题 | [Modal](https://ant.design/components/modal-cn/) + [Input](https://ant.design/components/input-cn/) + 可选列表 + [Typography](https://ant.design/components/typography-cn/) | 搜索选择目标题；已链接状态显示目标和解除动作；正文链接与普通文字区分 |
| 保存、失败重试、关闭提示；离开未保存题目时取消/放弃/保存 | 页内状态 + [Button](https://ant.design/components/button-cn/) + [Message](https://ant.design/components/message-cn/) + [Modal](https://ant.design/components/modal-cn/) | 自动保存保持可见状态；失败旁有重试；离开确认保留三种明确选项，保存失败留在确认流程 |
| 单题/批量删除；导入遇到已有进度时保留/重置；文本导入模式 | [Modal](https://ant.design/components/modal-cn/) + [Radio](https://ant.design/components/radio-cn/) | 高影响选择清楚解释结果；模式和进度策略使用互斥选项；取消默认低强调 |
| PDF 选择文件、识别、跳至问题、全选/选择题目、题目/材料导航、前后题、修改题型/材料关联、增删选项、重新载入草稿、后台运行、确认校对与导入 | [Upload](https://ant.design/components/upload-cn/) + [Steps](https://ant.design/components/steps-cn/) + [Checkbox](https://ant.design/components/checkbox-cn/) + [Select](https://ant.design/components/select-cn/) + [Form](https://ant.design/components/form-cn/) | 大型导入事务用宽 Modal 或独立页；步骤区分识别/校对/完成；校对目录固定，问题可定位；最终仅一个主提交按钮 |
| 截屏选择窗口；摄像头拍照/取消；裁剪返回/跳过/确认；OCR 旋转/重试/图片或文字导入/保留原图 | [Modal](https://ant.design/components/modal-cn/) + [Checkbox](https://ant.design/components/checkbox-cn/) + [Button](https://ant.design/components/button-cn/) | 统一图片处理容器、预览和底栏；旋转图标按钮；OCR 失败原位重试；裁剪与设备采集保留专用实现 |
| 绘图启停、画笔/橡皮、颜色、粗细、撤销/重做、清空；画布落笔 | [Segmented](https://ant.design/components/segmented-cn/) + [ColorPicker](https://ant.design/components/color-picker-cn/) + [Slider](https://ant.design/components/slider-cn/) + [Button](https://ant.design/components/button-cn/) | 工具栏建立清楚选中态，撤销/重做按历史禁用；清空区别于删除题目；绘图 Canvas 保留 |
| 调整侧栏宽度/上下区尺寸、编辑区分栏尺寸、拖动板块换位 | [Splitter](https://ant.design/components/splitter-cn/) + 自定义拖动 | 分隔条 hover/focus 可见且易命中；板块换位使用拖动把手；Splitter 只对应尺寸调整，不包办换位 |
| 复习范围到期/全部、板块/标签勾选、随机顺序、题数、开始/取消 | [Radio](https://ant.design/components/radio-cn/) / [Segmented](https://ant.design/components/segmented-cn/) + [Checkbox](https://ant.design/components/checkbox-cn/) + [Form](https://ant.design/components/form-cn/) | 范围为单选，板块/标签为多选；预计题数实时可见；无候选题时解释并禁用开始 |
| 复习答案选项、填写理由、提交、判分重试、下一题/结束、退出；结果中打开题目/返回编辑 | [Radio](https://ant.design/components/radio-cn/) + [Input](https://ant.design/components/input-cn/) + [Button](https://ant.design/components/button-cn/) | 单选题使用整行 Radio；回答前后状态清楚，提交时 loading；主要动作随阶段变化。掌握度若单独出现，用语义清楚的等级按钮，不套星级评分 |
| 统计到期/全部切换、打开复习场次、关闭历史详情 | [Segmented](https://ant.design/components/segmented-cn/) + [Modal](https://ant.design/components/modal-cn/) | 时间/数据范围选中态明确；场次行为可点击行；详情统一关闭及焦点返回 |
| 当前题 AI 展开、讲知识点/安排练习、发送、停止、重试、确认练习、查看历史、清空/继续对话 | [Collapse](https://ant.design/components/collapse-cn/) + [Input](https://ant.design/components/input-cn/) + [Button](https://ant.design/components/button-cn/) + [Modal](https://ant.design/components/modal-cn/) | 输入与发送构成一组；生成中发送切为停止；失败贴近出错轮次；清空历史需确认；练习确认使用独立主动作 |
| AI 首页新聊天、选聊天、更多/重命名/删除、滑动历史项、建议提示、跳题、选择/移除知识库、执行 AI 提供的选项 | [Dropdown](https://ant.design/components/dropdown-cn/) + [Modal](https://ant.design/components/modal-cn/) + [Tag](https://ant.design/components/tag-cn/) + [Button](https://ant.design/components/button-cn/) | 历史菜单统一；滑动保留但菜单也能执行相同命令；知识库引用用可移除标签；纯导航使用链接 |
| 知识库插入/管理切换、创建/编辑、文件导入/取消/后台、选择资料、显示归档、展开条目、归档/恢复/删除、清理重试 | [Tabs](https://ant.design/components/tabs-cn/) + [Form](https://ant.design/components/form-cn/) + [Upload](https://ant.design/components/upload-cn/) + [Checkbox](https://ant.design/components/checkbox-cn/) + [Modal](https://ant.design/components/modal-cn/) | 选择与管理两种任务分开；有引用的删除解释影响；导入进度在对话框与后台任务中可继续查看 |
| 知识库条目刷新、搜索、详情、移除确认、前后页；错题本入库选择目标、建立/移除索引 | [Input](https://ant.design/components/input-cn/) + [Pagination](https://ant.design/components/pagination-cn/) + [Select](https://ant.design/components/select-cn/) + [Popconfirm](https://ant.design/components/popconfirm-cn/) | 搜索/页码不混进主按钮组；入库前选择两个目标，执行时 loading；移除索引与删除资料文案区分 |
| 后台任务展开/收起/关闭、移除通知、查看结果或进度 | [Popover](https://ant.design/components/popover-cn/) + [Progress](https://ant.design/components/progress-cn/) + [Notification](https://ant.design/components/notification-cn/) | 任务入口显示数量或进度；关闭面板、移除已完成项与取消任务保持不同含义 |
| 深色模式、自动保存、字号/默认错题本、复习/快捷键展开、保存设置、改数据目录、修改密码、退出登录 | [Switch](https://ant.design/components/switch-cn/) + [Select](https://ant.design/components/select-cn/) + [Collapse](https://ant.design/components/collapse-cn/) + [Form](https://ant.design/components/form-cn/) | 即时偏好直接生效，复习参数草稿明确保存；全页设置可沿用当前布局；修改密码失败留表单，退出登录与删除数据区别显示 |
| 登录/注册/找回切换、发验证码、登录/注册/重置密码表单提交 | [Tabs](https://ant.design/components/tabs-cn/) + [Form](https://ant.design/components/form-cn/) + [Input](https://ant.design/components/input-cn/) + [Button](https://ant.design/components/button-cn/) | 密码可显隐，验证码倒计时禁用重发；错误关联字段或表单；主要提交 loading 防止重复 |
| 插件管理打开/关闭、安装、卸载、保留/删除数据选择 | [Button](https://ant.design/components/button-cn/) + [Radio](https://ant.design/components/radio-cn/) + [Modal](https://ant.design/components/modal-cn/) | 安装/卸载属于异步命令，按钮显示过程；卸载确认明确两种数据策略，不能简单做成即时开关 |
| 单词插件返回、打开 Anki、导入 APKG/粘贴表格/字段映射、创建/打开/删除词库、新增/编辑/删除词、筛标签、分页 | [Upload](https://ant.design/components/upload-cn/) + [Form](https://ant.design/components/form-cn/) + [Select](https://ant.design/components/select-cn/) + [Tag](https://ant.design/components/tag-cn/) + [Pagination](https://ant.design/components/pagination-cn/) + [Modal](https://ant.design/components/modal-cn/) | 导入分阶段处理；表格粘贴保留大文本输入；行操作文字/图标菜单，删除词库为高影响确认 |
| 单词插件三种学习模式、今日预览、单词预览、前后单词、发音、显示翻译、检查答案、下一题、复习曲线及保存设置、每日上限 | [Segmented](https://ant.design/components/segmented-cn/) + [Collapse](https://ant.design/components/collapse-cn/) + [Button](https://ant.design/components/button-cn/) + [Form](https://ant.design/components/form-cn/) | 模式为单选；发音图标可重复点击；学习阶段只突出当前下一步；曲线参数在同一表单保存 |
| 官网/指南快速开始、场景入口、章节切换、目录展开、搜索结果、清空搜索、上一/下一章、图片放大/关闭、下载与外部链接 | 导航 + [Input](https://ant.design/components/input-cn/) + [Image](https://ant.design/components/image-cn/) + [Typography](https://ant.design/components/typography-cn/) | 文档导航具有活动位置；图片支持统一预览关闭；外部链接和下载维持链接语义 |

## 已完成的死代码清理

- 删除被 `v-if="false"` 固定隐藏的旧侧栏图标栏及其 5 处点击声明，移除专属 CSS 和未使用的 `.content-hidden` 样式。
- 移除侧栏无效的 `mode`、`folderMap` 参数，以及仅服务旧图标栏的 `dueCount`、`startReview`、`return-to-menu` 参数或事件接线；其他在用组件的同名功能保留。
- 删除没有引用或挂载入口的 `ImageFilterModal.vue` 及其 7 处点击声明，并删除专用的 `applyDocumentFilter`、`DocumentFilterOptions`；保留 OCR 使用的 `rotateImage`。
- 清理 `App` → `Workspace` → `AppSidebar` 不再使用的 `folderMap` 传递与测试夹具参数；`useFilter` 的公开返回接口保留兼容性。
- 删除归档导入确认框内未接入导入逻辑的“自动盲切/整套按序导入”和题号范围输入；保留实际生效的保留/重置复习进度选择。
- 清理后已通过类型检查、修改文件的 ESLint、生产构建和工作区回归测试。

## 已完成的模块改造

- `ActionMenu.vue`：顶部“更多”、板块/标签/来源行操作、批量管理、错题本管理和聊天历史共用命令菜单；图标、文字、分隔、快捷键、危险色、禁用状态一致，支持键盘导航与焦点返回。行内菜单不会误触打开整行。
- `UiModal.vue`：共享原生模态确认框，管理安全初始焦点、Tab 循环、Escape、遮罩关闭和焦点返回；支持处理中禁止退出以及错误提示。已接入单题删除、批量删除、未保存退出、题组转换和批量标签。
- `ConfirmPopover.vue`：文件夹删除改为就地确认，明确说明题目将移至未归档，不再靠重复点击同一按钮确认。
- 选择器：保留单选字段与多选标签区别；标签支持方向键、Enter 选择/创建、已选标签移除、中文输入法；弹层可挂到原生确认框内。
- 侧栏：全选支持未选/半选/全选；排序改为字段选择与单独方向按钮，乱序提供再次打乱入口。220px 侧栏下工具区可换行。
- 编辑工具：图片插入及布局菜单补齐菜单语义、上下方向键、Home/End 与焦点返回，仍保留富文本选区和常驻图片工具传送目标。
- `SegmentedControl.vue`：登录/注册、知识库插入/管理、统计范围统一为受控分段选择；复习范围和答案采用 Radio.Group，板块/标签多选明确标注勾选状态，设置即时偏好采用 Switch。
- 专用弹窗：通过 `vDialogSurface` 共用可访问名称、初始焦点、Tab 循环、Escape 与焦点返回；PDF/OCR、裁剪、相机、截屏、知识库、历史详情、单词插件保留各自所需的尺寸、预览与滚动布局。裁剪画布保留深色底。
- 异步操作：错题本创建/编辑/删除与插件安装/卸载补齐等待态、重复提交拦截、错误提示和输入保留。错题本保存成功后才更新列表；插件等待期间不能误关确认，卸载失败保留数据策略，切换错题本后忽略旧请求对当前视图的更新。
- PDF 与后台任务：题型和公共材料使用统一 Select，弹层挂在当前模态内；保持校对后确认录入。后台任务保留原有进度与查看结果入口，关闭通知不会停止运行中的任务；移除通知只适用于已结束任务。
- 其他模块：登录和账号表单、设置、当前题 AI、知识库条目及错题本入库、复习和统计、插件管理、单词表单统一主次按钮、危险动作、输入框、选择态、禁用态和焦点样式。
- 配色：复用 `--neo-surface`、`--neo-reading`、`--neo-ink`、`--neo-line`、`--neo-accent`、`--neo-selected`；新增危险色也使用暖色，未引入默认蓝色主题。样式集中在 `src/interaction-ui.css`。
- 验证：新增共享交互和跨模块隔离浏览器测试，覆盖登录切换与错误清除、错题本保存失败、聊天菜单焦点、知识库选择保留、模态内 PDF 选择、复习键盘选项、插件等待/重试/数据策略、词库创建和新增单词、设置开关、统计详情和任务通知。公式与图片工具、文字格式、工作区反馈、桌面/窄屏复习导航回归，以及类型检查、ESLint、生产构建通过；浅色/深色截图已检查。

## 本次边界与验证方式

本次完成应用模块的交互统一，不重写富文本、绘图、裁剪、设备采集或后台识别算法。官网/使用文档的交互保留在清单中供查阅，本次未重做官网布局。隔离测试使用独立浏览器存储与模拟请求，不访问当前登录用户的错题；验证的是界面行为，没有代替真实摄像头、OCR、邮箱和 AI 服务的联调。

## 几处需要明确修正的设计

- 文件夹的重复点击确认已替换为 [ConfirmPopover](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ConfirmPopover.vue)，并写明“题目将移至未归档”；[当前业务实现](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:769)不会删除其中题目。
- 侧栏标签筛选与来源/板块/掌握度各存一个当前值，[状态位置](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/composables/useFilter.ts:46)。不能根据“标签”二字就统一做成多选；题目编辑区 TagMultiSelect 才是多选。
- “更多编辑选项”“插入图片”是命令集合；“原始/25%/50%”是字段值选择；颜色小面板包含色卡操作。分别按 Dropdown、Select、Popover/ColorPicker 处理。
- KaTeX 公式点击编辑、富文本选区、内部链接、图片选择、画布、裁剪、摄像头与截屏属于专用交互。Ant Design 适合统一外围工具栏/容器/反馈，不能直接替代这些编辑能力。
- 当前已经有保存状态、重试、选中态和部分键盘行为；本报告建议统一这些能力，不能把所有项目都当成尚未实现。

## 附录阅读方式

下面完整列出采集到的模板事件、链接、原生/底层控件及共享选择器实例。表中“组件事件”表示父子组件通信；“保留选区/拖动”等辅助事件不作为新的业务按钮。长容器文本只作定位摘要，处理表达式保留完整内容。对应样式应结合上面的模块表判断，尤其是“打开某对话框”的按钮与对话框本体属于不同层次。


## A. 全部模板事件声明


### src/App.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/App.vue:1009](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1009) | @click | 重新加载 | startApp | 按钮/菜单项/选项；按模块表区分 |
| [src/App.vue:1111](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1111) | @select | Workspace | handleSelectEntry | 组件选中事件传递 |
| [src/App.vue:1211](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1211) | @click.self | 开始复习 按本轮目标选择范围；答对会记录掌握度，但不会删除原题。 到期复习 仅练习当前到期题目 自由练习 从全部题目中抽题 板块（可多选） {{subject}} 标签（可多选，命中任一标签即可） # {{tag}} 随机顺序 本轮题数 将复习 {{reviewCandidateCount}} 题 取消 开始练习 | showReviewSetup = false | 遮罩关闭 |
| [src/App.vue:1277](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1277) | @click | {{subject}} | toggleReviewSubject(subject) | 按钮/菜单项/选项；按模块表区分 |
| [src/App.vue:1301](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1301) | @click | # {{tag}} | toggleReviewTag(tag) | 按钮/菜单项/选项；按模块表区分 |
| [src/App.vue:1336](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1336) | @click | 取消 | showReviewSetup = false | 按钮/菜单项/选项；按模块表区分 |
| [src/App.vue:1345](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1345) | @click | 开始练习 | beginConfiguredReview | 按钮/菜单项/选项；按模块表区分 |
| [src/App.vue:1358](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1358) | @click.self | 批量导入错题 粘贴带序号的题目；“答案：B”会自动识别为可点选的选择题。 1. 题干 A. 选项一 B. 选项二 答案：B 已识别 {{batchImportPreview.length}} 题，其中 {{batchImportChoiceCount}} 题为可点选的选择题。 取消 {{batchImportLoadi | showBatchImport = false | 遮罩关闭 |
| [src/App.vue:1407](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1407) | @click | 取消 | showBatchImport = false | 按钮/菜单项/选项；按模块表区分 |
| [src/App.vue:1417](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1417) | @click | {{batchImportLoading ? '导入中...' : '一键导入'}} | handleConfirmBatchImport | 按钮/菜单项/选项；按模块表区分 |
| [src/App.vue:1444](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1444) | @submit | PdfImportDialog | handleSubmitPdfImport | 组件提交事件传递 |

### src/components/AccountPasswordForm.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/AccountPasswordForm.vue:45](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AccountPasswordForm.vue:45) | @click | {{expanded ? '收起修改密码' : '修改密码'}} | expanded = !expanded | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AccountPasswordForm.vue:49](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AccountPasswordForm.vue:49) | @submit.prevent | 当前密码 新密码 确认新密码 修改成功后，所有设备都需要重新登录。 {{error}} {{loading ? '修改中…' : '确认修改并重新登录'}} | submit | Form 提交入口 |

### src/components/ActionMenu.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/ActionMenu.vue:54](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ActionMenu.vue:54) | @click.stop | {{action.label}} {{action.shortcut}} | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/ActionMenu.vue:90](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ActionMenu.vue:90) | @select | {{action.label}} {{action.shortcut}} | selectAction(action.id) | 组件选中事件传递 |

### src/components/AgentChatActionDialog.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/AgentChatActionDialog.vue:41](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AgentChatActionDialog.vue:41) | @pointerdown | {{mode === 'rename' ? '重命名聊天' : '删除聊天'}} 聊天名称 最多 80 个字 确定删除“ {{title}} ”及其全部聊天记录吗？删除后无法恢复。 {{error}} 取消 {{busy ? mode === 'rename' ? '正在保存…' : '正在删除…' : mode == | onBackdropPointerDown | Modal 遮罩关闭 |
| [src/components/AgentChatActionDialog.vue:43](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AgentChatActionDialog.vue:43) | @click | {{mode === 'rename' ? '重命名聊天' : '删除聊天'}} 聊天名称 最多 80 个字 确定删除“ {{title}} ”及其全部聊天记录吗？删除后无法恢复。 {{error}} 取消 {{busy ? mode === 'rename' ? '正在保存…' : '正在删除…' : mode == | onBackdropClick | 行/区域交互或点击委托；参见模块表 |
| [src/components/AgentChatActionDialog.vue:45](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AgentChatActionDialog.vue:45) | @submit.prevent | {{mode === 'rename' ? '重命名聊天' : '删除聊天'}} 聊天名称 最多 80 个字 确定删除“ {{title}} ”及其全部聊天记录吗？删除后无法恢复。 {{error}} 取消 {{busy ? mode === 'rename' ? '正在保存…' : '正在删除…' : mode == | emit('confirm', name.trim()) | Form 提交入口 |
| [src/components/AgentChatActionDialog.vue:78](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AgentChatActionDialog.vue:78) | @click | 取消 | close | 按钮/菜单项/选项；按模块表区分 |

### src/components/AgentChatHistoryItem.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/AgentChatHistoryItem.vue:131](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AgentChatHistoryItem.vue:131) | @click | &#96;删除聊天：${title}&#96; | emit('delete') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AgentChatHistoryItem.vue:141](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AgentChatHistoryItem.vue:141) | @click | &#96;重命名聊天：${title}&#96; | emit('rename') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AgentChatHistoryItem.vue:150](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AgentChatHistoryItem.vue:150) | @pointerdown | {{title}} {{detail}} | startDrag | 自定义拖动/换位 |
| [src/components/AgentChatHistoryItem.vue:164](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AgentChatHistoryItem.vue:164) | @click | title | select | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AgentChatHistoryItem.vue:173](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AgentChatHistoryItem.vue:173) | @select | &#96;聊天操作：${title}&#96; | menuAction | 组件选中事件传递 |

### src/components/AnswerPanel.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/AnswerPanel.vue:312](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AnswerPanel.vue:312) | @mousedown | {{label}} {{showHidden ? '显示' : '隐藏'}} ⠿ 拖动 {{label}} 已隐藏 | emit('activate-formatting', type) | 富文本选区/激活保护 |
| [src/components/AnswerPanel.vue:328](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AnswerPanel.vue:328) | @click.stop | showHidden ? &#96;显示${label}&#96; : &#96;隐藏${label}&#96; | emit('reveal') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AnswerPanel.vue:351](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AnswerPanel.vue:351) | @pointerdown.stop | &#96;拖动${label}板块换位&#96; | emit('layout-drag-start', $event) | 专用指针交互；参见模块表 |
| [src/components/AnswerPanel.vue:352](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AnswerPanel.vue:352) | @click.stop | &#96;拖动${label}板块换位&#96; | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/AnswerPanel.vue:391](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AnswerPanel.vue:391) | @click | div | handleEditorClick | 富文本点击委托 |

### src/components/AppSidebar.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/AppSidebar.vue:381](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:381) | @click | 返回 AI 助手 | emit('return-to-agent') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:405](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:405) | @click | filterPanelOpen ? '收起筛选面板' : '展开筛选面板' | filterPanelOpen = !filterPanelOpen | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:472](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:472) | @click | 来源 | sourceSectionOpen = !sourceSectionOpen | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:492](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:492) | @click | 新建来源 | startAddSource() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:530](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:530) | @click | 确定 | confirmAddSource() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:536](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:536) | @click | 取消 | cancelAddSource() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:558](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:558) | @select | 全部 | emit('filterSource', '__all__') | 组件选中事件传递 |
| [src/components/AppSidebar.vue:579](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:579) | @click | button | confirmEditSource() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:600](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:600) | @click | button | cancelEditSource() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:626](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:626) | @click | button | confirmDeleteSource() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:641](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:641) | @click | button | cancelDeleteSource() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:663](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:663) | @select | source | emit('filterSource', activeSource === source ? null : source) | 组件选中事件传递 |
| [src/components/AppSidebar.vue:679](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:679) | @click | 掌握程度 | masteryOpen = !masteryOpen | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:725](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:725) | @click | {{b.label}} ( {{masteryMap[b.label] \|\| 0}} ) | emit('filterMastery', b.label) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:755](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:755) | @pointerdown.prevent | 拖动调整上下区域大小 | startResize | Splitter 尺寸调整 |
| [src/components/AppSidebar.vue:774](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:774) | @click | {{activeFilterCount}} 项筛选生效中 | filterPanelOpen = true | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:797](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:797) | @click | 全选题目 | handleSelectAll | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:819](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:819) | @select | 批量管理 | handleBatchAction | 组件选中事件传递 |
| [src/components/AppSidebar.vue:841](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:841) | @click | 新建文件夹 | startAddFolder | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:886](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:886) | @click | sortKey === 'shuffle' ? '重新打乱顺序' : sortDir === 'asc' ? '改为降序' : '改为升序' | emit('setSort', sortKey) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:906](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:906) | @click | 创建 | confirmAddFolder | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:913](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:913) | @click | 取消 | cancelAddFolder | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:928](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:928) | @select | FolderEntryTree | emit('select', $event) | 组件选中事件传递 |
| [src/components/AppSidebar.vue:946](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:946) | @click | {{plugin.name}} | emit('open-plugin', plugin.id) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:963](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:963) | @click | 添加功能 | emit('manage-plugins') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:984](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:984) | @click | 设置 | emit('toggle-settings') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:1017](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:1017) | @click | 取消 | cancelBatchTags | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:1025](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:1025) | @click | 添加标签 | confirmBatchTags | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppSidebar.vue:1043](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:1043) | @pointerdown | 调整侧边栏宽度 | startSidebarResize | Splitter 尺寸调整 |

### src/components/AppToast.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/AppToast.vue:19](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppToast.vue:19) | @click | 关闭提示 | $emit('dismiss') | 按钮/菜单项/选项；按模块表区分 |

### src/components/AppToolbar.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/AppToolbar.vue:98](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppToolbar.vue:98) | @click | 返回首页 | emit('return-to-menu') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppToolbar.vue:122](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppToolbar.vue:122) | @click | sidebarCollapsed ? '展开侧栏' : '收起侧栏' | emit('toggle-sidebar') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppToolbar.vue:152](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppToolbar.vue:152) | @click | mode === 'review' ? '退出复习' : '进入复习' | emit('toggleMode') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppToolbar.vue:199](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppToolbar.vue:199) | @click | 切换画笔模式 | emit('toggleDrawing') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppToolbar.vue:216](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppToolbar.vue:216) | @click | 统计面板 | emit('toggleStats') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppToolbar.vue:246](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppToolbar.vue:246) | @click | div | searchInput?.focus() | 行/区域交互或点击委托；参见模块表 |
| [src/components/AppToolbar.vue:279](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppToolbar.vue:279) | @click | 新建错题 | emit('new') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AppToolbar.vue:300](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppToolbar.vue:300) | @select | 更多 | moreAction | 组件选中事件传递 |

### src/components/AuthScreen.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/AuthScreen.vue:120](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AuthScreen.vue:120) | @submit.prevent | {{title}} 昵称 （可选） 邮箱 邮箱验证码 {{sendingCode ? '发送中…' : cooldown &gt; 0 ? &#96;${cooldown} 秒后重发&#96; : '发送验证码'}} {{mode === 'reset' ? '新密码' : '密码'}} 确认密码 {{error}} {{notice}} | submit | Form 提交入口 |
| [src/components/AuthScreen.vue:171](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AuthScreen.vue:171) | @click | {{sendingCode ? '发送中…' : cooldown &gt; 0 ? &#96;${cooldown} 秒后重发&#96; : '发送验证码'}} | requestCode | 按钮/菜单项/选项；按模块表区分 |
| [src/components/AuthScreen.vue:224](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AuthScreen.vue:224) | @click | {{mode === 'login' ? '忘记密码？' : '返回登录'}} | switchMode(mode === 'login' ? 'reset' : 'login') | 按钮/菜单项/选项；按模块表区分 |

### src/components/BackgroundTaskCenter.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/BackgroundTaskCenter.vue:61](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/BackgroundTaskCenter.vue:61) | @click | {{collapsed ? '展开' : '收起'}} | collapsed = !collapsed | 按钮/菜单项/选项；按模块表区分 |
| [src/components/BackgroundTaskCenter.vue:71](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/BackgroundTaskCenter.vue:71) | @click | 关闭任务通知面板 | closeNotifications | 按钮/菜单项/选项；按模块表区分 |
| [src/components/BackgroundTaskCenter.vue:118](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/BackgroundTaskCenter.vue:118) | @click | 关闭任务通知 | feature.dismiss(task.id) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/BackgroundTaskCenter.vue:133](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/BackgroundTaskCenter.vue:133) | @click | {{task.actionLabel \|\| (task.state === 'running' ? '查看进度 ↗' : '查看结果 ↗')}} | feature.open(task) | 按钮/菜单项/选项；按模块表区分 |

### src/components/CameraCapture.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/CameraCapture.vue:64](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/CameraCapture.vue:64) | @click.self | 启动摄像头中… {{error}} 取消 | stop | 遮罩关闭 |
| [src/components/CameraCapture.vue:92](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/CameraCapture.vue:92) | @click | 取消 | stop | 按钮/菜单项/选项；按模块表区分 |
| [src/components/CameraCapture.vue:102](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/CameraCapture.vue:102) | @click | 拍照 | capture | 按钮/菜单项/选项；按模块表区分 |

### src/components/ConfirmPopover.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/ConfirmPopover.vue:49](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ConfirmPopover.vue:49) | @click | 取消 | open = false | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ConfirmPopover.vue:52](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ConfirmPopover.vue:52) | @click | {{confirmText \|\| '确认删除'}} | confirm | 按钮/菜单项/选项；按模块表区分 |

### src/components/DeleteModal.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/DeleteModal.vue:30](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/DeleteModal.vue:30) | @click | 取消 | emit('cancel') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/DeleteModal.vue:39](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/DeleteModal.vue:39) | @click | {{busy ? '正在删除…' : batch ? &#96;删除 ${count} 条&#96; : '确认删除'}} | emit('confirm') | 按钮/菜单项/选项；按模块表区分 |

### src/components/EditorImageActions.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/EditorImageActions.vue:13](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EditorImageActions.vue:13) | @click | 截屏 | $emit('screenshot') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EditorImageActions.vue:35](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EditorImageActions.vue:35) | @click | 拍照 | $emit('camera') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EditorImageActions.vue:57](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EditorImageActions.vue:57) | @click | 导入图片 | $emit('import') | 按钮/菜单项/选项；按模块表区分 |

### src/components/EditorToolMenu.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/EditorToolMenu.vue:82](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EditorToolMenu.vue:82) | @mousedown.prevent | label | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/EditorToolMenu.vue:83](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EditorToolMenu.vue:83) | @click | label | toggle | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EditorToolMenu.vue:116](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EditorToolMenu.vue:116) | @mousedown.prevent | label | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/EditorToolMenu.vue:117](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EditorToolMenu.vue:117) | @click | label | selectItem | 行/区域交互或点击委托；参见模块表 |

### src/components/EntryLearningHistoryDialog.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/EntryLearningHistoryDialog.vue:40](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryLearningHistoryDialog.vue:40) | @pointerdown | 当前题目对话历史 {{title \|\| '当前题目'}} · {{turns.length}} 轮对话 关闭 还没有学习对话。 清空当前题目对话 继续对话 | onBackdropPointerDown | Modal 遮罩关闭 |
| [src/components/EntryLearningHistoryDialog.vue:42](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryLearningHistoryDialog.vue:42) | @click | 当前题目对话历史 {{title \|\| '当前题目'}} · {{turns.length}} 轮对话 关闭 还没有学习对话。 清空当前题目对话 继续对话 | onBackdropClick | 行/区域交互或点击委托；参见模块表 |
| [src/components/EntryLearningHistoryDialog.vue:61](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryLearningHistoryDialog.vue:61) | @click | 关闭对话历史 | emit('close') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryLearningHistoryDialog.vue:93](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryLearningHistoryDialog.vue:93) | @click | 清空当前题目对话 | emit('clear') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryLearningHistoryDialog.vue:101](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryLearningHistoryDialog.vue:101) | @click | 继续对话 | emit('continue') | 按钮/菜单项/选项；按模块表区分 |

### src/components/EntryLearningTurn.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/EntryLearningTurn.vue:28](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryLearningTurn.vue:28) | @click | 停止生成 | emit('stop') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryLearningTurn.vue:62](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryLearningTurn.vue:62) | @click | 重试回复 | emit('retry', turn.id) | 按钮/菜单项/选项；按模块表区分 |

### src/components/EntryList.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/EntryList.vue:266](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryList.vue:266) | @click | selectedIds.has(entry.id) ? undefined : 'Ctrl+点击选择 · Shift+点击范围选择' | onItemClick($event, entry.id, idx) | 行/区域交互或点击委托；参见模块表 |
| [src/components/EntryList.vue:285](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryList.vue:285) | @click.stop | &#96;选择错题：${entry.title \|\| preview(entry.questionPreview \|\| entry.question, 28) \|\| '无题目'}&#96; | onCheckClick($event, entry.id, idx) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryList.vue:328](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryList.vue:328) | @dblclick.stop | {{entry.title \|\| preview(entry.questionPreview \|\| entry.question, 28) \|\| '无题目'}} | startRename(entry.id) | Typography 行内重命名；补充菜单入口 |

### src/components/EntryReviewInsightCard.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/EntryReviewInsightCard.vue:180](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryReviewInsightCard.vue:180) | @click | 复习 {{counts.reviewCount}} 次 · 答错 {{counts.wrongCount}} 次 {{status}} | expanded = !expanded | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryReviewInsightCard.vue:252](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryReviewInsightCard.vue:252) | @click | 让助手安排复习 | askWithScroll('arrange_review') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryReviewInsightCard.vue:273](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryReviewInsightCard.vue:273) | @click | 学习此题知识点 | askWithScroll('learn_knowledge') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryReviewInsightCard.vue:300](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryReviewInsightCard.vue:300) | @click | 重试加载 | refresh | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryReviewInsightCard.vue:319](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryReviewInsightCard.vue:319) | @click | 停止生成 | stop | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryReviewInsightCard.vue:397](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryReviewInsightCard.vue:397) | @click | {{confirming \|\| starting ? '正在进入复习…' : '确认并进入复习'}} | confirmAndStart | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryReviewInsightCard.vue:416](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryReviewInsightCard.vue:416) | @click | 重试回复 | ask('arrange_review') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryReviewInsightCard.vue:442](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryReviewInsightCard.vue:442) | @submit.prevent | AI 学习助手 · 当前题目 对话历史（ {{turns.length}} ） 清空对话 题目已修改，后续回复依据保存后的内容；之前的对话仍保留。 {{storageError}} 发送 Enter 发送 · Shift + Enter 换行 · 学习对话不计入复习次数 | send | Form 提交入口 |
| [src/components/EntryReviewInsightCard.vue:456](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryReviewInsightCard.vue:456) | @click | 对话历史（ {{turns.length}} ） | historyOpen = true | 按钮/菜单项/选项；按模块表区分 |
| [src/components/EntryReviewInsightCard.vue:467](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntryReviewInsightCard.vue:467) | @click | 清空对话 | clearCurrentChat | 按钮/菜单项/选项；按模块表区分 |

### src/components/EntrySaveStatus.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/EntrySaveStatus.vue:25](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/EntrySaveStatus.vue:25) | @click | {{error ? '重试保存' : '保存'}} | $emit('save') | 按钮/菜单项/选项；按模块表区分 |

### src/components/FilterItemRow.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/FilterItemRow.vue:33](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/FilterItemRow.vue:33) | @click | {{label}} {{count}} | emit('select') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/FilterItemRow.vue:43](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/FilterItemRow.vue:43) | @select | &#96;${label}的操作&#96; | action | 组件选中事件传递 |

### src/components/FolderEntryTree.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/FolderEntryTree.vue:90](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/FolderEntryTree.vue:90) | @click | folder | toggleFolder(folder) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/FolderEntryTree.vue:120](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/FolderEntryTree.vue:120) | @click.stop | input | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/FolderEntryTree.vue:136](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/FolderEntryTree.vue:136) | @click.stop | &#96;将已选 ${selectedCount} 道错题移入 ${folder}&#96; | emit('moveSelected', folder) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/FolderEntryTree.vue:153](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/FolderEntryTree.vue:153) | @click.stop | 重命名文件夹 | startRename(folder) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/FolderEntryTree.vue:192](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/FolderEntryTree.vue:192) | @select | EntryList | emit('select', $event) | 组件选中事件传递 |
| [src/components/FolderEntryTree.vue:214](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/FolderEntryTree.vue:214) | @click | 未归档 {{unfiledEntries.length}} | toggleFolder(null) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/FolderEntryTree.vue:249](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/FolderEntryTree.vue:249) | @click.stop | 将已选错题移到未归档 | emit('moveSelected') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/FolderEntryTree.vue:281](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/FolderEntryTree.vue:281) | @select | EntryList | emit('select', $event) | 组件选中事件传递 |

### src/components/ImageCropper.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/ImageCropper.vue:229](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageCropper.vue:229) | @pointerdown | {{Math.round((cropRect.w / imgDisplay.w) * (imgRef?.naturalWidth ?? 1))}} × {{Math.round((cropRect.h / imgDisplay.h) * (imgRef?.naturalHeight ?? 1))}} 返回 跳过裁剪 { | onPointerDown | 专用指针交互；参见模块表 |
| [src/components/ImageCropper.vue:299](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageCropper.vue:299) | @click | 返回 | emit('cancel') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ImageCropper.vue:307](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageCropper.vue:307) | @click | 跳过裁剪 | emit('skip') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ImageCropper.vue:315](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageCropper.vue:315) | @click | {{confirmLabel}} | doCrop | 按钮/菜单项/选项；按模块表区分 |

### src/components/ImageTextModal.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/ImageTextModal.vue:102](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageTextModal.vue:102) | @click.self | 图片转文字 ✕ 原图 ↶ ↷ 识别文字（可修改） 正在识别文字，首次使用需要加载模型… {{insertionError \|\| error}} 同时保留原图 图表建议保留原图；识别后请核对数字、公式和选项。 重新识别 取消 仅插入图片 {{inserting ? '正在插入…' : '插入文字'}} | cancel | 遮罩关闭 |
| [src/components/ImageTextModal.vue:127](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageTextModal.vue:127) | @click | 关闭图片转文字 | cancel | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ImageTextModal.vue:146](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageTextModal.vue:146) | @click | 向左旋转 | rotate(-90) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ImageTextModal.vue:156](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageTextModal.vue:156) | @click | 向右旋转 | rotate(90) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ImageTextModal.vue:209](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageTextModal.vue:209) | @click | 重新识别 | recognize | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ImageTextModal.vue:218](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageTextModal.vue:218) | @click | 取消 | cancel | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ImageTextModal.vue:227](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageTextModal.vue:227) | @click | 仅插入图片 | insertImageOnly | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ImageTextModal.vue:236](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageTextModal.vue:236) | @click | {{inserting ? '正在插入…' : '插入文字'}} | emit('confirm', text, currentSrc, keepImage) | 按钮/菜单项/选项；按模块表区分 |

### src/components/ImportOptionsModal.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/ImportOptionsModal.vue:16](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImportOptionsModal.vue:16) | @click | 取消 | emit('cancel') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ImportOptionsModal.vue:19](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImportOptionsModal.vue:19) | @click | 重置为未复习 | emit('reset') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ImportOptionsModal.vue:20](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImportOptionsModal.vue:20) | @click | 保留复习进度 | emit('keep') | 按钮/菜单项/选项；按模块表区分 |

### src/components/KnowledgeLibraryDialog.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/KnowledgeLibraryDialog.vue:154](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:154) | @pointerdown | 知识库 管理学习资料与错题索引，选择对话的参考范围。 ✕ {{error}} 导入学习资料 Markdown / PDF · 每个文件创建一个服务端知识库，入库完成后可检索 {{importing ? '导入中…' : '导入文件'}} {{importProgress}} 关闭窗口后继续后台入库，完成后会通知你。 后 | onBackdropPointerDown | Modal 遮罩关闭 |
| [src/components/KnowledgeLibraryDialog.vue:156](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:156) | @click | 知识库 管理学习资料与错题索引，选择对话的参考范围。 ✕ {{error}} 导入学习资料 Markdown / PDF · 每个文件创建一个服务端知识库，入库完成后可检索 {{importing ? '导入中…' : '导入文件'}} {{importProgress}} 关闭窗口后继续后台入库，完成后会通知你。 后 | onBackdropClick | 行/区域交互或点击委托；参见模块表 |
| [src/components/KnowledgeLibraryDialog.vue:169](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:169) | @click | 关闭知识库 | emit('close') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:213](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:213) | @click | {{importing ? '导入中…' : '导入文件'}} | fileInput?.click() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:227](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:227) | @click | 后台运行 | emit('close') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:245](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:245) | @click | 取消本次导入 | emit('cancel-import', activeImportId) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:264](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:264) | @submit.prevent | 名称 简介 取消 保存知识库 | emit('save', draft) | Form 提交入口 |
| [src/components/KnowledgeLibraryDialog.vue:287](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:287) | @click | 取消 | editing = false | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:311](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:311) | @click | ＋ 新建知识库 | createLibrary | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:394](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:394) | @click | {{item.status === 'cancel_failed' ? '重试清理' : '取消导入'}} | emit('cancel-import', item.id) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:408](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:408) | @click | 取消 | pendingDeleteId = null | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:417](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:417) | @click | 确认删除 | confirmDelete(item) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:431](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:431) | @click | 取消 | pendingArchiveId = null | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:439](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:439) | @click | {{item.archived ? '确认恢复' : '确认归档'}} | confirmArchive(item) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:451](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:451) | @click | {{entriesLibraryId === item.id ? '收起错题' : '查看错题'}} | entriesLibraryId = entriesLibraryId === item.id ? '' : item.id | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:460](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:460) | @click | 编辑 | edit(item) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:469](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:469) | @click | {{item.archived ? '恢复' : '归档'}} | pendingArchiveId = item.id | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:478](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:478) | @click | {{item.status === 'delete_failed' ? '重试删除' : '删除'}} | askDelete(item) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryDialog.vue:501](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:501) | @click | 确认选择 {{chosen.filter((id) =&gt; libraries.some((x) =&gt; x.id === id &amp;&amp; selectable(x))).length}} 个 | insert | 按钮/菜单项/选项；按模块表区分 |

### src/components/KnowledgeLibraryEntries.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/KnowledgeLibraryEntries.vue:179](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryEntries.vue:179) | @click | 刷新错题 | load | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryEntries.vue:187](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryEntries.vue:187) | @submit.prevent | 搜索 | search | Form 提交入口 |
| [src/components/KnowledgeLibraryEntries.vue:234](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryEntries.vue:234) | @click | {{detailLoading === rowKey(item) ? '读取中…' : detail &amp;&amp; rowKey(detail) === rowKey(item) ? '收起题目' : '查看题目'}} | view(item) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryEntries.vue:249](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryEntries.vue:249) | @click | {{running(item) ? '入库中' : '从知识库移除'}} | pendingRemove = item | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryEntries.vue:308](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryEntries.vue:308) | @click | 取消移除 | pendingRemove = null | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryEntries.vue:317](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryEntries.vue:317) | @click | {{removing ? '正在移除…' : '确认移除'}} | remove | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryEntries.vue:331](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryEntries.vue:331) | @click | 上一页 | page(-1) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/KnowledgeLibraryEntries.vue:341](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryEntries.vue:341) | @click | 下一页 | page(1) | 按钮/菜单项/选项；按模块表区分 |

### src/components/NotebookIngestPanel.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/NotebookIngestPanel.vue:118](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookIngestPanel.vue:118) | @click | {{busy ? '入库中…' : '执行入库'}} | execute() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookIngestPanel.vue:128](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookIngestPanel.vue:128) | @click | 移除该错题本索引 | execute(true) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookIngestPanel.vue:139](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookIngestPanel.vue:139) | @click | 后台运行 | emit('background') | 按钮/菜单项/选项；按模块表区分 |

### src/components/NotebookMenu.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/NotebookMenu.vue:385](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:385) | @click | {{item.label}} | activeNav = item.id | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:419](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:419) | @click | 设置 | emit('open-settings') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:468](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:468) | @click | {{examplesBusy ? '正在创建示例…' : '设计示例'}} | openDesignExamples | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:519](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:519) | @click | 重新读取统计 | reloadStats | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:629](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:629) | @click | {{nb.name}} {{hasEntries(nb.id) ? entryCountByNotebook[nb.id] \|\| 0 : '—'}} 题 · {{hasReviews(nb.id) ? &#96;${reviewedByNotebook[nb.id] \|\| 0}/${dueByNotebook[nb.id] \| | onNotebookClick(nb.id) | 行/区域交互或点击委托；参见模块表 |
| [src/components/NotebookMenu.vue:677](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:677) | @select | &#96;错题本操作：${nb.name}&#96; | (action) =&gt; (action === 'edit' ? startEdit(nb) : startDelete(nb.id)) | 组件选中事件传递 |
| [src/components/NotebookMenu.vue:697](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:697) | @click | 新建错题本 | openCreate | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:750](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:750) | @click | 开始今日复习 → | activeNav = 'review' | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:816](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:816) | @click | 选择错题本 → | activeNav = 'review' | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:838](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:838) | @click | 打开 → | onEnterNotebook(nb.id) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:867](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:867) | @click.self | 新建错题本 名称 简介 {{createErr}} 取消 {{notebookMutation ? '处理中…' : '创建'}} | cancelCreate | 遮罩关闭 |
| [src/components/NotebookMenu.vue:872](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:872) | @click.stop | 新建错题本 名称 简介 {{createErr}} 取消 {{notebookMutation ? '处理中…' : '创建'}} | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/NotebookMenu.vue:919](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:919) | @click | 取消 | cancelCreate | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:929](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:929) | @click | {{notebookMutation ? '处理中…' : '创建'}} | confirmCreate | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:943](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:943) | @click.self | 编辑错题本 名称 简介 {{mutationError}} 取消 {{notebookMutation ? '处理中…' : '保存'}} | cancelEdit | 遮罩关闭 |
| [src/components/NotebookMenu.vue:948](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:948) | @click.stop | 编辑错题本 名称 简介 {{mutationError}} 取消 {{notebookMutation ? '处理中…' : '保存'}} | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/NotebookMenu.vue:989](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:989) | @click | 取消 | cancelEdit | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:998](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:998) | @click | {{notebookMutation ? '处理中…' : '保存'}} | confirmEdit | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:1012](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:1012) | @click.self | 删除错题本 将同时删除本错题本内的所有题目及复习记录，此操作不可撤销。 {{mutationError}} 取消 {{notebookMutation ? '处理中…' : '确认删除'}} | cancelDelete | 遮罩关闭 |
| [src/components/NotebookMenu.vue:1017](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:1017) | @click.stop | 删除错题本 将同时删除本错题本内的所有题目及复习记录，此操作不可撤销。 {{mutationError}} 取消 {{notebookMutation ? '处理中…' : '确认删除'}} | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/NotebookMenu.vue:1052](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:1052) | @click | 取消 | cancelDelete | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NotebookMenu.vue:1061](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookMenu.vue:1061) | @click | {{notebookMutation ? '处理中…' : '确认删除'}} | confirmDelete | 按钮/菜单项/选项；按模块表区分 |

### src/components/NoteEditor.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/NoteEditor.vue:900](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:900) | @click | {{answersCollapsed ? '展开答案' : '收起答案'}} | toggleQuestionHeight | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NoteEditor.vue:914](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:914) | @click | 恢复默认 | resetPanelLayout | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NoteEditor.vue:928](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:928) | @click | {{layoutLocked ? '调整布局' : '完成布局'}} | toggleLayoutLock | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NoteEditor.vue:950](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:950) | @click | 复习次数按每次提交复习结果累计；答错次数只统计明确标记为错误的作答。掌握程度不计入对错。 | historyOpen = !historyOpen | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NoteEditor.vue:1035](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1035) | @mousedown | 公共材料 一拖 {{groupEntries?.length \|\| 1}} ⠿ 拖动 | activateFormattingPanel('material') | 富文本选区/激活保护 |
| [src/components/NoteEditor.vue:1051](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1051) | @pointerdown.stop | 拖动公共材料板块换位 | startPanelDrag($event, 'material') | 自定义拖动/换位 |
| [src/components/NoteEditor.vue:1052](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1052) | @click.stop | 拖动公共材料板块换位 | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/NoteEditor.vue:1083](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1083) | @click | div | handleMaterialEditorClick | 富文本点击委托 |
| [src/components/NoteEditor.vue:1099](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1099) | @mousedown | 调整公共材料区域大小 | startPanelResize($event, 'primary-column') | Splitter 尺寸调整 |
| [src/components/NoteEditor.vue:1114](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1114) | @mousedown | 题目 ⠿ 拖动 ‹ 第 {{currentGroupIndex + 1}} / {{groupEntries?.length \|\| 1}} 题 › ＋ 添加小题 转为题组 | activateFormattingPanel('question') | 富文本选区/激活保护 |
| [src/components/NoteEditor.vue:1128](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1128) | @pointerdown.stop | 拖动题目板块换位 | startPanelDrag($event, 'question') | 自定义拖动/换位 |
| [src/components/NoteEditor.vue:1129](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1129) | @click.stop | 拖动题目板块换位 | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/NoteEditor.vue:1139](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1139) | @click | 上一小题 | selectSibling(-1) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NoteEditor.vue:1152](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1152) | @click | 下一小题 | selectSibling(1) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NoteEditor.vue:1158](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1158) | @click | ＋ 添加小题 | emit('add-sub-question') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NoteEditor.vue:1185](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1185) | @click | 将当前题目转换为包含公共材料和多个小题的题组 | requestQuestionGroupConversion | 按钮/菜单项/选项；按模块表区分 |
| [src/components/NoteEditor.vue:1218](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1218) | @click | div | handleQuestionEditorClick | 富文本点击委托 |
| [src/components/NoteEditor.vue:1234](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1234) | @mousedown | 调整题目和答案区域的高度 | startPanelResize($event, 'primary-row') | Splitter 尺寸调整 |
| [src/components/NoteEditor.vue:1275](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1275) | @mousedown | 调整下方两个板块的宽度 | startPanelResize($event, 'secondary-column') | Splitter 尺寸调整 |

### src/components/PdfImportDialog.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/PdfImportDialog.vue:183](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:183) | @pointerdown | AI 辅助导入 导入 PDF 错题 {{preview ? '逐题校对识别结果，确认后保存到错题本。' : '从试卷中提取题目、图片和公共材料。'}} {{step === 3 ? '导入完成' : preview ? '等待校对' : loading ? '正在识别' : '选择文件'}} {{step &gt; inde | onBackdropPointerDown | Modal 遮罩关闭 |
| [src/components/PdfImportDialog.vue:185](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:185) | @click | AI 辅助导入 导入 PDF 错题 {{preview ? '逐题校对识别结果，确认后保存到错题本。' : '从试卷中提取题目、图片和公共材料。'}} {{step === 3 ? '导入完成' : preview ? '等待校对' : loading ? '正在识别' : '选择文件'}} {{step &gt; inde | onBackdropClick | 行/区域交互或点击委托；参见模块表 |
| [src/components/PdfImportDialog.vue:227](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:227) | @click | {{questionLocation(issue.question)}} ： {{issue.messages.join('；')}} | showItem('question', issue.question.key) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:243](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:243) | @click | 后台运行 | emit('background') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:307](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:307) | @click | 第 {{question.source_number}} 题 {{question.stem \|\| '待补充题干'}} {{pdfQuestionIssues(question).join('；')}} {{question.kind === 'choice' ? '选择题' : '非选择题'}} · 第 {{ques | showItem('question', question.key) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:339](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:339) | @click | {{group.title \|\| '未命名材料'}} {{preview.draft.questions.filter((q) =&gt; q.group_key === group.key).length}} 题 | showItem('group', group.key) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:374](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:374) | @click | 上一题 | nextQuestion(-1) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:384](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:384) | @click | 下一题 | nextQuestion(1) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:430](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:430) | @click | 查看并校对关联材料 ↗ | showItem('group', activeQuestion.group_key) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:510](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:510) | @click | '移除' + option.key + '选项' | activeQuestion.options.splice(index, 1) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:520](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:520) | @click | ＋ 补充选项 | addOption(activeQuestion) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:602](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:602) | @click | 第 {{question.source_number}} 题 → | showItem('question', question.key) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:679](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:679) | @click | 重新加载草稿 | reload | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:689](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:689) | @click | 关闭 | close | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:699](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:699) | @click | {{confirming ? '正在录入…' : '确认录入 ' + selected.length + ' 道题目'}} | confirmSelection | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:713](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:713) | @click | {{cancelling ? '正在取消…' : result ? '关闭' : '取消'}} | close | 按钮/菜单项/选项；按模块表区分 |
| [src/components/PdfImportDialog.vue:723](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:723) | @click | {{loading ? '处理中…' : '提交 PDF'}} | file &amp;&amp; emit('submit', file) | 按钮/菜单项/选项；按模块表区分 |

### src/components/QuestionGroupConfirmModal.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/QuestionGroupConfirmModal.vue:16](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/QuestionGroupConfirmModal.vue:16) | @click | 取消 | emit('cancel') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/QuestionGroupConfirmModal.vue:19](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/QuestionGroupConfirmModal.vue:19) | @click | 确认转化 | emit('confirm') | 按钮/菜单项/选项；按模块表区分 |

### src/components/QuestionLinkModal.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/QuestionLinkModal.vue:59](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/QuestionLinkModal.vue:59) | @mousedown.self | {{linkedTargetId ? '管理题目链接' : '链接到题目'}} 仅显示当前笔记本中的其他题目 × {{linkedEntry?.title \|\| '关联题目已删除'}} {{linkedEntry ? [linkedEntry.subject, linkedEntry.source].filter(Bo | emit('cancel') | Modal 遮罩关闭 |
| [src/components/QuestionLinkModal.vue:83](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/QuestionLinkModal.vue:83) | @click | 关闭 | emit('cancel') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/QuestionLinkModal.vue:115](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/QuestionLinkModal.vue:115) | @click | 打开题目 | emit('open', linkedEntry.id) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/QuestionLinkModal.vue:124](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/QuestionLinkModal.vue:124) | @click | 取消链接 | emit('remove') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/QuestionLinkModal.vue:146](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/QuestionLinkModal.vue:146) | @click | {{entry.title \|\| '未命名题目'}} {{[entry.subject, entry.source, entry.tags.join('、')] .filter(Boolean) .join(' · ') \|\| '暂无分类信息'}} 当前链接 | emit('choose', entry) | 按钮/菜单项/选项；按模块表区分 |

### src/components/ReviewAgentEntry.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/ReviewAgentEntry.vue:207](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewAgentEntry.vue:207) | @click | ＋ 新对话 | selectChat(null) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewAgentEntry.vue:224](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewAgentEntry.vue:224) | @select | chat.title | selectChat(chat.id) | 组件选中事件传递 |
| [src/components/ReviewAgentEntry.vue:234](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewAgentEntry.vue:234) | @click | 知识库管理 {{available.length}} | libraryMode = 'manage' | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewAgentEntry.vue:311](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewAgentEntry.vue:311) | @click | div | openAnswerLink | 行/区域交互或点击委托；参见模块表 |
| [src/components/ReviewAgentEntry.vue:339](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewAgentEntry.vue:339) | @click | 重试 | retry | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewAgentEntry.vue:361](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewAgentEntry.vue:361) | @click | {{choiceIndex + 1}} . {{choice.label}} | executeChoice(choice.text) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewAgentEntry.vue:395](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewAgentEntry.vue:395) | @click | &#96;移除知识库 ${library.name}&#96; | selectedLibraries = selectedLibraries.filter((id) =&gt; id !== library.id) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewAgentEntry.vue:404](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewAgentEntry.vue:404) | @click | 你的复习目标 ▤ 选择知识库 {{sending ? '正在回复…' : 'Enter 发送 · Shift+Enter 换行'}} | animateComposer | 行/区域交互或点击委托；参见模块表 |
| [src/components/ReviewAgentEntry.vue:405](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewAgentEntry.vue:405) | @submit.prevent | 你的复习目标 ▤ 选择知识库 {{sending ? '正在回复…' : 'Enter 发送 · Shift+Enter 换行'}} | send() | Form 提交入口 |
| [src/components/ReviewAgentEntry.vue:423](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewAgentEntry.vue:423) | @click.stop | ▤ 选择知识库 | libraryMode = 'insert' | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewAgentEntry.vue:461](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewAgentEntry.vue:461) | @click | ↗ {{suggestion.label}} | choose(suggestion.prompt) | 按钮/菜单项/选项；按模块表区分 |

### src/components/ReviewHistoryDetailModal.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/ReviewHistoryDetailModal.vue:83](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewHistoryDetailModal.vue:83) | @click.self | {{scope === 'due' ? '到期复习' : '自由复习'}} · 已完成 本次复习详情 {{formatDate(session.completedAt)}} · {{session.reviewedCount}} 题 · 总用时 {{formatTime(session.totalElapsedMs)} | emit('close') | 遮罩关闭 |
| [src/components/ReviewHistoryDetailModal.vue:113](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewHistoryDetailModal.vue:113) | @click | 关闭 | emit('close') | 按钮/菜单项/选项；按模块表区分 |

### src/components/ReviewPanel.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/ReviewPanel.vue:256](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewPanel.vue:256) | @click | ← 返回列表 | closeSummaryEntry | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewPanel.vue:335](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewPanel.vue:335) | @click | {{i + 1}} {{entryById(rec.entryId)?.subject \|\| ''}} {{rec.selectedChoice &amp;&amp; rec.correctChoice ? &#96;选 ${rec.selectedChoice}，正确 ${rec.correctChoice}&#96; : '本次答错'}} {{f | openSummaryEntry(rec.entryId) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewPanel.vue:377](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewPanel.vue:377) | @click | 返回编辑 | emit('dismissSummary') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewPanel.vue:560](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewPanel.vue:560) | @click | 重试判卷 | emit('retry-grading') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewPanel.vue:570](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewPanel.vue:570) | @click | {{submitting ? '正在核对…' : '提交解题理由'}} | emit('explain', explanationText) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewPanel.vue:586](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewPanel.vue:586) | @click | {{submitting ? '正在判卷…' : gradingLocked ? '重试判卷' : '提交作答'}} | submitAnswer | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewPanel.vue:597](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewPanel.vue:597) | @click | {{isLastCard ? '结束复习' : '下一题'}} | emit('next-review') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ReviewPanel.vue:608](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewPanel.vue:608) | @click | 退出复习 | emit('exitReview') | 按钮/菜单项/选项；按模块表区分 |

### src/components/RichTextSizeControls.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/RichTextSizeControls.vue:75](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:75) | @mousedown | B 荧光笔 混合 {{color.label}} 无颜色 | emit('preserve-selection') | 富文本选区/激活保护 |
| [src/components/RichTextSizeControls.vue:90](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:90) | @mousedown.prevent | 切换加粗 | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/RichTextSizeControls.vue:91](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:91) | @click | 切换加粗 | emit('toggle-bold') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/RichTextSizeControls.vue:118](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:118) | @mousedown.prevent | 切换荧光笔 | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/RichTextSizeControls.vue:119](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:119) | @click | 切换荧光笔 | toggleHighlight | 按钮/菜单项/选项；按模块表区分 |
| [src/components/RichTextSizeControls.vue:133](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:133) | @mousedown.prevent | 选择荧光颜色 | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/RichTextSizeControls.vue:134](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:134) | @click | 选择荧光颜色 | paletteOpen = !paletteOpen | 按钮/菜单项/选项；按模块表区分 |
| [src/components/RichTextSizeControls.vue:166](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:166) | @mousedown.prevent | {{color.label}} | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/RichTextSizeControls.vue:167](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:167) | @click | {{color.label}} | chooseColor(color.value) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/RichTextSizeControls.vue:178](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:178) | @mousedown.prevent | 无颜色 | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/RichTextSizeControls.vue:179](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:179) | @click | 无颜色 | chooseColor('transparent') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/RichTextSizeControls.vue:191](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:191) | @mousedown.prevent | 链接到其他题目 | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/RichTextSizeControls.vue:192](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:192) | @click | 链接到其他题目 | emit('link') | 按钮/菜单项/选项；按模块表区分 |

### src/components/ScreenshotPicker.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/ScreenshotPicker.vue:110](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ScreenshotPicker.vue:110) | @click.self | 选择截屏区域 正在获取窗口列表… {{error}} {{s.name}} | emit('close') | 遮罩关闭 |
| [src/components/ScreenshotPicker.vue:126](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ScreenshotPicker.vue:126) | @click | 关闭 | emit('close') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/ScreenshotPicker.vue:162](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ScreenshotPicker.vue:162) | @click | {{s.name}} | captureSource(s) | 按钮/菜单项/选项；按模块表区分 |

### src/components/SettingsPanel.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/SettingsPanel.vue:99](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SettingsPanel.vue:99) | @click | 关闭 | emit('close') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SettingsPanel.vue:133](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SettingsPanel.vue:133) | @click | 切换深色模式 | emit('toggleDark') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SettingsPanel.vue:153](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SettingsPanel.vue:153) | @click | 自动保存 | preferences.autoSave = !preferences.autoSave | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SettingsPanel.vue:198](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SettingsPanel.vue:198) | @click | 复习设置 | reviewExpanded = !reviewExpanded | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SettingsPanel.vue:352](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SettingsPanel.vue:352) | @click | 保存复习设置 | save | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SettingsPanel.vue:371](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SettingsPanel.vue:371) | @click | {{isElectron ? '更改保存目录' : '仅桌面端可用'}} | emit('changeDataDir') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SettingsPanel.vue:400](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SettingsPanel.vue:400) | @click | 退出登录 | emit('logout') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SettingsPanel.vue:425](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SettingsPanel.vue:425) | @click | 快捷键 | shortcutsExpanded = !shortcutsExpanded | 按钮/菜单项/选项；按模块表区分 |

### src/components/StatsPanel.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/StatsPanel.vue:107](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/StatsPanel.vue:107) | @click | div | emit('close') | 行/区域交互或点击委托；参见模块表 |
| [src/components/StatsPanel.vue:142](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/StatsPanel.vue:142) | @click | 关闭 | emit('close') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/StatsPanel.vue:342](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/StatsPanel.vue:342) | @click | {{formatSessionTime(session.completedAt)}} 完成 {{session.reviewedCount}} / {{session.totalCount}} 题 用时 {{formatDuration(session.totalElapsedMs)}} · 点击查看全部题目 | openSession(session) | 按钮/菜单项/选项；按模块表区分 |

### src/components/SubjectChips.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/SubjectChips.vue:103](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:103) | @click | 学科 | sectionOpen = !sectionOpen | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SubjectChips.vue:123](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:123) | @click | 新建学科 | startAddSubject() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SubjectChips.vue:155](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:155) | @click | 确定 | confirmAddSubject() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SubjectChips.vue:161](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:161) | @click | 取消 | cancelAddSubject() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SubjectChips.vue:178](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:178) | @select | 全部 | emit('filter', '__all__') | 组件选中事件传递 |
| [src/components/SubjectChips.vue:179](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:179) | @select | 未分类 | emit('filter', '__none__') | 组件选中事件传递 |
| [src/components/SubjectChips.vue:194](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:194) | @click | button | confirmEdit() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SubjectChips.vue:209](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:209) | @click | button | cancelEdit() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SubjectChips.vue:232](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:232) | @click | button | confirmDelete() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SubjectChips.vue:247](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:247) | @click | button | cancelDelete() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/SubjectChips.vue:263](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:263) | @select | subject | emit('filter', subject) | 组件选中事件传递 |

### src/components/TagDots.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/TagDots.vue:102](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagDots.vue:102) | @click | 标签 | sectionOpen = !sectionOpen | 按钮/菜单项/选项；按模块表区分 |
| [src/components/TagDots.vue:122](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagDots.vue:122) | @click | 新建标签 | startAddTag() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/TagDots.vue:154](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagDots.vue:154) | @click | 确定 | confirmAddTag() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/TagDots.vue:160](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagDots.vue:160) | @click | 取消 | cancelAddTag() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/TagDots.vue:177](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagDots.vue:177) | @select | 全部 | emit('filter', '__all__') | 组件选中事件传递 |
| [src/components/TagDots.vue:196](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagDots.vue:196) | @click | button | confirmEdit() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/TagDots.vue:211](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagDots.vue:211) | @click | button | cancelEdit() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/TagDots.vue:234](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagDots.vue:234) | @click | button | confirmDelete() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/TagDots.vue:249](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagDots.vue:249) | @click | button | cancelDelete() | 按钮/菜单项/选项；按模块表区分 |
| [src/components/TagDots.vue:265](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagDots.vue:265) | @select | tag | emit('filter', tag) | 组件选中事件传递 |

### src/components/TagMultiSelect.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/TagMultiSelect.vue:182](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagMultiSelect.vue:182) | @click.stop | &#96;移除标签：${tag}&#96; | removeTag(tag) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/TagMultiSelect.vue:245](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagMultiSelect.vue:245) | @mousedown.prevent | {{tag}} | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/TagMultiSelect.vue:246](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagMultiSelect.vue:246) | @click | {{tag}} | toggleTag(tag) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/TagMultiSelect.vue:281](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagMultiSelect.vue:281) | @mousedown.prevent | + 创建 “ {{filterText.trim()}} ” | — | 冒泡/默认行为保护，无业务动作 |
| [src/components/TagMultiSelect.vue:284](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagMultiSelect.vue:284) | @click | + 创建 “ {{filterText.trim()}} ” | createTag | 按钮/菜单项/选项；按模块表区分 |

### src/components/UiModal.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/UiModal.vue:88](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/UiModal.vue:88) | @pointerdown | {{title}} {{description}} {{error}} | onBackdropPointerDown | Modal 遮罩关闭 |
| [src/components/UiModal.vue:90](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/UiModal.vue:90) | @click | {{title}} {{description}} {{error}} | onBackdropClick | 行/区域交互或点击委托；参见模块表 |

### src/components/UnsavedModal.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/UnsavedModal.vue:27](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/UnsavedModal.vue:27) | @click | 取消 | emit('cancel') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/UnsavedModal.vue:37](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/UnsavedModal.vue:37) | @click | 不保存 | emit('discard') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/UnsavedModal.vue:46](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/UnsavedModal.vue:46) | @click | {{busy ? '保存中…' : requireSave ? '保存并关闭' : '保存'}} | emit('save') | 按钮/菜单项/选项；按模块表区分 |

### src/components/Workspace.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/components/Workspace.vue:338](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:338) | @click | 关闭题目侧栏 | sidebarCollapsed = true | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:367](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:367) | @select | AppSidebar | selectEntry | 组件选中事件传递 |
| [src/components/Workspace.vue:420](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:420) | @click | 切换画笔模式 | emit('toggle-drawing') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:439](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:439) | @click | 上一题 | emit('prev') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:451](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:451) | @click | 下一题 | emit('next') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:486](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:486) | @click | 重试加载 | retryContent | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:592](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:592) | @click | 新建错题 | emit('quick-create', '') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:600](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:600) | @click | 查看第一道题 | selectEntry(filteredEntries[0]!.id) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:608](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:608) | @click | 清除搜索与筛选 | clearSearchAndFilters | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:639](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:639) | @click | 使用画笔 | emit('set-tool', 'pen') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:670](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:670) | @click | &#96;${c.name}色画笔&#96; | emit('set-color', c.code) | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:700](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:700) | @click | 使用橡皮 | emit('set-tool', 'eraser') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:749](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:749) | @click | 撤销 Ctrl+Z | emit('undo') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:772](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:772) | @click | 重做 Ctrl+Y | emit('redo') | 按钮/菜单项/选项；按模块表区分 |
| [src/components/Workspace.vue:790](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:790) | @click | 清除 | emit('clear-canvas') | 按钮/菜单项/选项；按模块表区分 |

### src/plugins/english-vocabulary/VocabularyPanel.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1048](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1048) | @click | 返回错题本 | closePanel | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1069](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1069) | @click | 使用系统浏览器打开 Anki 词库资源库 | openAnkiDeckLibrary | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1089](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1089) | @click | 导入 APKG 词库 | beginImport | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1109](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1109) | @click | 粘贴表格导入 | openTextImport | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1128](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1128) | @click | ＋ 新建词库 | newArchiveOpen = true | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1144](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1144) | @click | {{item.name}} {{item.wordCount}} 个词条 | openArchive(item.id) | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1205](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1205) | @click | 复习曲线 | openCurveSettings | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1223](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1223) | @click | 全部单词 | openVocabularyWords | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1241](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1241) | @click | ＋ 新增单词 | openAddWord | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1252](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1252) | @click | 删除当前词库 | deleteArchiveOpen = true | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1334](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1334) | @click | 开始今日复习 循环学习今日冻结计划，不加入答错回炉词 | startTodaySession('learn') | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1344](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1344) | @click | 今日中 → 英 今日计划 + {{translationRetryCount}} 个后续回炉词 | startTodaySession('review', 'zh-to-en') | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1354](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1354) | @click | 今日英 → 中 今日计划 + {{translationRetryCount}} 个后续回炉词 | startTodaySession('review', 'en-to-zh') | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1368](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1368) | @click | 预览今日单词（ {{todayPlanWords.length}} ） | todayPreviewOpen = !todayPreviewOpen | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1388](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1388) | @click | {{index + 1}} {{plainText(word.word)}} {{plainText(word.meaning)}} | previewTodayWord(word.id) | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1420](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1420) | @click | 返回词库 | view = 'library' | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1471](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1471) | @click | 全部 | setWordTagFilter(null) | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1486](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1486) | @click | # {{tag}} | setWordTagFilter(tag) | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1533](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1533) | @click | 编辑 | openEditWord(word) | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1541](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1541) | @click | 删除 | openDeleteWord(word) | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1556](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1556) | @click | 上一页 | wordPage -= 1 | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1565](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1565) | @click | 下一页 | wordPage += 1 | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1592](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1592) | @click | 返回词库 | returnToLibrary | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1606](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1606) | @click | 上一词 | previousWord | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1626](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1626) | @click | 下一词 | nextWord | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1645](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1645) | @click | 返回词库 | view = 'library' | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1680](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1680) | @click | 播放发音 | playCurrentAudio | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1715](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1715) | @click | 显示翻译和注释 | revealed = true | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1809](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1809) | @click | 播放发音 | playCurrentAudio | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1876](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1876) | @click | {{checked ? '下一个 · Enter ↵' : '检查答案'}} | checked ? nextWord() : checkAnswer() | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1890](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1890) | @click | 上一词 | previousWord | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1907](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1907) | @click | 下一词 | nextWord | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1918](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1918) | @click.self | 确认字段对应 {{inspection.sourceFilename}} · {{inspection.noteCount}} 个词条。不同模板可分别设置，未使用的项目留空。 词库名称 {{model.name}} {{label}} 取消 {{busy ? '正在归档...' : '确认并归档'}} | !busy &amp;&amp; (inspection = null) | 遮罩关闭 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1965](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1965) | @click | 取消 | inspection = null | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1974](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1974) | @click | {{busy ? '正在归档...' : '确认并归档'}} | confirmImport | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1985](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1985) | @click.self | 粘贴表格导入单词 支持对齐表格，也支持“术语 + 释义 + 例句 + 解析”的知识卡片；词性会自动保存为标签。 SELECT 释义：查询数据 例句：SELECT * FROM materials; 解析：* 表示所有字段。 导入目标 新词库名称 释义字段别名 例句字段别名 解析字段别名 为本次导入统一添加标签 单词表内 | !busy &amp;&amp; (textImportOpen = false) | 遮罩关闭 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2086](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2086) | @click | 取消 | textImportOpen = false | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2099](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2099) | @click | {{busy ? '正在导入...' : '一键导入'}} | confirmTextImport | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2110](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2110) | @click.self | 新建词库 创建空白词库后，可逐个添加单词。 取消 {{busy ? '正在创建...' : '创建'}} | !busy &amp;&amp; (newArchiveOpen = false) | 遮罩关闭 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2115](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2115) | @submit.prevent | 新建词库 创建空白词库后，可逐个添加单词。 取消 {{busy ? '正在创建...' : '创建'}} | createArchive | Form 提交入口 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2132](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2132) | @click | 取消 | newArchiveOpen = false | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2151](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2151) | @click.self | {{editingWordId ? '编辑单词' : '新增单词'}} 英语单词 * 音标 中文释义 * 英语例句 例句翻译 答案后详解 注释 标签（逗号或空格分隔） 取消 {{editingWordId ? '保存修改' : '保存单词'}} | addWordOpen = false | 遮罩关闭 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2156](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2156) | @submit.prevent | {{editingWordId ? '编辑单词' : '新增单词'}} 英语单词 * 音标 中文释义 * 英语例句 例句翻译 答案后详解 注释 标签（逗号或空格分隔） 取消 {{editingWordId ? '保存修改' : '保存单词'}} | addWord | Form 提交入口 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2226](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2226) | @click | 取消 | closeAddWord | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2245](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2245) | @click.self | 删除单词？ “ {{plainText(deletingWord.word)}} ”将从当前词库和学习计划中移除。 取消 删除 | deleteWordOpen = false | 遮罩关闭 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2261](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2261) | @click | 取消 | deleteWordOpen = false | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2268](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2268) | @click | 删除 | confirmDeleteWord | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2279](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2279) | @click.self | 删除词库“ {{archive.name}} ”？ 将删除当前错题本中该词库的原 APKG、全部词条、音频和学习进度。已经归档到错题本的错题不会删除。 此操作不可恢复。 取消 {{deletingArchive ? '正在删除...' : '删除词库'}} | !deletingArchive &amp;&amp; (deleteArchiveOpen = false) | 遮罩关闭 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2302](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2302) | @click | 取消 | deleteArchiveOpen = false | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2311](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2311) | @click | {{deletingArchive ? '正在删除...' : '删除词库'}} | confirmDeleteArchive | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2322](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2322) | @click.self | 复习曲线设置 连续答对会逐级延长间隔，达到最后一级后保持该间隔。 连续答对第 {{index + 1}} 次 天后 答错后再次出现 分钟 取消 保存设置 | curveSettingsOpen = false | 遮罩关闭 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2370](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2370) | @click | 取消 | curveSettingsOpen = false | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2378](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2378) | @click | 保存设置 | saveCurveSettings | 按钮/菜单项/选项；按模块表区分 |

### src/plugins/PluginManager.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/plugins/PluginManager.vue:47](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/PluginManager.vue:47) | @click.self | 添加功能 适用于当前错题本 · {{notebookName}} {{actionError}} {{plugin.name}} 已安装 {{plugin.description}} 需要：文件导入、本地存储、音频播放 {{pendingId === plugin.id ? '安装中…' : '安装'}} {{pend | !pendingId &amp;&amp; emit('close') | 遮罩关闭 |
| [src/plugins/PluginManager.vue:68](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/PluginManager.vue:68) | @click | 关闭 | emit('close') | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/PluginManager.vue:128](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/PluginManager.vue:128) | @click | {{pendingId === plugin.id ? '安装中…' : '安装'}} | emit('install', plugin.id) | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/PluginManager.vue:138](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/PluginManager.vue:138) | @click | {{pendingId === plugin.id ? '卸载中…' : '卸载'}} | requestUninstall(plugin) | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/PluginManager.vue:211](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/PluginManager.vue:211) | @click | 取消 | uninstallTarget = null | 按钮/菜单项/选项；按模块表区分 |
| [src/plugins/PluginManager.vue:220](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/PluginManager.vue:220) | @click | {{pendingId ? '正在卸载…' : '确认卸载'}} | confirmUninstall | 按钮/菜单项/选项；按模块表区分 |

### src/site/GuideOverview.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/site/GuideOverview.vue:184](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/GuideOverview.vue:184) | @click | 快速上手 ↗ | emit('choose', 'quick-start') | 链接导航或命令；参见处理表达式 |
| [src/site/GuideOverview.vue:206](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/GuideOverview.vue:206) | @click | {{scene.action}} ↗ | emit('choose', scene.target) | 链接导航或命令；参见处理表达式 |
| [src/site/GuideOverview.vue:214](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/GuideOverview.vue:214) | @click | {{link.label}} → | emit('choose', link.id) | 链接导航或命令；参见处理表达式 |
| [src/site/GuideOverview.vue:229](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/GuideOverview.vue:229) | @click | &#96;放大截图：${image.label}&#96; | emit('zoom', image.shot) | 按钮/菜单项/选项；按模块表区分 |
| [src/site/GuideOverview.vue:243](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/GuideOverview.vue:243) | @click | 0 {{index + 1}} {{scene.title}} | goToScene(index) | 按钮/菜单项/选项；按模块表区分 |
| [src/site/GuideOverview.vue:266](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/GuideOverview.vue:266) | @click | {{chapter.title}} ↗ | emit('choose', chapter.id) | 链接导航或命令；参见处理表达式 |

### src/site/SiteApp.vue

| 代码位置 | 事件 | 标签 / 可见文字摘要 | 处理表达式 | 作用层次 |
| --- | --- | --- | --- | --- |
| [src/site/SiteApp.vue:142](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:142) | @click | 使用指南 ↗ | chooseSection('overview') | 链接导航或命令；参见处理表达式 |
| [src/site/SiteApp.vue:167](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:167) | @click | 全部章节 · {{guideSections.length - 1}} 篇 {{menuExpanded ? '收起 −' : '展开 +'}} | menuExpanded = !menuExpanded | 按钮/菜单项/选项；按模块表区分 |
| [src/site/SiteApp.vue:178](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:178) | @click | 指南总览 ⌘ | chooseSection('overview') | 链接导航或命令；参见处理表达式 |
| [src/site/SiteApp.vue:188](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:188) | @click | {{section.title}} ↗ | chooseSection(section.id) | 链接导航或命令；参见处理表达式 |
| [src/site/SiteApp.vue:205](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:205) | @click | {{result.title}} → {{excerpt(result.text)}} | chooseSection(result.id) | 链接导航或命令；参见处理表达式 |
| [src/site/SiteApp.vue:213](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:213) | @click | 返回文档 | query = '' | 按钮/菜单项/选项；按模块表区分 |
| [src/site/SiteApp.vue:225](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:225) | @click | 使用文档 | chooseSection('overview') | 链接导航或命令；参见处理表达式 |
| [src/site/SiteApp.vue:257](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:257) | @click | &#96;放大截图：${block.figure.alt}&#96; | zoomImage(block.figure) | 按钮/菜单项/选项；按模块表区分 |
| [src/site/SiteApp.vue:266](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:266) | @click | &#96;放大截图：${block.figure.caption}&#96; | zoomImage(block.figure) | 按钮/菜单项/选项；按模块表区分 |
| [src/site/SiteApp.vue:293](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:293) | @click | ← 上一篇 {{guideSections[activeIndex - 1].title}} | chooseSection(guideSections[activeIndex - 1].id) | 链接导航或命令；参见处理表达式 |
| [src/site/SiteApp.vue:298](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:298) | @click | 下一篇 → {{guideSections[activeIndex + 1].title}} | chooseSection(guideSections[activeIndex + 1].id) | 链接导航或命令；参见处理表达式 |
| [src/site/SiteApp.vue:411](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:411) | @click | 界面截图大图 | (event) =&gt; { if (event.target === imageDialog) closeImage() } | 行/区域交互或点击委托；参见模块表 |
| [src/site/SiteApp.vue:420](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:420) | @click | 关闭截图大图 | closeImage | 按钮/菜单项/选项；按模块表区分 |

## B. 原生链接（与上述事件可能重叠）

| 代码位置 | 链接文字摘要 | href / 绑定表达式 | 同时声明 click |
| --- | --- | --- | --- |
| [src/components/AuthScreen.vue:114](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AuthScreen.vue:114) | ← 返回官网 | / | 否 |
| [src/components/AuthScreen.vue:231](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AuthScreen.vue:231) | 使用文档 ↗ | /docs/ | 否 |
| [src/components/AuthScreen.vue:232](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AuthScreen.vue:232) | 下载桌面版 ↗ | /download/ | 否 |
| [src/components/PdfImportDialog.vue:259](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:259) | 查看原 PDF ↗ | sourceUrl | 否 |
| [src/components/WebsiteLinks.vue:12](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/WebsiteLinks.vue:12) | 官网首页 ↗ | / | 否 |
| [src/components/WebsiteLinks.vue:13](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/WebsiteLinks.vue:13) | 使用文档 ↗ | /docs/ | 否 |
| [src/site/GuideOverview.vue:184](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/GuideOverview.vue:184) | 快速上手 ↗ | #quick-start | 是 |
| [src/site/GuideOverview.vue:203](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/GuideOverview.vue:203) | {{scene.action}} ↗ | &#96;#${scene.target}&#96; | 是 |
| [src/site/GuideOverview.vue:210](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/GuideOverview.vue:210) | {{link.label}} → | &#96;#${link.id}&#96; | 是 |
| [src/site/GuideOverview.vue:260](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/GuideOverview.vue:260) | {{chapter.title}} ↗ | &#96;#${chapter.id}&#96; | 是 |
| [src/site/LandingPage.vue:25](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/LandingPage.vue:25) | 使用文档 ↗ | /docs/ | 否 |
| [src/site/LandingPage.vue:42](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/LandingPage.vue:42) | 进入网页版 ↗ | /app/ | 否 |
| [src/site/LandingPage.vue:43](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/LandingPage.vue:43) | 下载桌面版 | /download/ | 否 |
| [src/site/SiteApp.vue:112](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:112) | 跳到正文 | #main-content | 否 |
| [src/site/SiteApp.vue:115](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:115) | &#96;${siteConfig.name}官网首页&#96; | / | 否 |
| [src/site/SiteApp.vue:119](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:119) | {{link.title}} | link.href | 否 |
| [src/site/SiteApp.vue:127](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:127) | 进入网页版 ↗ | /app/ | 否 |
| [src/site/SiteApp.vue:142](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:142) | 使用指南 ↗ | #overview | 是 |
| [src/site/SiteApp.vue:174](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:174) | 指南总览 ⌘ | #overview | 是 |
| [src/site/SiteApp.vue:183](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:183) | {{section.title}} ↗ | &#96;#${section.id}&#96; | 是 |
| [src/site/SiteApp.vue:193](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:193) | 打开我的错题本 ↗ | /app/ | 否 |
| [src/site/SiteApp.vue:201](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:201) | {{result.title}} → {{excerpt(result.text)}} | &#96;#${result.id}&#96; | 是 |
| [src/site/SiteApp.vue:225](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:225) | 使用文档 | #overview | 是 |
| [src/site/SiteApp.vue:287](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:287) | 打开网页版 ↗ | /app/ | 否 |
| [src/site/SiteApp.vue:290](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:290) | ← 上一篇 {{guideSections[activeIndex - 1].title}} | &#96;#${guideSections[activeIndex - 1].id}&#96; | 是 |
| [src/site/SiteApp.vue:295](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:295) | 下一篇 → {{guideSections[activeIndex + 1].title}} | &#96;#${guideSections[activeIndex + 1].id}&#96; | 是 |
| [src/site/SiteApp.vue:310](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:310) | {{heading.title}} | &#96;#${heading.id}&#96; | 否 |
| [src/site/SiteApp.vue:341](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:341) | 下载 Windows 安装包 ↓ | siteConfig.windowsInstaller | 否 |
| [src/site/SiteApp.vue:353](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:353) | 下载 Windows 便携版 ↓ | siteConfig.windowsPortable | 否 |
| [src/site/SiteApp.vue:359](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:359) | 安装后如何开始？阅读使用指南 → | /docs/#quick-start | 否 |
| [src/site/SiteApp.vue:366](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:366) | 进入网页版 ↗ | /app/ | 否 |
| [src/site/SiteApp.vue:381](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:381) | 查看备份步骤 → | /docs/#backup | 否 |
| [src/site/SiteApp.vue:387](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:387) | 常见问题 | /docs/#faq | 否 |
| [src/site/SiteApp.vue:401](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:401) | 返回首页 | / | 否 |
| [src/site/SiteApp.vue:402](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:402) | 使用文档 | /docs/ | 否 |
| [src/site/SiteApp.vue:436](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:436) | &#96;${siteConfig.name}官网首页&#96; | / | 否 |
| [src/site/SiteApp.vue:440](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:440) | 网页版 ↗ | /app/ | 否 |
| [src/site/SiteApp.vue:440](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:440) | 下载桌面版 | /download/ | 否 |
| [src/site/SiteApp.vue:441](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/site/SiteApp.vue:441) | 使用文档 | /docs/ | 否 |

## C. 原生/底层选择及文件控件

这里包括没有显式点击处理器、通过 v-model 或 change 完成动作的控件，不重复计算为业务功能数。

| 代码位置 | 控件类型 | 标签摘要 / model | 对应样式 |
| --- | --- | --- | --- |
| [src/App.vue:1314](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1314) | checkbox | reviewRandom | Checkbox（单项/多选/全选） |
| [src/components/ActionMenu.vue:55](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ActionMenu.vue:55) | DropdownMenuTrigger | label | 参见模块表 |
| [src/components/AnswerPanel.vue:365](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AnswerPanel.vue:365) | file | input | Upload 或原生文件选择器，保留现有处理管线 |
| [src/components/AppSidebar.vue:544](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:544) | checkbox | newSourceGlobal | Checkbox（单项/多选/全选） |
| [src/components/ConfirmPopover.vue:19](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ConfirmPopover.vue:19) | PopoverTrigger | label | 此处为标签多选；对应 Select multiple / tags |
| [src/components/ImageTextModal.vue:197](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ImageTextModal.vue:197) | checkbox | keepImage | Checkbox（单项/多选/全选） |
| [src/components/KnowledgeLibraryDialog.vue:191](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:191) | file | 导入 Markdown 或 PDF 学习资料 | Upload 或原生文件选择器，保留现有处理管线 |
| [src/components/KnowledgeLibraryDialog.vue:317](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:317) | checkbox | showArchived | Checkbox（单项/多选/全选） |
| [src/components/KnowledgeLibraryDialog.vue:334](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:334) | checkbox | &#96;选择 ${item.name}&#96; | Checkbox（单项/多选/全选） |
| [src/components/MetadataSelect.vue:85](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/MetadataSelect.vue:85) | SelectTrigger | label | Select 触发器 |
| [src/components/MetadataSelect.vue:116](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/MetadataSelect.vue:116) | SelectItem | {{placeholder \|\| '未设置'}} ✓ | Select 选项 |
| [src/components/MetadataSelect.vue:125](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/MetadataSelect.vue:125) | SelectItem | {{item.label}} | Select 选项 |
| [src/components/NoteEditor.vue:1063](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1063) | file | input | Upload 或原生文件选择器，保留现有处理管线 |
| [src/components/NoteEditor.vue:1172](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:1172) | file | input | Upload 或原生文件选择器，保留现有处理管线 |
| [src/components/PdfImportDialog.vue:274](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:274) | checkbox | allSelected | Checkbox（单项/多选/全选） |
| [src/components/PdfImportDialog.vue:293](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:293) | checkbox | selected | Checkbox（单项/多选/全选） |
| [src/components/PdfImportDialog.vue:646](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:646) | file | 选择 PDF 文件 | Upload 或原生文件选择器，保留现有处理管线 |
| [src/components/PdfImportDialog.vue:665](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:665) | checkbox | reviewed | Checkbox（单项/多选/全选） |
| [src/components/SubjectChips.vue:169](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SubjectChips.vue:169) | checkbox | newSubjectGlobal | Checkbox（单项/多选/全选） |
| [src/components/TagDots.vue:168](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagDots.vue:168) | checkbox | newTagGlobal | Checkbox（单项/多选/全选） |
| [src/components/TagMultiSelect.vue:126](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/TagMultiSelect.vue:126) | PopoverTrigger | 标签... {{modelValue[0]}} 标签 ( {{modelValue.length}} ) | 此处为标签多选；对应 Select multiple / tags |
| [src/components/Workspace.vue:720](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/Workspace.vue:720) | range | activeTool === 'pen' ? '画笔粗细' : '橡皮大小' | Slider |
| [src/plugins/PluginManager.vue:169](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/PluginManager.vue:169) | radio | deleteData | Radio.Group |
| [src/plugins/PluginManager.vue:183](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/PluginManager.vue:183) | radio | deleteData | Radio.Group |

## D. 共享选择器实例补充

父组件的选择器实例通常通过 update:model-value/v-model 交互，没有单独声明 @click。实例与共享组件内部事件会重叠。

| 代码位置 | 实例 | 标签 / 字段 | 对应样式 |
| --- | --- | --- | --- |
| [src/App.vue:1224](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/App.vue:1224) | RadioGroupRoot | reviewScope | Radio.Group 单选 |
| [src/components/AppSidebar.vue:861](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:861) | MetadataSelect | sortKey | Select 单选 |
| [src/components/AppSidebar.vue:1010](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AppSidebar.vue:1010) | TagMultiSelect | batchSelectedTags | Select 多选 + 可移除 Tag |
| [src/components/AuthScreen.vue:121](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/AuthScreen.vue:121) | SegmentedControl | mode | Segmented 互斥模式选择 |
| [src/components/KnowledgeLibraryDialog.vue:174](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/KnowledgeLibraryDialog.vue:174) | SegmentedControl | tab | Segmented 互斥模式选择 |
| [src/components/NotebookIngestPanel.vue:79](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookIngestPanel.vue:79) | MetadataSelect | kbId | Select 单选 |
| [src/components/NotebookIngestPanel.vue:95](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NotebookIngestPanel.vue:95) | MetadataSelect | notebookId | Select 单选 |
| [src/components/NoteEditor.vue:819](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:819) | MetadataSelect | entry.subject | Select 单选 |
| [src/components/NoteEditor.vue:831](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:831) | MetadataSelect | entry.source | Select 单选 |
| [src/components/NoteEditor.vue:843](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/NoteEditor.vue:843) | TagMultiSelect | entry.tags | Select 多选 + 可移除 Tag |
| [src/components/PdfImportDialog.vue:396](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:396) | MetadataSelect | activeQuestion.kind | Select 单选 |
| [src/components/PdfImportDialog.vue:411](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/PdfImportDialog.vue:411) | MetadataSelect | activeQuestion.group_key \|\| '' | Select 单选 |
| [src/components/ReviewPanel.vue:460](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/ReviewPanel.vue:460) | RadioGroupRoot | selectedChoice ?? undefined | Radio.Group 单选 |
| [src/components/RichTextSizeControls.vue:211](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/RichTextSizeControls.vue:211) | MetadataSelect | imageWidth | Select 单选 |
| [src/components/SegmentedControl.vue:18](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SegmentedControl.vue:18) | RadioGroupRoot | modelValue | Radio.Group 单选 |
| [src/components/SettingsPanel.vue:161](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SettingsPanel.vue:161) | MetadataSelect | preferences.fontSize | Select 单选 |
| [src/components/SettingsPanel.vue:177](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/SettingsPanel.vue:177) | MetadataSelect | preferences.defaultNotebookId | Select 单选 |
| [src/components/StatsPanel.vue:321](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/components/StatsPanel.vue:321) | SegmentedControl | historyScope | Segmented 互斥模式选择 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:1946](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:1946) | MetadataSelect | mappings[String(model.id)][target] | Select 单选 |
| [src/plugins/english-vocabulary/VocabularyPanel.vue:2002](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/plugins/english-vocabulary/VocabularyPanel.vue:2002) | MetadataSelect | textImportTargetId | Select 单选 |

## E. 模板之外的点击委托与辅助交互

| 代码位置 | 动作 | 对应建议 |
| --- | --- | --- |
| [src/composables/useRichTextSizing.ts:288](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/composables/useRichTextSizing.ts:288) | 富文本点击图片、内部题目链接 | 图片点击选中后显示尺寸工具；内部链接保留跳题语义，外围链接选择用 Modal |
| [src/composables/useMathPreview.ts:69](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/composables/useMathPreview.ts:69) | 点击公式切回原始公式选区 | 保留 KaTeX/富文本专用实现，不用普通 Ant 输入框替换整个编辑器 |
| [src/composables/useDrawing.ts:295](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/composables/useDrawing.ts:295) | Canvas 鼠标落笔、移动、结束及触摸绘图 | 保留 Canvas，工具栏对应 Segmented/ColorPicker/Slider/Button |
| [src/utils/buttonMotion.ts:29](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/utils/buttonMotion.ts:29) | 统一 pointerdown/up 和键盘按压动效 | 属于反馈增强，不新增业务动作；主按钮、文本按钮、选择项仍需不同视觉层级 |
| [src/utils/menuMotion.ts:43](G:/01_Dev_Projects/Vibe_Coding/notes-app-clean/src/utils/menuMotion.ts:43) | 菜单条目焦点/失焦等动效 | 保留可见焦点，动效不能代替菜单键盘行为 |

## 核查记录

生成附录时逐项检查了 401 条模板事件的文件和行号；共享选择器实例补充 20 处。已完成上文列出的死代码清理，并通过类型检查、修改文件的 ESLint、生产构建和工作区回归测试。代码行号对应本次工作区快照，后续编辑后可能移动。
