import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5441,
    strictPort: true,
    allowedHosts: [
      '.trycloudflare.com',
      '.omestreafiliado.com.br',
    ],
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:5442',
        changeOrigin: true,
      },
    },
  },
});
