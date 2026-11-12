# PDF 导入接入点

工具栏的「导入 PDF」打开上传对话框，接入点是 `src/services/pdfImport.ts`。
当前保留外部导入适配器接口，不包含 PDF.js、按题号切分或本地题目保存逻辑。

启动时使用 `registerPdfImportHandler` 注册实际导入函数：

```ts
import { registerPdfImportHandler } from '@/services/pdfImport'
import { importQuestionsFromPdf } from '@/services/shopkeeperPdfAdapter'

registerPdfImportHandler(importQuestionsFromPdf)
```

`shopkeeperPdfAdapter` 已实现，`src/main.ts` 在应用挂载前注册。
适配函数接收 `file`、打开对话框时固定的 `notebookId`、`signal`、`onProgress(message)` 和可选 `onDraft(draft)`。
适配器负责上传、身份验证、任务状态、草稿校对和确认保存等实际服务协议。

返回值必须区分：

- `{ status: 'submitted', taskId, message? }`：任务已提交，未宣称题目已保存。
- `{ status: 'completed', importedCount }`：用户确认后的题目已经保存，界面才刷新列表。

文件限制为非空 `.pdf` 文件、不超过 100 MB、最多 300 页。没有注册适配器时显示服务暂不可用，
不回退到旧解析器，也不发送请求到原有完整入库的 `/upload`。

当前协议：

| 方法与路径 | 行为 |
| --- | --- |
| `POST /api/question-imports` | Bearer 登录凭证，multipart `file` 和 `notebook_id`，创建任务 |
| `GET /api/question-imports/{id}` | 返回上传、解析、草稿就绪、失败或已录入状态 |
| `GET /api/question-imports/{id}/draft` | 读取可校对草稿和签名图片链接 |
| `PATCH /api/question-imports/{id}/draft` | 提交 `expected_revision`、完整题目编辑字段和材料编辑字段，版本递增 |
| `POST /api/question-imports/{id}/confirm` | 提交 `expected_revision`、所选 `question_keys`、`reviewed: true`，事务录入并返回稳定结果 |

错题后端调用解析服务 `POST /question-import/parse`，传递文件和登录凭证；解析服务输出 `pdf-question-draft-v1`，不写题目数据库。前端必须等确认接口返回 `completed` 才显示保存成功。网络回执丢失时保留任务并可重试；已完成的任务跳过草稿修改，重复确认返回同一批题目。

相关实现：`src/services/shopkeeperPdfAdapter.ts`、`src/composables/usePdfImport.ts`、`src/components/PdfImportDialog.vue`、`src/db_sql/routers/pdf_question_imports.py` 和 `src/db_sql/pdf_question_import.py`。后端无需新增 SQL 表；草稿、原文件、图片和提交意图位于 `.data/pdf-imports`，需与数据库一起保留。详情见 [导入策略](./pdf-question-import-strategy.md)。
