import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://35.224.177.116:4000',
      '/socket.io': {
        target: 'http://35.224.177.116:4000',
        ws: true,
      },
    },
  },
});
