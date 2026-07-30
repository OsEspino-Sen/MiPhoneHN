import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'MiPhone'),
  server: {
    port: 5173,
    strictPort: false,
    open: true
  }
});
