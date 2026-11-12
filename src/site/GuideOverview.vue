<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { guideGroups, guideSections } from './guide'
import { guideFigures, type GuideScreenshot } from './guideScreenshots'
import GuideImage from './GuideImage.vue'

const emit = defineEmits<{ choose: [id: string]; zoom: [shot: GuideScreenshot] }>()
const journey = ref<HTMLElement | null>(null)
const animated = ref(false)
const activeIndex = ref(0)

// Overview images show the complete source; chapter illustrations retain their own crops.
const overviewShot = (key: string): GuideScreenshot => ({
  ...guideFigures[key],
  focus: undefined,
  marks: [],
})
const scenes = [
  {
    word: 'CAPTURE',
    title: '记录错题',
    description: '输入题目和答案，或导入图片、试卷。按学科和标签整理错题。',
    target: 'editing',
    action: '查看录入方法',
    links: [
      { id: 'image-text', label: '图片转文字' },
      { id: 'importing', label: '导入试卷' },
    ],
    images: [
      {
        shot: overviewShot('editor'),
        label: '题目编辑区',
        position: 'left-top',
        depth: 0.8,
      },
      {
        shot: overviewShot('importing'),
        label: '试卷导入窗口',
        position: 'right-top',
        depth: 1.3,
      },
      {
        shot: overviewShot('image-text'),
        label: '图片转文字窗口',
        position: 'right-bottom',
        depth: 0.55,
      },
    ],
  },
  {
    word: 'UNDERSTAND',
    title: '理解错因',
    description: '对照正确答案，记录出错原因。遇到不懂的地方，可以向学习助手提问。',
    target: 'assistant',
    action: '查看助手用法',
    links: [
      { id: 'knowledge', label: '导入学习资料' },
      { id: 'classification', label: '分类和筛选' },
    ],
    images: [
      {
        shot: overviewShot('assistant'),
        label: '学习助手对话',
        position: 'left-top',
        depth: 1.15,
      },
      {
        shot: overviewShot('knowledge'),
        label: '知识库管理窗口',
        position: 'right-top',
        depth: 0.65,
      },
      {
        shot: overviewShot('tags'),
        label: '错题分类和标签',
        position: 'right-bottom',
        depth: 1,
      },
    ],
  },
  {
    word: 'REVISIT',
    title: '复习错题',
    description: '选择要复习的题目，填写答案和理由。提交后查看核对结果和复习记录。',
    target: 'reviewing',
    action: '查看复习方法',
    links: [
      { id: 'statistics', label: '查看学习记录' },
      { id: 'vocabulary', label: '单词训练' },
    ],
    images: [
      {
        shot: overviewShot('review-setup'),
        label: '复习设置窗口',
        position: 'left-top',
        depth: 0.7,
      },
      {
        shot: overviewShot('statistics'),
        label: '学习统计面板',
        position: 'right-top',
        depth: 1.25,
      },
      {
        shot: overviewShot('reviewing'),
        label: '复习作答界面',
        position: 'right-bottom',
        depth: 0.85,
      },
    ],
  },
]

let media: MediaQueryList | undefined
let frame = 0
const headerHeight = () =>
  document.querySelector('.site-header')?.getBoundingClientRect().height ?? 82
