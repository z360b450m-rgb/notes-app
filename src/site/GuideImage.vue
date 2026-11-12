<script setup lang="ts">
import { computed, useId } from 'vue'
import type { GuideScreenshot } from './guideScreenshots'

const props = defineProps<{ shot: GuideScreenshot }>()
const clipId = `guide-crop-${useId().replace(/[^a-z0-9-]/gi, '')}`
const frame = computed(
  () =>
    props.shot.focus ?? {
      x: 0,
      y: 0,
      width: props.shot.width ?? 1440,
      height: props.shot.height ?? 1000,
    },
)
</script>

<template>
  <svg
    class="docs-guide-image"
    :viewBox="`${frame.x} ${frame.y} ${frame.width} ${frame.height}`"
    :width="frame.width"
    :height="frame.height"
    :style="{ '--guide-ratio': frame.width / frame.height }"
    role="img"
    :aria-label="shot.alt"
  >
    <title>{{ shot.alt }}</title>
    <defs>
      <clipPath :id="clipId" clipPathUnits="userSpaceOnUse">
        <rect :x="frame.x" :y="frame.y" :width="frame.width" :height="frame.height" />
      </clipPath>
    </defs>
    <image
      :href="shot.src"
      :width="shot.width ?? 1440"
      :height="shot.height ?? 1000"
      :clip-path="`url(#${clipId})`"
    />
    <g v-for="(mark, index) in shot.marks" :key="index" aria-hidden="true">
      <template v-if="mark.box">
        <rect
          :x="mark.toX - mark.box.width / 2"
          :y="mark.toY - mark.box.height / 2"
          :width="mark.box.width"
          :height="mark.box.height"
          rx="7"
          fill="none"
          stroke="white"
          stroke-width="3"
        />
        <rect
          :x="mark.toX - mark.box.width / 2"
          :y="mark.toY - mark.box.height / 2"
          :width="mark.box.width"
          :height="mark.box.height"
          rx="7"
          fill="none"
          stroke="#c84929"
          stroke-width="1.5"
        />
      </template>
      <template v-else>
        <circle :cx="mark.toX" :cy="mark.toY" r="14" fill="none" stroke="white" stroke-width="3" />
        <circle
          :cx="mark.toX"
          :cy="mark.toY"
          r="14"
          fill="none"
          stroke="#c84929"
          stroke-width="1.5"
        />
      </template>
      <circle :cx="mark.x" :cy="mark.y" r="10" fill="#c84929" stroke="white" stroke-width="2" />
      <text
        :x="mark.x"
        :y="mark.y"
        text-anchor="middle"
        dominant-baseline="central"
        fill="white"
        font-family="Arial, Helvetica, sans-serif"
        font-size="10"
        font-weight="700"
      >
        {{ index + 1 }}
      </text>
    </g>
  </svg>
</template>
