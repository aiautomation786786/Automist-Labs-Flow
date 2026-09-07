import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.{ts,tsx}'],
    timeout: 30000, // 30s per test (Chrome launch can be slow)
    hookTimeout: 20000,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/main/**/*.ts'],
      exclude: ['src/tests/**'],
    },
    // Prevent test parallelism from causing port conflicts
    // Some integration tests use real ports and Chrome
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