function update() {
  frame = 0
  if (!journey.value || !animated.value) return
  const bounds = journey.value.getBoundingClientRect()
  const travel = bounds.height - (window.innerHeight - headerHeight())
  const progress = Math.max(0, Math.min(1, (headerHeight() - bounds.top) / Math.max(1, travel)))
  const timeline = progress * 2.6 - 0.3
  activeIndex.value = Math.max(0, Math.min(2, Math.round(timeline)))
  journey.value.querySelectorAll<HTMLElement>('.overview-scene').forEach((scene, index) => {
    const offset = timeline - index
    const fade = Math.max(0, Math.min(1, (Math.abs(offset) - 0.36) / 0.28))
    scene.style.setProperty('--scene-opacity', String(1 - fade * fade * (3 - 2 * fade)))
    scene.style.setProperty(
      '--copy-opacity',
      String(Math.max(0, Math.min(1, (0.49 - Math.abs(offset)) / 0.16))),
    )
    scene.style.setProperty('--scene-offset', String(offset))
    scene.querySelectorAll<HTMLElement>('.overview-image').forEach((image) => {
      const depth = Number(image.style.getPropertyValue('--image-depth'))
      const minShift = 16 - image.offsetTop
      const maxShift = scene.clientHeight - 88 - image.offsetTop - image.offsetHeight
      const shift = Math.max(minShift, Math.min(maxShift, -offset * depth * 140))
      image.style.setProperty('--image-shift', `${shift}px`)
    })
  })
}
function scheduleUpdate() {
  if (!frame) frame = requestAnimationFrame(update)
}
function syncMotion() {
  animated.value = media?.matches ?? false
  scheduleUpdate()
}
function goToScene(index: number) {
  if (!journey.value) return
  const bounds = journey.value.getBoundingClientRect()
  const header = headerHeight()
  const travel = bounds.height - (window.innerHeight - header)
  window.scrollTo({
    top: window.scrollY + bounds.top - header + ((index + 0.3) / 2.6) * travel,
    behavior: 'smooth',
  })
}
onMounted(() => {
  media = window.matchMedia(
    '(min-width: 1001px) and (min-height: 701px) and (prefers-reduced-motion: no-preference)',
  )
  syncMotion()
  media.addEventListener('change', syncMotion)
  window.addEventListener('scroll', scheduleUpdate, { passive: true })
  window.addEventListener('resize', scheduleUpdate)
})
onUnmounted(() => {
  cancelAnimationFrame(frame)
  media?.removeEventListener('change', syncMotion)
  window.removeEventListener('scroll', scheduleUpdate)
  window.removeEventListener('resize', scheduleUpdate)
})
</script>

