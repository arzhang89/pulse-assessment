// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  modules: ['@nuxt/eslint'],

  css: ['~/assets/css/main.css'],

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

  // Production images must not ship client/server source maps.
  sourcemap: {
    client: false,
    server: false,
  },

  nitro: {
    sourceMap: false,
  },

  devtools: { enabled: false },
})
