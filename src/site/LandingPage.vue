<script setup lang="ts">
import AmbientBackdrop from '@/components/AmbientBackdrop.vue'
import renoteInitial from './assets/renote-r-georgia.png'
import { siteConfig } from './config'
</script>

<template>
  <div class="landing-page">
    <AmbientBackdrop />
    <svg class="landing-grain" aria-hidden="true" width="100%" height="100%">
      <filter id="landing-grain-filter">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.78"
          numOctaves="3"
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#landing-grain-filter)" />
    </svg>

    <header class="landing-header">
      <nav aria-label="官网导航">
        <a class="landing-docs" href="/docs/">使用文档 <span aria-hidden="true">↗</span></a>
      </nav>
    </header>

    <main id="main-content" class="landing-main" aria-labelledby="landing-heading">
      <div class="landing-content">
        <h1 id="landing-heading" class="landing-brand" :aria-label="siteConfig.name">
          <span class="landing-wordmark" aria-hidden="true">
            <span class="landing-wordmark-name">
              <img class="landing-wordmark-initial" :src="renoteInitial" alt="" draggable="false" />
              <span>eNote</span>
            </span>
            <span class="landing-wordmark-caption">· 错题集</span>
          </span>
        </h1>
        <p class="landing-description">AI 智能辅助错题管理系统</p>
        <div class="landing-actions">
          <a class="landing-enter" href="/app/">进入网页版 <span aria-hidden="true">↗</span></a>
          <a class="landing-download" href="/download/">下载桌面版</a>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.landing-page {
  --landing-paper: #eeece5;
  position: relative;
  isolation: isolate;
  min-height: calc(100svh - 24px);
  overflow: hidden;
  border-radius: 30px;
  background: var(--landing-paper);
  color: #48392f;
  color-scheme: light;
}
.landing-grain {
  position: absolute;
  z-index: -1;
  inset: 0;
  pointer-events: none;
  opacity: 0.065;
  mix-blend-mode: soft-light;
}
.landing-header {
  position: absolute;
  z-index: 2;
  top: 26px;
  right: 42px;
  display: flex;
  justify-content: flex-end;
}
.landing-brand {
  width: fit-content;
  max-width: 100%;
  margin: 0;
  color: #393832;
  font-weight: 400;
}
.landing-wordmark {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: Georgia, 'Times New Roman', serif;
}
.landing-wordmark-name {
  display: flex;
  align-items: baseline;
  font-size: clamp(84px, 12.5vw, 176px);
  font-weight: 400;
  letter-spacing: -0.035em;
  font-kerning: normal;
  line-height: 0.92;
  white-space: nowrap;
}
.landing-wordmark-initial {
  display: block;
  flex: 0 0 auto;
  width: 0.86em;
  height: 0.86em;
  margin-right: -0.105em;
  object-fit: contain;
  align-self: center;
  transform: translateY(-0.01em);
}
.landing-wordmark-caption {
  margin-top: 24px;
  color: #74675b;
  font-family: 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
  font-size: clamp(20px, 2.4vw, 28px);
  font-weight: 400;
  letter-spacing: 0.16em;
  line-height: 1.4;
}
.landing-docs {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding-block: 8px;
  color: #7b6454;
  font-size: 14px;
  transition: color 180ms;
}
.landing-docs:hover {
  color: #b96040;
}
.landing-docs span {
  font-size: 12px;
  opacity: 0.7;
}
.landing-main {
  display: grid;
  min-height: calc(100svh - 24px);
  place-items: center;
  padding: 120px 35px;
  text-align: center;
}
.landing-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(100%, 900px);
}
.landing-description {
  margin: 34px 0 0;
  color: #87705e;
  font-size: 15px;
  font-weight: 300;
  line-height: 1.9;
  letter-spacing: 0.5px;
}
.landing-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 32px;
  margin-top: 38px;
}
.landing-enter {
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  gap: 22px;
  padding: 12px 28px;
  border: 1px solid #d97757;
  border-radius: 999px;
  background: #fffaf54d;
  color: #ac5435;
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 1px;
  transition:
    background 180ms,
    border-color 180ms;
}
.landing-enter:hover {
  border-color: #b35a3b;
  background: #d9775714;
}
.landing-enter span {
  font-size: 14px;
}
.landing-download {
  padding: 2px 0 5px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #986349;
  font-size: 12px;
  font-weight: 300;
  letter-spacing: 1px;
  text-decoration-line: underline;
  text-decoration-thickness: 1px;
  text-decoration-color: #c892718c;
  text-underline-offset: 6px;
  transition: color 180ms;
}
.landing-download:hover {
  color: #ac5435;
  text-decoration-color: #ac5435;
}
.landing-page :is(a, button):focus-visible {
  outline: 2px solid #c96b49;
  outline-offset: 6px;
}
@media (max-width: 600px) {
  .landing-page {
    min-height: calc(100svh - 16px);
    border-radius: 23px;
  }
  .landing-header {
    top: 19px;
    right: 23px;
  }
  .landing-wordmark-name {
    font-size: clamp(56px, 17vw, 100px);
  }
  .landing-wordmark-caption {
    margin-top: 20px;
    font-size: 20px;
  }
  .landing-docs {
    font-size: 12px;
  }
  .landing-main {
    min-height: calc(100svh - 16px);
    padding: 100px 24px;
  }
  .landing-description {
    margin-top: 28px;
    font-size: 13px;
    letter-spacing: 0;
  }
  .landing-actions {
    margin-top: 32px;
    gap: 26px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .landing-page * {
    transition: none;
  }
}
</style>
