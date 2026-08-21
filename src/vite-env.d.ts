/// <reference types="vite/client" />

// Configuracion inyectada en tiempo de arranque por el contenedor (public/config.js).
// Puede no existir cuando la app corre con `npm run dev` o desde GitHub Pages.
interface AppRuntimeConfig {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
}

interface Window {
  __APP_CONFIG__?: AppRuntimeConfig
}
