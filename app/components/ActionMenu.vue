<script setup lang="ts">
const props = defineProps<{
  open: boolean
  label?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const rootRef = ref<HTMLElement | null>(null)
const label = computed(() => props.label ?? 'More')

function setOpen(value: boolean) {
  emit('update:open', value)
}

function toggle() {
  if (props.disabled) return
  setOpen(!props.open)
}

function close() {
  setOpen(false)
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!rootRef.value?.contains(event.target as Node)) {
    close()
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    close()
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (!import.meta.client) return
    if (isOpen) {
      document.addEventListener('pointerdown', onDocumentPointerDown)
      document.addEventListener('keydown', onDocumentKeydown)
    } else {
      document.removeEventListener('pointerdown', onDocumentPointerDown)
      document.removeEventListener('keydown', onDocumentKeydown)
    }
  },
)

onBeforeUnmount(() => {
  if (!import.meta.client) return
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div ref="rootRef" class="action-menu">
    <button
      type="button"
      class="secondary action-menu-trigger"
      :aria-expanded="open"
      aria-haspopup="menu"
      :disabled="disabled"
      @click="toggle"
    >
      {{ label }}
    </button>
    <div v-if="open" class="action-menu-panel" role="menu" :aria-label="label">
      <slot :close="close" />
    </div>
  </div>
</template>
