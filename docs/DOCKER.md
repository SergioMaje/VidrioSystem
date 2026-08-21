# Entorno con Docker

Este documento cubre dos cosas distintas que conviene no mezclar:

1. **La base de datos local de cada desarrollador** — para que los dos podamos trabajar
   sin pisarnos.
2. **La imagen Docker del frontend** — para poder desplegar la app en cualquier lado sin
   recompilarla por entorno.

La base de datos de **produccion sigue en Supabase Cloud**. Docker no la reemplaza; la
seccion final explica que haria falta el dia que queramos self-hostearla.

---

## 1. Base de datos local

### Por que

Mientras fue un solo desarrollador, apuntar `.env.local` al proyecto de la nube funcionaba.
Con dos personas, esa base compartida es un problema: ambos escribimos sobre las mismas
tablas, y probar una migracion a medias rompe el trabajo del otro. Ahora cada uno corre su
propia base en contenedores y la nube queda **solo para produccion**.

### Requisitos

- Docker Desktop corriendo.
- La CLI de Supabase. No hace falta instalarla globalmente: `npx supabase <comando>`.

### Arranque

```bash
npx supabase start     # levanta Postgres, Auth (GoTrue), PostgREST y Studio
npx supabase status    # imprime las URLs y la anon key local
```

Los puertos estan desplazados en [supabase/config.toml](../supabase/config.toml) para no
chocar con otros proyectos Supabase de la misma maquina:

| Servicio | Puerto |
|---|---|
| API (PostgREST + Auth) | 54421 |
| Postgres | 54422 |
| Studio (interfaz web) | 54423 |

Luego copia `.env.example` a `.env.local` y descomenta el bloque de desarrollo local, con
la URL `http://127.0.0.1:54421` y la anon key que imprimio `supabase status`. Finalmente:

```bash
npm run dev            # http://localhost:5180
```

### Datos semilla

`supabase/seed.sql` se ejecuta automaticamente al final de cada `supabase db reset` y crea
categorias, unidades de medida, tipos de producto, algunos items de inventario, un cliente
de prueba y un usuario administrador:

```
admin@glazz.local  /  admin123
```

Esas credenciales solo existen en tu base local. `supabase db push` **no** envia el seed al
proyecto remoto, unicamente migraciones.

### Comandos del dia a dia

```bash
npx supabase db reset    # borra la base local y reaplica migraciones + seed desde cero
npx supabase stop        # apaga los contenedores (los datos sobreviven)
npx supabase stop --no-backup   # apaga y borra los datos
```

`db reset` es la operacion mas util: si tu base local quedo en un estado raro, o acabas de
traer migraciones nuevas del otro, resetear toma segundos y no le afecta a nadie.

### Nota sobre RLS

El baseline habilita RLS en todas las tablas pero solo algunas migraciones posteriores
definen politicas. Las politicas reales viven en el proyecto de la nube y se traen con
`supabase db pull` (ver [MIGRACIONES.md](MIGRACIONES.md)). Si en tu base local la app entra
pero no muestra ningun dato, es exactamente eso: tablas con RLS activo y sin politica que
permita leer.

---

## 2. Imagen Docker del frontend

### Configuracion en tiempo de arranque, no de build

Vite hornea `import.meta.env.VITE_*` dentro del bundle, lo que obligaria a construir una
imagen distinta por entorno. Para evitarlo, la app lee su configuracion de
`window.__APP_CONFIG__`, definido en `config.js`, un archivo que se sirve aparte y que el
contenedor **reescribe al arrancar** con las variables de entorno:

```
public/config.js          placeholder vacio, versionado en git
docker/entrypoint.sh      lo reescribe con SUPABASE_URL y SUPABASE_ANON_KEY
src/lib/supabase.ts       lee window.__APP_CONFIG__ y cae a VITE_* si esta vacio
```

Ese fallback es lo que mantiene `npm run dev` y el despliegue a GitHub Pages funcionando
exactamente como antes: ahi nadie reescribe `config.js`, y se usan las variables `VITE_*`
de siempre.

La `anon key` es publica por diseno — viaja al navegador en cualquier caso. Lo que protege
los datos es RLS, no el secreto de esa clave.

### Construir y correr

```bash
docker compose up --build       # http://localhost:8180
```

`docker compose` lee el archivo `.env` de la raiz (no `.env.local`) y espera las variables
**sin** el prefijo `VITE_`:

```env
SUPABASE_URL=http://127.0.0.1:54421
SUPABASE_ANON_KEY=<anon key local>
```

Esa URL la resuelve el **navegador**, no el contenedor: por eso apunta a `127.0.0.1` y no a
un nombre de servicio interno de Docker.

O sin compose:

```bash
docker build -t glazz-web .
docker run --rm -p 8180:80 \
  -e SUPABASE_URL=https://<ref>.supabase.co \
  -e SUPABASE_ANON_KEY=<anon key> \
  glazz-web
```

Si falta alguna de las dos variables el contenedor falla al arrancar con un mensaje
explicito, en vez de servir una pantalla en blanco.

### Base path

GitHub Pages sirve la app bajo `/VidrioSystem/`; el contenedor la sirve en `/`. Ese valor
esta en un solo lugar (`base` en `vite.config.ts`, con default `/VidrioSystem/`) y el router
lo deriva con `import.meta.env.BASE_URL`. El Dockerfile construye con `VITE_BASE_PATH=/`.

---

## 3. El dia que queramos self-hostear la base

No hay que hacerlo ahora, pero conviene saber que el camino esta despejado. Glazz usa
Supabase **solo como Postgres + Auth**: no hay Storage, Realtime, Edge Functions ni `rpc`.
Los unicos usos son `supabase.auth.*` en `src/hooks/useAuth.ts` y consultas PostgREST.

Migrar seria:

1. Levantar un `docker-compose` con `postgres`, `gotrue` (Auth), `postgrest` (API) y `kong`
   (gateway) — el compose oficial de Supabase self-hosted ya trae mas servicios de los que
   necesitamos.
2. Aplicar las mismas migraciones de `supabase/migrations/` con `supabase db push` apuntando
   a esa base.
3. Cambiar `SUPABASE_URL` y `SUPABASE_ANON_KEY` en el entorno del contenedor. **El codigo de
   la app no cambia** — de eso se trata el paso 2 de este documento.

Lo que pasaria a ser responsabilidad nuestra: backups, certificados TLS, actualizaciones de
version y monitoreo. Por eso la recomendacion es quedarse en Supabase Cloud mientras el
volumen no lo justifique.
