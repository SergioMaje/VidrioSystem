# Guía de contribución — Glazz

Este documento define cómo trabajamos en el repo ahora que somos dos personas. El
objetivo es evitar pisarse cambios (de código y de base de datos) y mantener `main`
siempre en un estado funcional.

## Setup local

> **¿Primera vez en el proyecto?** Sigue [docs/ONBOARDING.md](docs/ONBOARDING.md), que lleva
> paso a paso desde cero e incluye qué hacer cuando algo falla. El resumen es:

1. `git clone <url-del-repositorio>`
2. `npm install`
3. Instala Docker Desktop y levanta tu base de datos local:
   ```bash
   npx supabase start
   npx supabase db reset    # migraciones + datos semilla
   ```
4. Copia `.env.example` a `.env.local` y descomenta el bloque de **desarrollo local**,
   con la URL y la anon key que imprime `npx supabase status`.
5. `npm run dev` y entra con `admin@glazz.local` / `admin123`.

**No desarrolles contra el proyecto de Supabase en la nube**: esa es la base de producción
de la vidriería. Cada uno trabaja contra su propia base en Docker, así podemos romper cosas
sin afectarnos. Los detalles están en [docs/DOCKER.md](docs/DOCKER.md) y el flujo de
esquema en [docs/MIGRACIONES.md](docs/MIGRACIONES.md).

## Flujo de ramas

Hay dos ramas de larga vida:

| Rama | Qué es |
|---|---|
| `main` | Lo que está desplegado. GitHub Pages publica desde aquí en cada push. |
| `develop` | Integración: donde se juntan las features antes de una publicación. |

- **Nunca se hace push directo a `main` ni a `develop`.** Todo entra por Pull Request.
- Toda rama nueva sale de `develop` actualizado:
  ```bash
  git checkout develop
  git pull origin develop
  git checkout -b feat/nombre-corto     # o fix/nombre-corto, chore/nombre-corto
  ```
- El PR va **hacia `develop`**. El otro desarrollador revisa (aunque sea una pasada rápida)
  y el CI tiene que pasar antes de mergear.
- Cuando lo acumulado en `develop` esté listo para publicarse, se abre un PR
  `develop` → `main`. Ese merge dispara el despliegue.
- Después de mergear, borrar la rama.

**Excepción:** un arreglo urgente de algo que está roto en producción puede ir directo por
PR a `main`, y después se baja a `develop` con un merge, para que no queden divergentes.

> Como `main` es lo que se despliega, el código que llega ahí y el esquema de la base tienen
> que viajar juntos. Si un PR trae una migración, hay que aplicarla al remoto justo después
> de mergear a `main` — si no, la app desplegada queda pidiendo columnas que no existen.

## Convención de commits

Seguimos el estilo ya usado en el historial del proyecto (conventional commits ligero):

- `feat: ...` — funcionalidad nueva
- `fix: ...` — corrección de bug
- `refactor: ...` — cambio interno sin alterar comportamiento
- `docs: ...` — solo documentación
- `chore: ...` — configuración, dependencias, tareas de mantenimiento

Mensajes en español, en modo imperativo, describiendo el porqué cuando no sea obvio.

## Cambios al esquema de base de datos

El esquema se maneja con migraciones versionadas de Supabase CLI, no editando el
dashboard directamente. Ver la guía completa en
[docs/MIGRACIONES.md](docs/MIGRACIONES.md). En resumen:

- Todo cambio de esquema va en una migración `.sql` dentro de `supabase/migrations/`,
  commiteada en el mismo PR que el código que la necesita.
- La migración se aplica al proyecto remoto (`supabase db push`) solo después de que
  el PR se mergeó a `main`.

## Variables de entorno

- Nunca commitear `.env.local` ni `.env` (ambos están en `.gitignore`).
- Si agregas una variable de entorno nueva, actualiza también `.env.example`.
- La app lee su configuración en tiempo de arranque desde `window.__APP_CONFIG__`
  (`public/config.js`), con las variables `VITE_*` como respaldo. Si agregas una variable
  que el contenedor deba poder cambiar sin recompilar, va también en `docker/entrypoint.sh`.
  Ver [docs/DOCKER.md](docs/DOCKER.md).

## Checklist para incorporar al compañero (una sola vez)

Lo que sigue lo hace quien administra el repo y el proyecto de Supabase; son cambios de
configuración de servicios compartidos, no se automatizan.

- [ ] GitHub → Settings → Collaborators → invitar al compañero.
- [ ] GitHub → Settings → Branches → regla de protección para `main` y `develop`:
      requerir Pull Request antes de mergear, y que pase el check de CI.
- [ ] Pasarle [docs/ONBOARDING.md](docs/ONBOARDING.md). Con eso levanta su entorno solo:
      **no necesita credenciales de Supabase para el trabajo diario.**
- [ ] Solo si va a aplicar migraciones a producción: Supabase → Settings → Team →
      invitarlo al proyecto, y compartirle el `project-ref` (no es secreto).

La contraseña de la base de datos **no se comparte por chat ni por correo.** Solo la
necesita quien corre `db push`, y si se filtra hay que restablecerla en Settings → Database
(no se puede consultar, solo regenerar).
