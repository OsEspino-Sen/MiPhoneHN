import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'admin'),
  envDir: resolve(__dirname),
  server: {
    port: 5174,
    strictPort: false,
    open: true,
    fs: {
      allow: ['..']
    }
  }
});
