<script setup lang="ts">
withDefaults(defineProps<{ softened?: boolean }>(), { softened: false })
</script>

<template>
  <div class="ambient-backdrop" :class="{ 'is-softened': softened }" aria-hidden="true" />
</template>

<style scoped>
.ambient-backdrop {
  position: absolute;
  z-index: -2;
  inset: -8%;
  background:
    radial-gradient(ellipse 35% 58% at 29% 89%, #d977577d 0%, #e9b59a66 36%, transparent 76%),
    radial-gradient(ellipse 31% 49% at 65% 11%, #edc4a6 0%, #f4ddc766 42%, transparent 83%),
    radial-gradient(ellipse 32% 39% at 66% 107%, #e6ac8373 0%, #f2d8bf59 50%, transparent 86%),
    var(--ambient-paper, #eeece5);
  filter: blur(28px);
  transform: rotate(-9deg) scale(1.12);
  pointer-events: none;
}
.ambient-backdrop::after {
  position: absolute;
  content: '';
  inset: 0;
  background:
    radial-gradient(ellipse 26% 62% at 6% 21%, var(--ambient-paper, #eeece5) 16%, transparent 83%),
    radial-gradient(ellipse 30% 52% at 98% 51%, var(--ambient-paper, #eeece5) 20%, transparent 82%),
    radial-gradient(
      ellipse 33% 24% at 40% 45%,
      color-mix(in srgb, var(--ambient-paper, #eeece5) 60%, transparent) 5%,
      transparent 90%
    );
}
@keyframes ambient-drift {
  0% {
    transform: translate3d(-1%, 2%, 0) rotate(-9deg) scale(1.12);
  }
  50% {
    transform: translate3d(3%, -2%, 0) rotate(-5deg) scale(1.18);
  }
  100% {
    transform: translate3d(-2.5%, -4%, 0) rotate(-12deg) scale(1.14);
  }
}
@keyframes ambient-breathe {
  from {
    transform: translate3d(-2%, 0, 0) scale(1.03);
    opacity: 0.85;
  }
  to {
    transform: translate3d(3%, 2%, 0) scale(1.1);
    opacity: 0.48;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .ambient-backdrop {
    animation: ambient-drift 26s ease-in-out -8s infinite alternate;
    will-change: transform;
  }
  .ambient-backdrop::after {
    animation: ambient-breathe 18s ease-in-out -5s infinite alternate;
    will-change: transform, opacity;
  }
}

.ambient-backdrop.is-softened {
  filter: blur(54px);
  opacity: 0.78;
}
@media (max-width: 600px) {
  .ambient-backdrop {
    inset: -5% -50%;
  }
}
</style>
