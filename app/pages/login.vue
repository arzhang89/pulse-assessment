<script setup lang="ts">
const email = ref('')
const password = ref('')
const errorMessage = ref('')
const pending = ref(false)

async function onSubmit() {
  errorMessage.value = ''
  pending.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: {
        email: email.value,
        password: password.value,
      },
    })
    await navigateTo('/dashboard')
  } catch (error: unknown) {
    const data = (error as { data?: { error?: { message?: string } } })?.data
    errorMessage.value = data?.error?.message ?? 'Unable to log in'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="auth-shell">
    <section class="panel stack-sm" aria-labelledby="login-title">
      <div>
        <p class="page-kicker">Welcome back</p>
        <h1 id="login-title">Pulse</h1>
        <p class="muted">Log in to manage your monitors.</p>
      </div>

      <form class="stack-sm" @submit.prevent="onSubmit">
        <label class="field" for="login-email">
          <span class="field-label">Email</span>
          <input
            id="login-email"
            v-model="email"
            type="email"
            name="email"
            autocomplete="email"
            required
          />
        </label>
        <label class="field" for="login-password">
          <span class="field-label">Password</span>
          <input
            id="login-password"
            v-model="password"
            type="password"
            name="password"
            autocomplete="current-password"
            minlength="8"
            maxlength="128"
            required
          />
        </label>
        <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
        <button type="submit" :disabled="pending">
          {{ pending ? 'Logging in…' : 'Log in' }}
        </button>
      </form>

      <p class="muted" style="margin: 0">
        Need an account?
        <NuxtLink to="/signup">Sign up</NuxtLink>
      </p>
    </section>
  </div>
</template>
