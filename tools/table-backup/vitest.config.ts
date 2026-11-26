import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The Azurite suite creates and deletes tables; give slow container starts some room.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
