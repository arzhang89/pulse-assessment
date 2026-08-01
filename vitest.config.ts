import { defineConfig } from 'vitest/config'

// Plain Vitest config (no @nuxt/test-utils): Phase 1 only tests the
// framework-agnostic environment parser in shared/env.ts. This should be
// revisited if/when tests need Nuxt's runtime (composables, Nitro
// handlers, etc.).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
