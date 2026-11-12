<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { guideGroups, guideSections } from './guide'
import type { GuideScreenshot } from './guideScreenshots'
import GuideImage from './GuideImage.vue'
import { siteConfig } from './config'
import LandingPage from './LandingPage.vue'
import BrandWordmark from './BrandWordmark.vue'
import GuideOverview from './GuideOverview.vue'
import { localMode } from '@/services/localMode'

const path = window.location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '')
const page =
  path === '' ? 'home' : path === '/docs' ? 'docs' : path === '/download' ? 'download' : 'missing'
const links = [
  { id: 'home', title: '首页', href: '/' },
  { id: 'docs', title: '使用文档', href: '/docs/' },
  { id: 'download', title: '下载', href: '/download/' },
]
const query = ref('')
const selectedId = ref(window.location.hash.slice(1) || guideSections[0].id)
const article = ref<HTMLElement | null>(null)
const imageDialog = ref<HTMLDialogElement | null>(null)
const expandedImage = ref<GuideScreenshot | null>(null)
const activeAnchor = ref('')
const menuExpanded = ref(false)
const activeIndex = computed(() =>
  Math.max(
    0,
    guideSections.findIndex((item) => item.id === selectedId.value),
  ),
)
const activeSection = computed(() => guideSections[activeIndex.value])
const activeGroup = computed(
  () => guideGroups.find((group) => group.id === activeSection.value.group)!,
)
const groupedSections = computed(() =>
  guideGroups.map((group) => ({
    ...group,
    sections: guideSections.filter(
      (section) => section.group === group.id && section.id !== 'overview',
    ),
  })),
)
const results = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return guideSections.filter((item) =>
    terms.every((term) => `${item.title} ${item.text}`.toLocaleLowerCase().includes(term)),
  )
})
const searching = computed(() => !!query.value.trim())
const showingOverview = computed(() => !searching.value && activeSection.value.id === 'overview')

function updateHash() {
  if (window.location.hash === '#main-content') return
  const hash = window.location.hash.slice(1)
  const section = guideSections.find(
    (item) => item.id === hash || item.toc.some((heading) => heading.id === hash),
  )
  selectedId.value = section?.id || guideSections[0].id
  activeAnchor.value = section?.toc.some((heading) => heading.id === hash) ? hash : ''
  query.value = ''
  document.title = `${activeSection.value.title} · 使用文档 · ${siteConfig.name}`
  if (activeAnchor.value || hash === 'overview')
    void nextTick(() =>
      document.getElementById(activeAnchor.value || 'overview')?.scrollIntoView({ block: 'start' }),
    )
}

async function chooseSection(id: string) {
  selectedId.value = id
  menuExpanded.value = false
  activeAnchor.value = ''
  query.value = ''
  document.title = `${activeSection.value.title} · 使用文档 · ${siteConfig.name}`
  await nextTick()
  const target = article.value ?? document.getElementById('overview')
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ block: 'start' })
}

async function zoomImage(shot: GuideScreenshot) {
  expandedImage.value = shot
  await nextTick()
  imageDialog.value?.showModal()
}

function closeImage() {
  imageDialog.value?.close()
  expandedImage.value = null
}

function excerpt(text: string) {
  const term = query.value.trim().split(/\s+/)[0].toLocaleLowerCase()
  const index = Math.max(0, text.toLocaleLowerCase().indexOf(term) - 24)
  return `${index > 0 ? '…' : ''}${text.slice(index, index + 110)}…`
}

onMounted(() => {
  if (page === 'docs') {
    window.addEventListener('hashchange', updateHash)
    updateHash()
  }
})
onUnmounted(() => window.removeEventListener('hashchange', updateHash))
</script>

