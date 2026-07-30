import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'MiPhone/admin'),
  server: {
    port: 5174,
    strictPort: false,
    open: true,
    fs: {
      allow: ['..']
    }
  }
});
