import { createClient } from '@supabase/supabase-js'

// La configuracion puede venir de dos lados:
//  1. window.__APP_CONFIG__ — reescrito por el contenedor al arrancar (public/config.js),
//     para que una sola imagen Docker sirva en cualquier entorno sin recompilar.
//  2. import.meta.env.VITE_* — horneado en build, que es como funciona `npm run dev`
//     y el despliegue a GitHub Pages.
// Gana el primero cuando trae un valor; si no, se usa el segundo.
function leerConfig(clave: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY', fallback: string): string {
  const enTiempoDeArranque = window.__APP_CONFIG__?.[clave]
  return enTiempoDeArranque && enTiempoDeArranque.length > 0 ? enTiempoDeArranque : fallback
}

const supabaseUrl = leerConfig('SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL as string)
const supabaseAnonKey = leerConfig('SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY as string)

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan las credenciales de Supabase. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY ' +
      'en .env.local, o SUPABASE_URL y SUPABASE_ANON_KEY en el entorno del contenedor.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type { Usuario, Categoria, UnidadMedida, Proveedor, ItemInventario, MovimientoInventario, TipoProducto, PlantillaProducto, PlantillaComponente, Cliente, Cotizacion, CotizacionItem, OrdenTrabajo } from '@/types/database'
