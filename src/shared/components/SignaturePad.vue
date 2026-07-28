<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ modelValue: string; height?: number }>(), { height: 260 })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const canvas = ref<HTMLCanvasElement>()
let drawing = false
let context: CanvasRenderingContext2D | null = null
let resizeObserver: ResizeObserver | null = null

const renderValue = (): void => {
  if (!context || !canvas.value) return
  context.clearRect(0, 0, canvas.value.width, canvas.value.height)
  if (!props.modelValue) return
  const image = new Image()
  image.onload = () => context?.drawImage(image, 0, 0, canvas.value!.width, canvas.value!.height)
  image.src = props.modelValue
}

const resize = (): void => {
  const element = canvas.value
  if (!element) return
  const ratio = Math.max(window.devicePixelRatio || 1, 1)
  const width = Math.max(Math.round(element.clientWidth * ratio), 1)
  const height = Math.max(Math.round(props.height * ratio), 1)
  if (element.width === width && element.height === height) return
  element.width = width
  element.height = height
  context = element.getContext('2d')
  if (context) {
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = Math.max(2.4 * ratio, 2)
    context.strokeStyle = '#172033'
  }
  renderValue()
}

const point = (event: PointerEvent): [number, number] => {
  const box = canvas.value!.getBoundingClientRect()
  return [
    (event.clientX - box.left) * canvas.value!.width / box.width,
    (event.clientY - box.top) * canvas.value!.height / box.height
  ]
}

const start = (event: PointerEvent): void => {
  if (!context || !canvas.value) return
  drawing = true
  canvas.value.setPointerCapture(event.pointerId)
  const [x, y] = point(event)
  context.beginPath()
  context.moveTo(x, y)
  context.lineTo(x + 0.01, y + 0.01)
  context.stroke()
}

const move = (event: PointerEvent): void => {
  if (!drawing || !context) return
  const [x, y] = point(event)
  context.lineTo(x, y)
  context.stroke()
}

const finish = (): void => {
  if (!drawing || !canvas.value) return
  drawing = false
  emit('update:modelValue', canvas.value.toDataURL('image/png'))
}

const clear = (): void => {
  emit('update:modelValue', '')
  renderValue()
}

watch(() => props.modelValue, renderValue)
watch(canvas, async (element) => {
  resizeObserver?.disconnect()
  if (!element) return
  await nextTick()
  resize()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(element)
}, { immediate: true })

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div class="signature-pad">
    <button class="signature-pad-clear" type="button" :disabled="!modelValue" @click="clear">清除</button>
    <canvas ref="canvas" :style="{ height: `${height}px` }" aria-label="签字区域"
      @pointerdown.prevent="start" @pointermove.prevent="move" @pointerup.prevent="finish"
      @pointercancel.prevent="finish" @pointerleave="finish" />
    <span v-if="!modelValue" class="signature-pad-placeholder">请在此处签字</span>
  </div>
</template>

<style scoped>
.signature-pad { position: relative; min-width: 0; border: 1px solid #dce3ed; border-radius: 4px; overflow: hidden; background: #fff; }
.signature-pad canvas { display: block; width: 100%; touch-action: none; cursor: crosshair; }
.signature-pad-clear { position: absolute; z-index: 2; top: 10px; right: 10px; border: 0; border-radius: 4px; padding: 6px 11px; color: #506078; background: #f1f4f8; cursor: pointer; }
.signature-pad-clear:disabled { opacity: .45; cursor: default; }
.signature-pad-placeholder { position: absolute; left: 50%; top: 50%; pointer-events: none; transform: translate(-50%, -50%); color: #b4bdca; font-size: 14px; }
</style>
