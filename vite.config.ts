import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  // GitHub Pages (con el dominio vidriosystem.co) y el contenedor sirven la app en la
  // raiz. VITE_BASE_PATH queda para el caso de servirla bajo un subdirectorio.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
  },
})
