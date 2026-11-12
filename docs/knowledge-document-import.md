# 学习资料文件导入

知识库「导入学习资料」支持 UTF-8 Markdown（每个文件不超过 5 MB）和 PDF（每个文件不超过 100 MB、最多 300 页）。每个成功导入的文件创建一个资料知识库，解析失败时不会创建空知识库。

PDF 需登录，通过 `POST /api/knowledge/documents/import` 调用 RAG 的 `POST /document-import/parse`。MinerU 保留全文、表格、公式及原始图片，不执行错题拆分或题目录入。解析过程沿用本地 MinerU 配置和解析超时限制。

知识库正文沿用现有按账号隔离的浏览器本地存储；PDF 图片持久化在业务后端 `.data/knowledge-documents/`，正文引用带签名的图片链接。可用 `KNOWLEDGE_IMPORT_STORAGE_DIR` 指定图片目录，`PUBLIC_NOTES_API_URL` 指定对外图片服务地址。部署需保留该目录及后端签名密钥。浏览器空间不足、解析超时或超出文件/页数限制时会显示失败原因。

离线验证：

```powershell
node --test tests/knowledge-document-import.cjs tests/pdf-import-interface.cjs
.\.venv\Scripts\python.exe -m unittest discover -s tests/backend -p test_knowledge_documents.py -v
```
