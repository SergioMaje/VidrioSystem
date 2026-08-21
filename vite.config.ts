import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  // GitHub Pages sirve la app bajo /VidrioSystem/, pero el contenedor la sirve en la
  // raiz. Se mantiene el valor de Pages como default para no tocar ese despliegue;
  // el Dockerfile construye con VITE_BASE_PATH=/.
  base: process.env.VITE_BASE_PATH ?? '/VidrioSystem/',
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
