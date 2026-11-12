# 官网与网页版入口

当前官网直接集成在现有 Vue/Vite 项目中，不需要新的域名或单独的文档服务。

| 路径 | 用途 | 是否要求登录 |
| --- | --- | --- |
| `/` | 官网首页：产品介绍、网页版、下载和文档入口 | 否 |
| `/app/` | 现有错题本应用 | 是 |
| `/docs/` | 使用文档，支持章节链接和全文搜索 | 否 |
| `/download/` | Windows 安装包和便携版发布入口 | 否 |

## 本地预览与构建

运行 `npm run dev` 后，访问开发服务输出的首页地址。现有一键启动流程也会打开官网，从官网点击“进入网页版”即可进入应用。

`npm run build` 同时生成四个页面，输出分别为 `dist/index.html`、`dist/app/index.html`、`dist/docs/index.html`、`dist/download/index.html`。四个页面共享静态资源，直接访问子页面或刷新时无需单页应用的路径回退规则。

官网单独检查：`npx vue-tsc --noEmit -p src/site/tsconfig.json`。构建完成后运行 `node --test tests/official-site.cjs`，验证静态资源、桌面/PWA 入口、文档章节链接与下载配置。

Electron 启动文件已改为 `dist/app/index.html`，桌面端直接进入原有应用。PWA 的启动地址和作用域也指向 `/app/`，构建会把现有 service worker 输出到 `dist/app/sw.js`。

## 维护文档

编辑 `src/site/content/user-guide.md`。每个二级标题对应一个章节，必须保留一个唯一的英文 ID：

```markdown
## 快速上手 {#quick-start}
```

可以直接分享 `/docs/#quick-start`、`/docs/#importing` 等章节链接。搜索覆盖标题和正文；内容只按文本处理，原始 HTML 不会执行。

文档目前按“开始使用、录入与整理、学习与复习、偏好与数据”组织，含总览和 17 篇操作指南。新增章节时，同时在 `src/site/guide.ts` 配置分组、摘要、阅读时间及操作入口；三级、四级标题自动生成可分享的本页定位链接，页面渲染时按 h1 → h2 → h3 排列。图片编号必须存在，缺失配置时会直接报错，避免出现空图。

实际软件截图保存在 `src/site/assets/guide/`，通过 `src/site/guideScreenshots.ts` 配置替代文字、图片说明、局部范围和编号与空心圈。正文使用独立一行的 `:::figure 图片编号` 将配图放到对应步骤。支持点击放大与 Esc 关闭。现有配图采自已登录的网页版，“设计展示”用于编辑和题组示例，“官方文档 · 学习与成长”用于语言学习示例。文件夹和图片识别配图使用新建的“文档示例”题目。`docs/fixtures/image-text-example.png` 是本次识别所用题图，可重复粘贴演示。截图保持原始应用画面，局部截取和空心标注由 `GuideImage.vue` 以 SVG 显示。更新截图时，请核对原图尺寸与标注位置，避开账号、登录凭证及无关个人信息。

文档和下载页共用 `src/site/BrandWordmark.vue`，沿用首页的新 R 标识 `renote-r-georgia.png`。手机目录支持展开与收起，点击章节后自动收起。

## 接入安装包

在本地 `.env.local` 或构建环境中配置：

```dotenv
VITE_WINDOWS_DOWNLOAD_URL=/releases/Cuotiben-Setup-2.1.13.exe
VITE_WINDOWS_PORTABLE_URL=
```

也支持指向文件托管平台的完整 HTTPS 地址。以上是示例路径，项目不附带安装包。只有发布了真实文件后才应填写，重新构建后生效。留空时，下载页显示“安装包尚未发布”，并引导访问网页版。

不要将 JWT 密钥、后端密码等敏感配置加上 `VITE_` 前缀；该前缀的配置会进入公开页面。

## 之后绑定同一域名

把完整的 `dist/` 部署到该域名的静态网站目录，保留目录结构，让静态服务器对目录请求返回对应的 `index.html`，并支持 `/app` 跳转到 `/app/` 等目录标准行为。

若使用 Nginx，静态路径可以使用：

```nginx
location / {
    try_files $uri $uri/ =404;
}
```

实际的域名、HTTPS、API 反向代理和安装包文件，在正式部署时配置。本次仅完成本地页面，不创建托管站点，也不发布安装包。

**上线前还需处理已有后端地址**：现有应用的多个服务直接访问 `http://localhost:8000`。外部用户访问正式域名时，这会指向他们自己的电脑。部署时应统一改为可配置 API 地址或同域 `/api`，并配置后端代理。官网和文档本身不依赖这些服务。
