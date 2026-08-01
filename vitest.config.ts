import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.integration.test.ts', 'tests/**/*.http.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/**/*.integration.test.ts'],
          environment: 'node',
          fileParallelism: false,
          sequence: { concurrent: false },
          pool: 'forks',
          maxWorkers: 1,
        },
      },
      {
        test: {
          name: 'http',
          include: ['tests/**/*.http.test.ts'],
          environment: 'node',
          fileParallelism: false,
          sequence: { concurrent: false },
          pool: 'forks',
          maxWorkers: 1,
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
})
