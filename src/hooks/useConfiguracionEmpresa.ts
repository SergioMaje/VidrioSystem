import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ConfiguracionEmpresa } from '@/types/database'

const KEY = ['configuracion_empresa']
const BUCKET = 'empresa'

/** La migracion siembra la fila, pero maybeSingle evita romper si alguien la borro. */
export function useConfiguracionEmpresa() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('configuracion_empresa').select('*').maybeSingle()
      if (error) throw error
      return data as ConfiguracionEmpresa | null
    },
  })
}

type ConfiguracionEmpresaInput = Omit<
  ConfiguracionEmpresa,
  'id' | 'logo_path' | 'created_at' | 'updated_at'
>

export function useGuardarConfiguracionEmpresa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ConfiguracionEmpresaInput }) => {
      const { error } = await supabase.from('configuracion_empresa').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

const extensionDe = (file: File) => {
  const porNombre = file.name.split('.').pop()?.toLowerCase()
  if (porNombre && /^(png|jpe?g|webp)$/.test(porNombre)) return porNombre
  return file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
}

/**
 * Sube el archivo con un nombre nuevo cada vez en vez de sobrescribir siempre `logo.png`:
 * el bucket es publico y se sirve por CDN, asi que reusar el nombre hace que el navegador
 * y la cache intermedia sigan entregando el logo viejo durante horas.
 */
export function useSubirLogoEmpresa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ empresa, file }: { empresa: ConfiguracionEmpresa; file: File }) => {
      const path = `logo-${Date.now()}.${extensionDe(file)}`
      const { error: errorSubida } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type })
      if (errorSubida) throw errorSubida

      const { error } = await supabase
        .from('configuracion_empresa')
        .update({ logo_path: path })
        .eq('id', empresa.id)
      if (error) {
        // La fila manda: si no quedo apuntando al archivo nuevo, ese archivo es basura.
        await supabase.storage.from(BUCKET).remove([path])
        throw error
      }

      // El anterior se borra al final y sin cortar el flujo: que quede huerfano es un
      // desperdicio de espacio, no un error que el usuario deba ver.
      if (empresa.logo_path) await supabase.storage.from(BUCKET).remove([empresa.logo_path])
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useEliminarLogoEmpresa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (empresa: ConfiguracionEmpresa) => {
      const { error } = await supabase
        .from('configuracion_empresa')
        .update({ logo_path: null })
        .eq('id', empresa.id)
      if (error) throw error
      if (empresa.logo_path) await supabase.storage.from(BUCKET).remove([empresa.logo_path])
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

const aDataUri = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/**
 * El logo como data URI, no como URL.
 *
 * Los documentos se imprimen escribiendo un string de HTML en una ventana nueva y llamando
 * `print()` unos milisegundos despues. Con `<img src="https://...">` esa carrera se pierde
 * a veces y el logo sale en blanco. Incrustado en el HTML no hay descarga que esperar.
 *
 * Se usa desde el cuerpo del componente, nunca dentro de `imprimir()`, que es sincrono.
 */
export function useLogoEmpresaDataUri() {
  const { data: empresa } = useConfiguracionEmpresa()
  const logoPath = empresa?.logo_path ?? null

  return useQuery({
    queryKey: [...KEY, 'logo', logoPath],
    enabled: !!logoPath,
    // El logo cambia muy de vez en cuando y convertirlo cuesta; que sobreviva a los
    // remontajes de la pagina de detalle.
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).download(logoPath!)
      if (error) throw error
      return aDataUri(data)
    },
  })
}
