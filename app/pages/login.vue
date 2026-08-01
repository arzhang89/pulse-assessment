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
    <section class="panel stack" aria-labelledby="login-title">
      <div>
        <h1 id="login-title">Pulse</h1>
        <p>Log in to manage your monitors.</p>
      </div>

      <form class="stack" @submit.prevent="onSubmit">
        <label>
          Email
          <input v-model="email" type="email" name="email" autocomplete="email" required />
        </label>
        <label>
          Password
          <input
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

      <p class="muted">
        Need an account?
        <NuxtLink to="/signup">Sign up</NuxtLink>
      </p>
    </section>
  </div>
</template>
