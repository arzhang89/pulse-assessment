<script setup lang="ts">
const props = defineProps<{
  status: 'UNKNOWN' | 'UP' | 'DOWN'
}>()

const label = computed(() => {
  if (props.status === 'UP') return 'Up'
  if (props.status === 'DOWN') return 'Down'
  return 'Unknown'
})

const className = computed(() => {
  if (props.status === 'UP') return 'badge badge-up'
  if (props.status === 'DOWN') return 'badge badge-down'
  return 'badge badge-unknown'
})
</script>

<template>
  <span :class="className" :aria-label="`Status ${label}`">{{ label }}</span>
</template>
