export default defineNuxtRouteMiddleware(async () => {
  // UX boundary only — API routes still enforce authentication.
  try {
    await $fetch('/api/auth/me')
  } catch {
    return navigateTo('/login')
  }
})
