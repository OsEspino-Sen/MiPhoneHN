import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'client'),
  envDir: resolve(__dirname),
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'client/index.html'),
        tienda: resolve(__dirname, 'client/tienda.html'),
        soporte: resolve(__dirname, 'client/soporte.html')
      }
    }
  },
  server: {
    port: 5173,
    strictPort: false,
    open: true
  }
});
