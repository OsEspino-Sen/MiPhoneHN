import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'admin'),
  envDir: resolve(__dirname),
  base: '/Panel/Administrador/',
  build: {
    outDir: resolve(__dirname, 'client/dist/Panel/Administrador'),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'admin/index.html'),
        login: resolve(__dirname, 'admin/login.html')
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
