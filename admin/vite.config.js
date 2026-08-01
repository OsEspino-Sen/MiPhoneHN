import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname),
  envDir: resolve(__dirname, '..'),
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html')
      }
    }
  },
  server: {
    port: 5174,
    strictPort: false,
    open: true,
    fs: {
      allow: ['..']
    }
  }
});
