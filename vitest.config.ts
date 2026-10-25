import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: {
    '@': fileURLToPath(new URL('./src', import.meta.url)),
    'server-only': fileURLToPath(new URL('./src/server/__tests__/server-only.ts', import.meta.url)),
  } },
  test: { environment: 'node', include: ['src/components/**/__tests__/**/*.test.ts', 'src/engine/__tests__/**/*.test.ts', 'src/server/__tests__/**/*.test.ts'] },
});
