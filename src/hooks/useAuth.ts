import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Usuario } from '@/types/database'

interface AuthContextType {
  user: User | null
  usuario: Usuario | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}

async function fetchUsuario(userId: string): Promise<Usuario | null> {
  const { data } = await supabase
    .from('usuarios')
    .select('*')
    .eq('id', userId)
    .single()
  return data
}

export function useAuthState() {
  const [user, setUser] = useState<User | null>(null)
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [loading, setLoading] = useState(true)
  const queryClient = useQueryClient()
  const ultimoUsuarioId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    // La cache de TanStack es por navegador, no por usuario: si en el mismo equipo sale
    // uno y entra otro de otra vidrieria, sin esto veria por unos minutos los clientes,
    // la caja y el logo del anterior hasta que cada query se refresque.
    const alCambiarUsuario = (id: string | null) => {
      if (ultimoUsuarioId.current !== undefined && ultimoUsuarioId.current !== id) {
        queryClient.clear()
      }
      ultimoUsuarioId.current = id
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      alCambiarUsuario(session?.user?.id ?? null)
      setUser(session?.user ?? null)
      setLoading(false)
      if (session?.user) {
        fetchUsuario(session.user.id)
          .then((perfil) => setUsuario(perfil))
          .catch(() => setUsuario(null))
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      alCambiarUsuario(session?.user?.id ?? null)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchUsuario(session.user.id)
          .then((perfil) => setUsuario(perfil))
          .catch(() => setUsuario(null))
      } else {
        setUsuario(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [queryClient])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(traducirError(error.message))
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return { user, usuario, loading, signIn, signOut }
}

function traducirError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'Credenciales incorrectas'
  if (msg.includes('Email not confirmed')) return 'Confirma tu correo electrónico'
  if (msg.includes('User already registered')) return 'El correo ya está registrado'
  if (msg.includes('Password should be at least')) return 'La contraseña debe tener al menos 6 caracteres'
  return 'Error de autenticación'
}
