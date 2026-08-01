import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'client'),
  envDir: resolve(__dirname),
  server: {
    port: 5173,
    strictPort: false,
    open: true
  }
});
