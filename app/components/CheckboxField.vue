<script setup lang="ts">
const model = defineModel<boolean>({ required: true })

defineProps<{
  id: string
  name?: string
  disabled?: boolean
}>()
</script>

<template>
  <label class="checkbox-field" :for="id">
    <input :id="id" v-model="model" type="checkbox" :name="name" :disabled="disabled" />
    <span><slot /></span>
  </label>
</template>
