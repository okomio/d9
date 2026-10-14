import { defineConfig } from 'vitest/config';

// No application extension loader or backend connections in foundation tests.
export default defineConfig({ test: { environment: 'happy-dom', include: ['src/namespaces/**/*.test.ts'] } });