<template>
  <div class="guide-overview">
    <header class="overview-intro">
      <div>
        <h1 id="overview" tabindex="-1">指南总览</h1>
      </div>
      <a href="#quick-start" @click="emit('choose', 'quick-start')"
        >快速上手 <span aria-hidden="true">↗</span></a
      >
    </header>

    <div ref="journey" class="overview-journey" :class="{ 'is-animated': animated }">
      <div class="overview-stage">
        <section
          v-for="(scene, index) in scenes"
          :key="scene.word"
          class="overview-scene"
          :class="`overview-scene-${index + 1}`"
          :inert="animated && activeIndex !== index"
          :aria-hidden="animated && activeIndex !== index ? true : undefined"
          :aria-labelledby="`overview-scene-title-${index}`"
        >
          <div class="overview-copy">
            <h2 :id="`overview-scene-title-${index}`">{{ scene.title }}</h2>
            <p class="overview-description">{{ scene.description }}</p>
            <a
              class="overview-primary-link"
              :href="`#${scene.target}`"
              @click="emit('choose', scene.target)"
              >{{ scene.action }} <span aria-hidden="true">↗</span></a
            >
            <div class="overview-related">
              <a
                v-for="link in scene.links"
                :key="link.id"
                :href="`#${link.id}`"
                @click="emit('choose', link.id)"
                >{{ link.label }} <span aria-hidden="true">→</span></a
              >
            </div>
          </div>
          <figure
            v-for="image in scene.images"
            :key="image.label"
            class="overview-image"
            :class="`overview-image-${image.position}`"
            :style="{ '--image-depth': image.depth }"
          >
            <button
              type="button"
              :aria-label="`放大截图：${image.label}`"
              @click="emit('zoom', image.shot)"
            >
              <GuideImage :shot="image.shot" />
              <span class="overview-image-zoom" aria-hidden="true">↗</span>
            </button>
          </figure>
        </section>
        <div v-if="animated" class="overview-stage-bottom">
          <nav aria-label="切换指南主题">
            <button
              v-for="(scene, index) in scenes"
              :key="scene.word"
              type="button"
              :aria-current="activeIndex === index ? 'step' : undefined"
              @click="goToScene(index)"
            >
              <span>0{{ index + 1 }}</span
              >{{ scene.title }}
            </button>
          </nav>
        </div>
      </div>
    </div>

    <section class="overview-directory" aria-labelledby="overview-directory-heading">
      <div class="overview-directory-heading">
        <h2 id="overview-directory-heading">全部指南</h2>
      </div>
      <div class="overview-directory-grid">
        <section v-for="group in guideGroups" :key="group.id">
          <h3>{{ group.title }}</h3>
          <a
            v-for="chapter in guideSections.filter(
              (item) => item.group === group.id && item.id !== 'overview',
            )"
            :key="chapter.id"
            :href="`#${chapter.id}`"
            @click="emit('choose', chapter.id)"
            >{{ chapter.title }} <span aria-hidden="true">↗</span></a
          >
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.guide-overview {
  color: #393b32;
}
.overview-intro {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  padding: 4px 0 28px;
  border-bottom: 1px solid #e4e0d6;
}
.overview-intro h1 {
  margin: 0;
  font-size: clamp(24px, 2.4vw, 36px);
  font-weight: 500;
  letter-spacing: -1.5px;
  line-height: 1.5;
  scroll-margin-top: 140px;
  outline: none;
}
.overview-intro > a {
  flex-shrink: 0;
  padding-bottom: 7px;
  font-size: 12px;
  color: #9f5138;
}
.overview-intro > a span {
  margin-left: 12px;
}
.overview-journey {
  position: relative;
}
.overview-stage {
  position: relative;
}
.overview-scene {
  position: relative;
  min-height: 750px;
  isolation: isolate;
}
.overview-copy {
  position: absolute;
  z-index: 2;
  top: 31%;
  left: 32%;
  width: 36%;
}
.overview-copy h2 {
  margin: 0;
  font-size: clamp(38px, 4.2vw, 66px);
  font-weight: 500;
  line-height: 1.25;
  letter-spacing: -3px;
}
.overview-description {
  max-width: 330px;
  margin: 24px 0;
  color: #7b776d;
  font-size: 14px;
  line-height: 2;
}
.overview-primary-link {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 38px;
  padding: 13px 19px;
  background: #eddfd0;
  color: #834a35;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: 2px;
  transition: background 0.2s;
}
.overview-primary-link:hover {
  background: #e4ceb9;
}
.overview-related {
  display: flex;
  gap: 22px;
  margin-top: 22px;
  flex-wrap: wrap;
}
.overview-related a {
  color: #898276;
  font-size: 10px;
}
.overview-related a:hover {
  color: #a24e34;
}
.overview-related span {
  margin-left: 7px;
}
.overview-image {
  position: absolute;
  margin: 0;
  z-index: 1;
}
.overview-image button {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid #dfd9cc;
  border-radius: 4px;
  background: #f0ede4;
  box-shadow: 0 8px 28px #574a3510;
  cursor: zoom-in;
}
.overview-image :deep(.docs-guide-image) {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 0;
}
.overview-image-zoom {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: #795641;
  background: #faf9f5e8;
  opacity: 0;
  transition: opacity 0.2s;
}
.overview-image button:is(:hover, :focus-visible) .overview-image-zoom {
  opacity: 1;
}
.overview-image-left-top {
  top: 19%;
  left: 0;
  width: 27%;
}
.overview-image-right-top {
  top: 4%;
  right: 2%;
  width: 22%;
}
.overview-image-right-bottom {
  top: 73%;
  right: 2%;
  width: 36%;
}
.overview-scene-2 .overview-image-left-top {
  top: 11%;
  width: 27%;
}
.overview-scene-2 .overview-image-right-top {
  width: 20%;
}
.overview-scene-2 .overview-image-right-bottom {
  width: 29%;
}
.overview-scene-3 .overview-image-left-top {
  top: 13%;
  width: 26%;
}
.overview-scene-3 .overview-image-right-top {
  width: 21%;
}
.overview-scene-3 .overview-image-right-bottom {
  top: 68%;
  width: 31%;
}
.is-animated {
  height: 340svh;
}
.is-animated .overview-stage {
  position: sticky;
  top: 82px;
  height: calc(100svh - 82px);
  min-height: 560px;
  overflow: clip;
}
.is-animated .overview-scene {
  position: absolute;
  inset: 0;
  min-height: 0;
  opacity: var(--scene-opacity, 0);
  pointer-events: none;
}
.is-animated .overview-scene:not([inert]) {
  pointer-events: auto;
}
.is-animated .overview-copy {
  opacity: var(--copy-opacity, 1);
  transform: translateY(calc(var(--scene-offset, 0) * -65px));
}
.is-animated .overview-image {
  max-width: 34svh;
  transform: translateY(var(--image-shift, 0px));
}
.is-animated .overview-image-right-bottom {
  top: auto;
  bottom: 96px;
  width: 26%;
}
.is-animated .overview-scene-2 .overview-image-right-bottom {
  top: auto;
  width: 26%;
}
.overview-stage-bottom {
  position: absolute;
  z-index: 3;
  left: 0;
  right: 0;
  bottom: 26px;
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 16px;
}
.overview-stage-bottom nav {
  display: flex;
  gap: 25px;
}
.overview-stage-bottom button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  background: none;
  border: 0;
  border-top: 1px solid #dcd6ca;
  color: #a29a8c;
  font-family: 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif;
  font-size: 10px;
  font-weight: 400;
  cursor: pointer;
}
.overview-stage-bottom button[aria-current] {
  color: #9f5138;
  border-top-color: #a85a40;
}
.overview-stage-bottom button > span {
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.overview-directory {
  padding: 65px 0 20px;
  border-top: 1px solid #e0dbce;
}
.overview-directory-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 42px;
}
.overview-directory-heading h2 {
  margin: 0;
  font-size: 28px;
  font-weight: 500;
  letter-spacing: -1px;
}
.overview-directory-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 28px;
}
.overview-directory-grid h3 {
  margin: 14px 0 20px;
  font-size: 16px;
  font-weight: 500;
}
.overview-directory-grid a {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid #e7e2d8;
  font-size: 12px;
  line-height: 1.8;
  color: #7a7569;
}
.overview-directory-grid a:hover {
  color: #a24e34;
}
.overview-directory-grid a > span {
  color: #a89b8a;
}
@media (max-width: 1000px), (max-height: 700px), (prefers-reduced-motion: reduce) {
  .overview-scene {
    min-height: 0;
    padding: 50px 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 25px;
    border-bottom: 1px solid #e4e0d6;
  }
  .overview-copy {
    position: static;
    grid-column: 1 / -1;
    width: 100%;
  }
  .overview-copy h2 {
    font-size: 44px;
  }
  .overview-description {
    max-width: 430px;
    margin-block: 20px;
  }
  .overview-image {
    position: static;
    align-self: start;
    width: 100% !important;
  }
  .overview-image-right-top {
    grid-column: 2;
    grid-row: 2 / span 2;
  }
  .overview-image-right-bottom {
    grid-column: 1;
  }
  .overview-directory {
    border-top: 0;
  }
  .overview-directory-grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 760px) {
  .overview-intro {
    align-items: start;
    flex-direction: column;
    gap: 16px;
  }
  .overview-intro h1 {
    font-size: 28px;
  }
  .overview-copy h2 {
    font-size: 42px;
  }
  .overview-scene {
    gap: 22px 14px;
    padding-block: 45px;
  }
  .overview-directory {
    padding-top: 42px;
  }
  .overview-directory-heading {
    align-items: start;
    flex-direction: column;
    gap: 12px;
  }
  .overview-directory-heading h2 {
    font-size: 25px;
  }
  .overview-directory-grid {
    gap: 28px 20px;
  }
}
</style>
