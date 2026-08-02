<script setup lang="ts">
defineProps<{
  title?: string
}>()
</script>

<template>
  <div class="empty-state">
    <p v-if="title">
      <strong>{{ title }}</strong>
    </p>
    <p class="muted"><slot /></p>
  </div>
</template>
