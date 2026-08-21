// Configuracion en tiempo de EJECUCION, no de build.
//
// Vite hornea `import.meta.env.*` dentro del bundle, lo que obliga a recompilar
// una imagen distinta por entorno. Este archivo se sirve aparte y el contenedor
// lo reescribe al arrancar (docker/entrypoint.sh) con los valores reales, de modo
// que una sola imagen Docker sirve en local, staging y produccion.
//
// Los valores vacios son intencionales: en `npm run dev` y en el build de GitHub
// Pages nadie reescribe este archivo, y src/lib/supabase.ts cae a las variables
// VITE_* de siempre.
//
// La anon key es publica por diseno (viaja al navegador en cualquier caso); lo
// que protege los datos es RLS, no el secreto de esta clave.
window.__APP_CONFIG__ = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
}
