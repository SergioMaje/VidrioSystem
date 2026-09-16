import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Building2, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import {
  useConfiguracionEmpresa,
  useGuardarConfiguracionEmpresa,
  useSubirLogoEmpresa,
  useEliminarLogoEmpresa,
  useLogoEmpresaDataUri,
} from '@/hooks/useConfiguracionEmpresa'
import { useToast } from '@/hooks/useToast'
import { mensajeError } from '@/lib/utils'

const schema = z.object({
  nombre: z.string().min(1, 'El nombre es requerido'),
  eslogan: z.string().optional(),
  nit: z.string().optional(),
  direccion: z.string().optional(),
  ciudad: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email('Correo inválido').optional().or(z.literal('')),
})

type FormData = z.infer<typeof schema>

/** El bucket rechaza cualquier cosa mayor, pero el mensaje que devuelve no dice el limite. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024
const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp']

interface DatosEmpresaCardProps {
  esAdmin: boolean
}

export function DatosEmpresaCard({ esAdmin }: DatosEmpresaCardProps) {
  const { data: empresa, isLoading } = useConfiguracionEmpresa()
  const { data: logo } = useLogoEmpresaDataUri()
  const guardar = useGuardarConfiguracionEmpresa()
  const subirLogo = useSubirLogoEmpresa()
  const eliminarLogo = useEliminarLogoEmpresa()
  const { toast } = useToast()

  const logoInputRef = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (!empresa) return
    reset({
      nombre: empresa.nombre,
      eslogan: empresa.eslogan ?? '',
      nit: empresa.nit ?? '',
      direccion: empresa.direccion ?? '',
      ciudad: empresa.ciudad ?? '',
      telefono: empresa.telefono ?? '',
      email: empresa.email ?? '',
    })
  }, [empresa, reset])

  const onSubmit = async (data: FormData) => {
    if (!empresa) return
    try {
      await guardar.mutateAsync({
        id: empresa.id,
        data: {
          nombre: data.nombre,
          eslogan: data.eslogan || null,
          nit: data.nit || null,
          direccion: data.direccion || null,
          ciudad: data.ciudad || null,
          telefono: data.telefono || null,
          email: data.email || null,
        },
      })
      toast({ title: 'Datos de la empresa actualizados', variant: 'success' })
    } catch (error) {
      toast({
        title: 'Error al guardar',
        description: mensajeError(error, 'No se pudieron guardar los datos de la empresa.'),
        variant: 'destructive',
      })
    }
  }

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Se limpia de inmediato para poder volver a elegir el mismo archivo tras un error.
    e.target.value = ''
    if (!file || !empresa) return

    if (!TIPOS_LOGO.includes(file.type)) {
      toast({ title: 'Formato no admitido', description: 'El logo debe ser PNG, JPG o WEBP.', variant: 'destructive' })
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({ title: 'Imagen muy pesada', description: 'El logo no puede superar los 2 MB.', variant: 'destructive' })
      return
    }

    setSubiendo(true)
    try {
      await subirLogo.mutateAsync({ empresa, file })
      toast({ title: 'Logo actualizado', variant: 'success' })
    } catch (error) {
      toast({
        title: 'Error al subir el logo',
        description: mensajeError(error, 'No se pudo subir el archivo.'),
        variant: 'destructive',
      })
    } finally {
      setSubiendo(false)
    }
  }

  const handleQuitarLogo = async () => {
    if (!empresa) return
    try {
      await eliminarLogo.mutateAsync(empresa)
      toast({ title: 'Logo eliminado', variant: 'success' })
    } catch (error) {
      toast({
        title: 'Error al eliminar el logo',
        description: mensajeError(error, 'No se pudo eliminar el logo.'),
        variant: 'destructive',
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          Datos de la empresa
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          El logo y estos datos forman el membrete de las cotizaciones y las fichas de producción.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : !empresa ? (
          <p className="py-6 text-sm text-muted-foreground">
            No se encontró la configuración de la empresa. Revisa que la migración se haya aplicado.
          </p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-24 w-44 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                {logo ? (
                  <img src={logo} alt="Logo de la empresa" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="px-2 text-center text-xs text-muted-foreground">Sin logo</span>
                )}
              </div>
              {esAdmin && (
                <div className="space-y-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleLogoChange}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={subiendo}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      {subiendo
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <ImagePlus className="mr-2 h-4 w-4" />}
                      {empresa.logo_path ? 'Cambiar logo' : 'Subir logo'}
                    </Button>
                    {empresa.logo_path && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={eliminarLogo.isPending}
                        onClick={handleQuitarLogo}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Quitar
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">PNG, JPG o WEBP, hasta 2 MB.</p>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label>Nombre</Label>
                <Input placeholder="VidrioSystem" disabled={!esAdmin} {...register('nombre')} />
                {errors.nombre && <p className="text-xs text-destructive">{errors.nombre.message}</p>}
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Eslogan (opcional)</Label>
                <Input placeholder="Vidriería y aluminio" disabled={!esAdmin} {...register('eslogan')} />
              </div>
              <div className="space-y-1">
                <Label>NIT (opcional)</Label>
                <Input placeholder="900.123.456-7" disabled={!esAdmin} {...register('nit')} />
              </div>
              <div className="space-y-1">
                <Label>Teléfono (opcional)</Label>
                <Input placeholder="300 123 4567" disabled={!esAdmin} {...register('telefono')} />
              </div>
              <div className="space-y-1">
                <Label>Dirección (opcional)</Label>
                <Input placeholder="Calle 10 # 5-20" disabled={!esAdmin} {...register('direccion')} />
              </div>
              <div className="space-y-1">
                <Label>Ciudad (opcional)</Label>
                <Input placeholder="Bogotá" disabled={!esAdmin} {...register('ciudad')} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Correo (opcional)</Label>
                <Input placeholder="contacto@vidriosystem.com" disabled={!esAdmin} {...register('email')} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
            </div>

            {esAdmin && (
              <div className="flex justify-end">
                <Button type="submit" disabled={isSubmitting || !isDirty}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Guardar cambios
                </Button>
              </div>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  )
}