<template>
  <div
    class="official-site"
    :class="{ 'official-site-home': page === 'home', 'official-site-docs': page === 'docs' }"
  >
    <a class="site-skip" href="#main-content">跳到正文</a>
    <header v-if="page !== 'home'" class="site-header">
      <div class="site-wrap site-header-inner">
        <a class="site-brand" href="/" :aria-label="`${siteConfig.name}官网首页`">
          <BrandWordmark />
        </a>
        <nav class="site-nav" aria-label="官网导航">
          <a
            v-for="link in links"
            :key="link.id"
            :href="link.href"
            :aria-current="page === link.id ? 'page' : undefined"
            >{{ link.title }}</a
          >
        </nav>
        <a class="site-button site-button-small site-button-dark" href="/app/"
          >进入网页版 <span aria-hidden="true">↗</span></a
        >
      </div>
    </header>

    <LandingPage v-if="page === 'home'" />

    <main
      v-else-if="page === 'docs'"
      id="main-content"
      class="site-wrap site-docs"
      :class="{ 'site-docs-overview': showingOverview }"
    >
      <aside class="site-docs-sidebar" aria-label="文档目录">
        <a class="docs-sidebar-title" href="#overview" @click="chooseSection('overview')"
          >使用指南 <span>↗</span></a
        >
        <p class="docs-sidebar-description">查阅功能说明与操作步骤。</p>
        <label class="site-search"
          ><svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4 4" /></svg
          ><input
            v-model="query"
            type="search"
            aria-label="搜索使用文档"
            placeholder="搜索文档内容…"
        /></label>
        <button
          type="button"
          class="docs-menu-toggle"
          :aria-expanded="menuExpanded"
          aria-controls="docs-chapter-nav"
          @click="menuExpanded = !menuExpanded"
        >
          全部章节 · {{ guideSections.length - 1 }} 篇<span>{{
            menuExpanded ? '收起 −' : '展开 +'
          }}</span>
        </button>
        <nav id="docs-chapter-nav" aria-label="使用文档章节" :class="{ 'is-open': menuExpanded }">
          <a
            class="docs-overview-link"
            href="#overview"
            :aria-current="!searching && activeSection.id === 'overview' ? 'page' : undefined"
            @click="chooseSection('overview')"
            >指南总览 <span aria-hidden="true">⌘</span></a
          >
          <div v-for="group in groupedSections" :key="group.id" class="docs-nav-group">
            <p>{{ group.title }}</p>
            <a
              v-for="section in group.sections"
              :key="section.id"
              :href="`#${section.id}`"
              :aria-current="!searching && activeSection.id === section.id ? 'page' : undefined"
              @click="chooseSection(section.id)"
              >{{ section.title }}<span aria-hidden="true">↗</span></a
            >
          </div>
        </nav>
        <a class="site-docs-back" href="/app/">打开我的错题本 <span aria-hidden="true">↗</span></a>
      </aside>
      <div class="site-docs-main">
        <template v-if="searching"
          ><div class="site-docs-breadcrumb">使用文档 / 搜索结果</div>
          <h1 class="site-docs-title">查找“{{ query.trim() }}”</h1>
          <p class="site-search-count" role="status">找到 {{ results.length }} 个相关章节</p>
          <div v-if="results.length" class="site-search-results">
            <a
              v-for="result in results"
              :key="result.id"
              :href="`#${result.id}`"
              @click="chooseSection(result.id)"
              ><h2>{{ result.title }} <span aria-hidden="true">→</span></h2>
              <p>{{ excerpt(result.text) }}</p></a
            >
          </div>
          <div v-else class="site-search-empty">
            <h2>未找到相关内容</h2>
            <p>可搜索“导入”“保存”“复习”或“备份”。</p>
            <button class="site-button site-button-outline" @click="query = ''">返回文档</button>
          </div></template
        >
        <GuideOverview v-else-if="showingOverview" @choose="chooseSection" @zoom="zoomImage" />
        <article
          v-else
          ref="article"
          class="site-guide-article"
          tabindex="-1"
          :aria-labelledby="activeSection.id"
        >
          <div class="site-docs-breadcrumb">
            <a href="#overview" @click="chooseSection('overview')">使用文档</a><span>/</span
            >{{ activeGroup.title }}
          </div>
          <div class="docs-chapter-meta">
            <span>{{ activeSection.id === 'overview' ? '使用指南' : activeGroup.title }}</span
            ><span>{{
              activeSection.id === 'overview'
                ? `${guideSections.length - 1} 篇操作指南`
                : activeSection.time.includes('分钟')
                  ? `阅读约 ${activeSection.time}`
                  : activeSection.time
            }}</span>
          </div>
          <h1 :id="activeSection.id" class="site-docs-title">{{ activeSection.title }}</h1>
          <p class="docs-chapter-description">{{ activeSection.description }}</p>
          <div class="docs-entry-point">
            <span>操作入口</span>
            <p>{{ activeSection.entry }}</p>
          </div>
          <div class="docs-article-body">
            <template
              v-for="(block, index) in activeSection.blocks"
              :key="`${activeSection.id}-${index}`"
            >
              <div v-if="block.type === 'html'" class="site-guide-content" v-html="block.html" />
              <figure v-else class="docs-screenshot">
                <div class="docs-screenshot-bar">
                  <span class="docs-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                  <span>{{ block.figure.focus ? '操作局部图' : 'ReNote · 网页版' }}</span>
                  <button
                    type="button"
                    :aria-label="`放大截图：${block.figure.alt}`"
                    @click="zoomImage(block.figure)"
                  >
                    查看大图 ↗
                  </button>
                </div>
                <button
                  type="button"
                  class="docs-screenshot-image"
                  :aria-label="`放大截图：${block.figure.caption}`"
                  @click="zoomImage(block.figure)"
                >
                  <GuideImage :shot="block.figure" />
                </button>
                <figcaption>{{ block.figure.caption }}</figcaption>
                <ol
                  v-if="block.figure.marks?.length"
                  class="docs-figure-key"
                  aria-label="截图标记说明"
                >
                  <li v-for="(mark, markIndex) in block.figure.marks" :key="markIndex">
                    <span>{{ markIndex + 1 }}</span
                    >{{ mark.label }}
                  </li>
                </ol>
              </figure>
            </template>
          </div>
          <div class="docs-chapter-end">
            <span aria-hidden="true">✓</span>
            <p>完成本节操作后，可返回应用继续使用。</p>
            <a href="/app/">打开网页版 ↗</a>
          </div>
          <nav class="site-docs-pagination" aria-label="相邻章节">
            <a
              v-if="activeIndex > 0"
              :href="`#${guideSections[activeIndex - 1].id}`"
              @click="chooseSection(guideSections[activeIndex - 1].id)"
              ><span>← 上一篇</span><strong>{{ guideSections[activeIndex - 1].title }}</strong></a
            ><a
              v-if="activeIndex < guideSections.length - 1"
              :href="`#${guideSections[activeIndex + 1].id}`"
              @click="chooseSection(guideSections[activeIndex + 1].id)"
              ><span>下一篇 →</span><strong>{{ guideSections[activeIndex + 1].title }}</strong></a
            >
          </nav>
        </article>
      </div>
      <aside
        v-if="!searching && !showingOverview && activeSection.toc.length"
        class="docs-on-this-page"
        aria-label="本页目录"
      >
        <p>本页内容</p>
        <a
          v-for="heading in activeSection.toc"
          :key="heading.id"
          :href="`#${heading.id}`"
          :class="{ 'is-child': heading.depth > 0 }"
          :aria-current="activeAnchor === heading.id ? 'location' : undefined"
          >{{ heading.title }}</a
        ><span>可对照指南完成应用操作。</span>
      </aside>
    </main>

    <main
      v-else-if="page === 'download'"
      id="main-content"
      class="site-wrap site-download"
      aria-label="下载与安装"
    >
      <div class="site-download-grid">
        <section class="site-download-card" aria-labelledby="windows-heading">
          <svg class="site-windows-icon" viewBox="0 0 44 44" fill="currentColor" aria-hidden="true">
            <path
              d="M4 9 20 7v14H4V9Zm19-2.4L40 4v17H23V6.6ZM4 24h16v14L4 36V24Zm19 0h17v17l-17-2.4V24Z"
            />
          </svg>
          <div class="site-download-card-top">
            <h2 id="windows-heading">Windows 桌面版</h2>
            <span>x64</span>
          </div>
          <p>桌面截图 · 本地保存目录 · 原生文件操作</p>
          <template v-if="siteConfig.windowsInstaller"
            ><span class="site-release-status">v{{ siteConfig.version }} · 安装版</span
            ><a
              class="site-button site-button-accent"
              :href="siteConfig.windowsInstaller"
              data-testid="windows-download"
              >下载 Windows 安装包 <span aria-hidden="true">↓</span></a
            >
            <p class="site-download-hint">下载完成后运行安装程序，按提示选择安装位置。</p></template
          ><template v-else
            ><span class="site-release-status is-pending"
              ><span class="site-status-dot" /> 安装包尚未发布</span
            ><button class="site-button site-button-muted" disabled>Windows 安装包准备中</button>
            <p class="site-download-hint">发布后将在这里提供下载。现在可以先用网页版。</p></template
          ><a
            v-if="siteConfig.windowsPortable"
            class="site-text-link"
            :href="siteConfig.windowsPortable"
            data-testid="portable-download"
            >下载 Windows 便携版 ↓</a
          ><a class="site-text-link" href="/docs/#quick-start">安装后如何开始？阅读使用指南 →</a>
        </section>
        <section class="site-download-web" aria-labelledby="web-heading">
          <span class="site-web-icon" aria-hidden="true">↗</span>
          <p class="site-eyebrow">不想安装？</p>
          <h2 id="web-heading">浏览器里，<br />也可以开始。</h2>
          <p>{{ localMode ? '直接打开网页版即可创建错题本、整理题目、开始复习。数据保存在当前浏览器。' : '直接打开网页版，登录后即可创建错题本、整理题目、开始复习。' }}</p>
          <a class="site-button site-button-outline" href="/app/"
            >进入网页版 <span aria-hidden="true">↗</span></a
          >
        </section>
      </div>
      <section class="site-download-notes">
        <h2>下载前，了解这些</h2>
        <div>
          <article>
            <h3>目前的版本</h3>
            <p>当前下载入口面向 Windows x64。macOS 和 Linux 暂未提供下载，可先使用网页版。</p>
          </article>
          <article>
            <h3>保留你的学习记录</h3>
            <p>
              更换设备或迁移数据前，先导出归档并妥善保存。<a href="/docs/#backup">查看备份步骤 →</a>
            </p>
          </article>
          <article>
            <h3>服务连接</h3>
            <p>
              {{ localMode ? 'PDF 解析和智能判卷等功能需要后端服务。' : '登录、PDF 解析等操作需要连接相应服务。' }}遇到问题，可先查看<a href="/docs/#faq"
                >常见问题</a
              >。
            </p>
          </article>
        </div>
      </section>
    </main>

    <main v-else id="main-content" class="site-wrap site-not-found">
      <p class="site-eyebrow">404</p>
      <h1>这一页还没有记下。</h1>
      <p>回到首页，或从使用文档找到需要的内容。</p>
      <div class="site-actions">
        <a class="site-button site-button-accent" href="/">返回首页</a
        ><a class="site-button site-button-outline" href="/docs/">使用文档</a>
      </div>
    </main>

    <dialog
      ref="imageDialog"
      class="docs-image-dialog"
      aria-label="界面截图大图"
      @cancel.prevent="closeImage"
      @click="
        (event) => {
          if (event.target === imageDialog) closeImage()
        }
      "
    >
      <template v-if="expandedImage"
        ><div>
          <p>{{ expandedImage.caption }}</p>
          <button type="button" autofocus aria-label="关闭截图大图" @click="closeImage">
            关闭 ✕
          </button>
        </div>
        <GuideImage :shot="expandedImage" />
        <ol v-if="expandedImage.marks?.length" class="docs-figure-key" aria-label="截图标记说明">
          <li v-for="(mark, markIndex) in expandedImage.marks" :key="markIndex">
            <span>{{ markIndex + 1 }}</span
            >{{ mark.label }}
          </li>
        </ol>
      </template>
    </dialog>

    <footer v-if="page !== 'home'" class="site-footer">
      <div class="site-wrap">
        <a class="site-footer-brand" href="/" :aria-label="`${siteConfig.name}官网首页`"
          ><BrandWordmark
        /></a>
        <nav aria-label="页脚导航">
          <a href="/app/">网页版 ↗</a><a href="/download/">下载桌面版</a
          ><a href="/docs/">使用文档</a>
        </nav>
      </div>
    </footer>
  </div>
</template>
