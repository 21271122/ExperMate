import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        app: 'index.html',
        printExperiment: 'src/features/print/experiment.ts',
        printAnalysis: 'src/features/print/analysis.ts',
        printRecord: 'src/features/print/record.tsx',
      },
    },
  },
  server: {
    proxy: {
      '/app/assets': 'http://127.0.0.1:5000',
      '/api': 'http://127.0.0.1:5000',
      '/uploads': 'http://127.0.0.1:5000',
      '/experiments': 'http://127.0.0.1:5000',
      '/settings': 'http://127.0.0.1:5000',
    },
  },
  test: {
    css: { include: [/experiments\.css/] },
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    clearMocks: true,
  },
});
