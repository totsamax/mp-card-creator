import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/lines': { target: 'http://localhost:3001' },
    },
  },
  build: { outDir: 'dist' },
})
