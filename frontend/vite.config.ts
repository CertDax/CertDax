import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  css: { devSourcemap: false },
  build: { sourcemap: false },
  optimizeDeps: {
    // Suppress "No sources are declared in this source map" warnings
    esbuildOptions: { sourcemap: false },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        headers: {
          'X-Forwarded-Proto': 'http',
        },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.host) {
              proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
            }
          });
        },
      },
    },
  },
});
