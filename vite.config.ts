import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { studioBridgePlugin } from './server/studioBridge';

export default defineConfig({
  plugins: [react(), studioBridgePlugin()],
  base: './',
  server: {
    port: 5174
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});
