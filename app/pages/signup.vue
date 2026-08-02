<script setup lang="ts">
const email = ref('')
const password = ref('')
const errorMessage = ref('')
const pending = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  pending.value = true
  try {
    await $fetch('/api/auth/signup', {
      method: 'POST',
      body: {
        email: email.value,
        password: password.value,
      },
    })
    await navigateTo('/dashboard')
  } catch (error: unknown) {
    const data = (error as { data?: { error?: { message?: string } } })?.data
    errorMessage.value = data?.error?.message ?? 'Unable to sign up'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="auth-shell">
    <section class="panel stack-sm" aria-labelledby="signup-title">
      <div>
        <p class="page-kicker">Get started</p>
        <h1 id="signup-title">Pulse</h1>
        <p class="muted">Create an account to manage uptime monitors.</p>
      </div>

      <form class="stack-sm" @submit.prevent="onSubmit">
        <label class="field" for="signup-email">
          <span class="field-label">Email</span>
          <input
            id="signup-email"
            v-model="email"
            type="email"
            name="email"
            autocomplete="email"
            required
          />
        </label>
        <label class="field" for="signup-password">
          <span class="field-label">Password</span>
          <input
            id="signup-password"
            v-model="password"
            type="password"
            name="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            required
          />
          <p class="field-hint">At least 8 characters.</p>
        </label>
        <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
        <button type="submit" :disabled="pending">
          {{ pending ? 'Creating account…' : 'Sign up' }}
        </button>
      </form>

      <p class="muted" style="margin: 0">
        Already have an account?
        <NuxtLink to="/login">Log in</NuxtLink>
      </p>
    </section>
  </div>
</template>
