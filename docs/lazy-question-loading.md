# 题目按需加载

进入错题本只读取题目概要和题组概要。题干、答案和批注在打开题目时读取；同一题目的并发请求合并，已加载的内容复用。复习读取当前题目并预加载下一题，等待内容期间不计入作答时间。

## 数据路径

- `GET /api/entries/summaries?notebook_id=…`：元数据、标签及最多 240 字符的题目预览。数据库查询不选择完整题干、答案、批注，并批量读取标签。
- `GET /api/entries/{id}?notebook_id=…`：完整单题，校验账号和笔记本归属。
- `GET /api/question-groups/summaries?notebook_id=…`、`GET /api/question-groups/{id}?notebook_id=…`：题组概要和共享材料。
- 概要接口的 `q` 查询搜索完整题干、两个答案、标题、学科、来源、标签和题组材料，只返回匹配题目的概要。

浏览器的账号缓存升级到 IndexedDB v7，新增 `entrySummaries` 和 `questionGroupSummaries`，保留原来的完整内容和快照。首次升级从已有记录建立概要；完整记录与概要在同一事务中写入。服务端概要版本比缓存正文更新时，下一次打开会重新读取正文。

桌面端保持原有笔记本 JSON 格式，另写入 `notebook_summary_<id>.json` 缓存。缓存按原文件的修改时间和大小校验，丢失或过期时重新建立。首次建立索引仍需解析原笔记本文件；单题读取的主进程也仍读取原笔记本 JSON，但跨进程只传递选中的题目。

## 完整性与离线行为

`isSummary` 是列表记录的标记。持久化接口拒绝将概要保存为正文或快照。批量改标签、排序、移动、重命名和导出，先读取所需完整记录；全文内容不会被列表中的空占位字段覆盖。未保存的当前草稿在概要刷新时保留，旧切题请求不能改变当前选中的题目。复习历史展开时才加载该场次的内容。

离线时可打开已缓存的内容。尚未读取的正文需要恢复后台连接，界面提供错误和重试入口。搜索结果不完整时明确提示只搜索了已缓存题目。导出需要读取所有所选正文，任何加载失败都会中止，避免生成内容不完整的文件。

在线字体使用异步样式加载，字体服务不可用时页面仍能显示并操作。

## 验证

```powershell
npm run build
node tests/e2e/test_loading_resilience.cjs
node tests/e2e/test_desktop_account_storage.cjs
.venv/Scripts/python.exe -m unittest discover -s tests/backend -p test_lazy_entries.py -v
.venv/Scripts/python.exe tests/e2e/test_lazy_entries.py
```

浏览器按需加载测试需要开发前端运行在 `http://127.0.0.1:5173/`，使用隔离浏览器缓存和模拟 API，不写入用户数据。覆盖 300 题概要加载、快速切题、全文搜索、离线提示、版本更新、草稿保护、加载失败重试、题组材料、批量保存/导出、切换笔记本、复习预加载，以及字体请求挂起时的页面启动。
