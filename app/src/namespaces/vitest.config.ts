import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// No application extension loader or backend connections in foundation tests.
export default defineConfig({
	resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
	test: {
		environment: 'happy-dom',
		include: ['src/namespaces/**/*.test.ts'],
		setupFiles: ['src/__setup__/mock-globals.ts'],
	},
});
