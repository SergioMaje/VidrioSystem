# Cómo trabajar con migraciones de Supabase

Este documento explica el flujo diario para cambiar el esquema de la base de datos
del proyecto Glazz cuando se trabaja en equipo. Reemplaza la práctica anterior de
editar tablas directamente desde el dashboard de Supabase.

## Por qué migraciones y no el dashboard

Con un solo desarrollador, cambiar una tabla desde el dashboard de Supabase funcionaba
porque solo existía una fuente de verdad. Con dos personas trabajando en paralelo, eso
genera problemas:

- Un desarrollador no se entera de que el otro cambió una columna hasta que su código
  falla en producción.
- No hay historial de qué cambió, cuándo ni por qué (los commits de git sí lo dan).
- No hay forma de reproducir el esquema en un entorno local o de pruebas.

Las migraciones son archivos `.sql` versionados en `supabase/migrations/`, cada uno con
un cambio incremental. Git se vuelve la fuente de verdad del esquema, igual que ya lo es
del código.

## El baseline: por qué el historial se regeneró el 2026-08-21

Vale la pena conocer esta historia, porque explica la regla más importante del documento.

Durante meses el esquema se cambió desde el dashboard de Supabase y las migraciones del
repo se escribieron **a mano, por separado**, para documentar lo que se había hecho. El
resultado fue que los dos historiales nunca se cruzaron: al conectar el repo con el
proyecto real aparecieron 20 migraciones que solo existían en el remoto y 12 que solo
existían en git, **con cero en común**. Ninguna migración del repositorio se había aplicado
jamás a producción.

Y como nunca se ejecutaron, nadie notó que estaban mal. El baseline escrito a mano
declaraba como `text` diez columnas que en realidad son tipos enum, y no incluía ninguna
de las cuatro funciones (`get_user_rol`, `handle_new_user`, `actualizar_stock`,
`set_updated_at`), ni los 9 triggers, ni 60 de las 70 políticas RLS. Por eso
`supabase db reset` fallaba: las políticas usaban `get_user_rol()`, que existía en
producción pero no lo creaba ninguna migración del repo.

Se resolvió borrando las 12 migraciones ficticias y generando
`20260821052910_remote_schema.sql` con `supabase db pull` contra el proyecto real. **Desde
entonces git es la fuente de verdad del esquema, no una aproximación.**

> **La regla que se desprende de todo esto: ningún cambio de esquema se hace desde el
> dashboard de Supabase.** Ni uno solo, ni "rapidito para probar". En el momento en que
> alguien lo haga, git y producción vuelven a divergir en silencio, y el problema no se
> descubre hasta meses después.

## Setup inicial (una sola vez por persona)

1. **Instalar Docker Desktop.** No es opcional: el desarrollo se hace contra una base de
   datos local en contenedores, no contra el proyecto de la nube. Ver [DOCKER.md](DOCKER.md).
2. La Supabase CLI se usa vía `npx supabase <comando>`; no hace falta instalarla global.
3. Levantar tu base local:
   ```bash
   npx supabase start
   npx supabase db reset    # migraciones + supabase/seed.sql
   ```
   Entra con el usuario semilla: `admin@glazz.local` / `admin123`.

Eso es todo para el trabajo diario. **No necesitas vincular el repo con el proyecto de la
nube**, y es mejor que no lo hagas: así no hay forma de tocar producción por accidente.

## Vincular con el proyecto remoto (solo quien aplica migraciones)

Únicamente hace falta para `db push`, `db pull` y `migration list`:

```bash
npx supabase login
npx supabase link --project-ref <ref>
```

`db push` y `db pull` piden además la contraseña de la base de datos (Settings → Database).
No se puede consultar: si nadie la tiene, hay que restablecerla.

## Crear una migración nueva

Cada vez que necesites cambiar el esquema (nueva tabla, columna, índice, política RLS,
etc.):

1. Crea el archivo de migración:
   ```bash
   npx supabase migration new agregar_columna_descuento_clientes
   ```
   Esto genera `supabase/migrations/<timestamp>_agregar_columna_descuento_clientes.sql`.
2. Escribe el SQL a mano en ese archivo. Ejemplo:
   ```sql
   alter table public.clientes
     add column descuento_pct numeric not null default 0;
   ```
3. Pruébala localmente (requiere Docker):
   ```bash
   npx supabase start        # levanta Postgres local con todas las migraciones existentes
   npx supabase db reset     # reaplica TODAS las migraciones desde cero, incluida la nueva
   ```
   Si `db reset` falla, tu migración tiene un error — corrígela antes de seguir. Esto es
   lo que hubiera detectado, por ejemplo, un error de sintaxis al crear en su momento
   las tablas `referencias_producto` / `referencias_corte`.
4. Commitea el archivo `.sql` junto con el código que lo usa (mismo PR). El código de
   la app y el esquema que necesita deben viajar juntos.

## Aplicar la migración al proyecto remoto compartido

Las migraciones se aplican al remoto **solo cuando el PR ya fue aprobado y mergeado a
`main`**, nunca antes — así se evita que alguien pruebe algo a medias contra la base
de datos que usan ambos.

```bash
git checkout main
git pull
npx supabase db push
```

Quien mergea el PR es quien corre `db push`. Avisar en el chat del equipo antes de
correrlo, para que no coincida con el otro desarrollador aplicando otra migración al
mismo tiempo.

## Si ambos crean una migración en paralelo

El nombre del archivo empieza con un timestamp (`YYYYMMDDHHMMSS_...`), así que Supabase
las aplica en orden cronológico. Si ambos crearon migraciones en ramas distintas:

1. El primero en mergear a `main` hace su `db push` normalmente.
2. El segundo, antes de mergear, hace `git pull origin main` en su rama para traer la
   migración del otro, corre `supabase db reset` localmente para confirmar que las dos
   migraciones (la ya mergeada + la suya) conviven sin conflicto, y luego mergea.
3. Si hay conflicto real de esquema (ej. ambos agregaron una columna con el mismo
   nombre pero distinto tipo), se resuelve conversando — no hay forma automática de
   fusionar cambios de esquema contradictorios.

## Buenas prácticas

- **Una migración = un cambio lógico.** No mezcles "agregar tabla X" con "renombrar
  columna Y" en el mismo archivo si son cambios independientes.
- **Nunca edites una migración ya commiteada y mergeada a `main`.** Si el proyecto
  remoto ya la aplicó, editarla localmente no la vuelve a aplicar — vas a tener que
  crear una migración nueva que corrija lo que haga falta.
- **Nombres descriptivos**: `agregar_indice_items_categoria`, no `fix` o `cambios`.
- **Evita cambios destructivos sin avisar** (`drop table`, `drop column`): si alguien
  más tiene datos de prueba o código que depende de esa columna, coordina antes en el
  equipo.
- **`supabase/seed.sql` nunca llega al remoto.** `db push` solo envía migraciones. El seed
  es exclusivo de las bases locales, por eso puede traer un usuario con contraseña conocida.
- Referencia rápida: `npx supabase migration new`, `npx supabase db reset` (local),
  `npx supabase db push` (aplicar local → remoto), `npx supabase migration list` (comparar
  local contra remoto, solo lectura).
