import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` + HashRouter makes the build location-independent, so the same
// artefact works on https://<user>.github.io/<repo>/, a custom domain, or a fork
// with a different repository name — no configuration needed.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
