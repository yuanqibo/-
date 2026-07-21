<script setup lang="ts">
import { computed } from 'vue'
import { createQrGraphic } from '../composables/qrGraphic'

const props = defineProps<{ text: string }>()
const graphic = computed(() => createQrGraphic(props.text))
</script>

<template>
  <svg class="asset-label-qr" :viewBox="graphic.viewBox" role="img" :aria-label="graphic.label">
    <rect width="100%" height="100%" fill="#fff" />
    <path :d="graphic.path" fill="#000" />
  </svg>
</template>
