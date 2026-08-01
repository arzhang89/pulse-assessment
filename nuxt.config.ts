// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  // Phase 1 only needs the ESLint module; auth/UI modules are added
  // alongside the features that need them.
  modules: ['@nuxt/eslint'],

  eslint: {
    config: {
      // Formatting is owned by Prettier; stylistic ESLint rules would
      // otherwise conflict with it.
      stylistic: false,
    },
  },

  typescript: {
    strict: true,
  },

  devtools: { enabled: false },
})
