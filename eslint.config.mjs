// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import eslintConfigPrettier from 'eslint-config-prettier'

export default withNuxt(
  // Prettier owns formatting; this disables ESLint stylistic rules that
  // would otherwise conflict with it.
  eslintConfigPrettier,
)
