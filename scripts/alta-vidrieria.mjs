// Alta de vidrierias y de sus usuarios. Lo corre el dueno del sistema, nunca la app:
// necesita la service_role key, que salta todo el RLS.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/alta-vidrieria.mjs empresa "Vidrieria X" admin@x.com "Nombre" "Apellido"
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/alta-vidrieria.mjs usuario <empresa_id> vendedor@x.com vendedor "Nombre" "Apellido"
//
// `empresa` crea la vidrieria (membrete y catalogos base, ver crear_empresa()) y su
// primer admin. `usuario` suma un usuario a una vidrieria existente; rol: admin,
// vendedor o bodega.
//
// La empresa y el rol viajan en app_metadata: handle_new_user() los lee de ahi y
// rechaza el alta si no vienen. El usuario queda confirmado y con una contrasena
// temporal que se muestra una sola vez en consola; la app todavia no tiene flujo de
// "olvide mi contrasena", asi que hay que entregarsela a mano.

import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const ROLES = ['admin', 'vendedor', 'bodega']

function salir(mensaje) {
  console.error(mensaje)
  process.exit(1)
}

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) salir('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.')

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function crearUsuario({ empresaId, email, rol, nombre, apellido }) {
  if (!ROLES.includes(rol)) salir(`Rol invalido "${rol}". Usa: ${ROLES.join(', ')}.`)
  const password = randomBytes(9).toString('base64url')
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { empresa_id: empresaId, rol },
    user_metadata: { nombre, apellido },
  })
  if (error) salir(`No se pudo crear el usuario ${email}: ${error.message}`)
  console.log(`Usuario ${email} (${rol}) creado: ${data.user.id}`)
  console.log(`Contrasena temporal: ${password}`)
}

const [comando, ...args] = process.argv.slice(2)

if (comando === 'empresa') {
  const [nombreEmpresa, email, nombre = 'Admin', apellido = ''] = args
  if (!nombreEmpresa || !email) salir('Uso: empresa "<nombre vidrieria>" <email admin> [nombre] [apellido]')

  const { data: empresaId, error } = await supabase.rpc('crear_empresa', { p_nombre: nombreEmpresa })
  if (error) salir(`No se pudo crear la vidrieria: ${error.message}`)
  console.log(`Vidrieria "${nombreEmpresa}" creada: ${empresaId}`)
  console.log('Si falla el alta del admin, reintentala con el comando `usuario` y este id.')

  await crearUsuario({ empresaId, email, rol: 'admin', nombre, apellido })
} else if (comando === 'usuario') {
  const [empresaId, email, rol, nombre = 'Sin nombre', apellido = ''] = args
  if (!empresaId || !email || !rol) salir('Uso: usuario <empresa_id> <email> <rol> [nombre] [apellido]')
  await crearUsuario({ empresaId, email, rol, nombre, apellido })
} else {
  salir('Comandos: empresa | usuario. Ver el encabezado de scripts/alta-vidrieria.mjs.')
}
