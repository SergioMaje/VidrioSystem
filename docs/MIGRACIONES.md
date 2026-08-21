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

## Setup inicial (una sola vez por persona)

1. **Instalar Docker Desktop.** No es opcional: el desarrollo se hace contra una base de
   datos local en contenedores, no contra el proyecto de la nube. Ver
   [DOCKER.md](DOCKER.md).
2. La Supabase CLI se usa vía `npx supabase <comando>` (no hace falta instalarla global).
3. Iniciar sesión:
   ```bash
   npx supabase login
   ```
4. Conectar el repo local al proyecto remoto de Supabase (pide el `project-ref`, visible
   en Settings → General del proyecto en el dashboard):
   ```bash
   npx supabase link --project-ref <ref>
   ```
   El link se necesita solo para `db push` / `db pull` / `migration list`. El trabajo
   diario ocurre contra la base local.

## Si acabas de clonar el repo

Levanta tu base local y listo — no toques el proyecto de la nube:

```bash
npx supabase start      # Postgres + Auth + API en Docker
npx supabase db reset   # aplica todas las migraciones + supabase/seed.sql
```

Entra con el usuario semilla (`admin@glazz.local` / `admin123`). Los detalles están en
[DOCKER.md](DOCKER.md).

## Sobre el baseline y `db pull`

`supabase/migrations/20260706000000_baseline_schema.sql` fue reconstruido a mano desde
`src/types/database.ts`, **no** generado contra la base real: los tipos exactos, defaults,
índices y políticas RLS pueden diferir de producción.

Corregirlo requiere `supabase db pull`, pero ese comando **no trae "el esquema"**: genera
una migración nueva con el *diff* entre el remoto y el historial local aplicado. Corrido
en el momento equivocado duplica trabajo — vuelca en un `_remote_schema.sql` cambios que
ya tienen su propia migración, y quedan dos definiciones del mismo cambio aplicándose en
orden distinto según el entorno.

Por eso `db pull` se corre **una sola vez**, y solo cuando se cumplen las tres condiciones:

- estás en `main` actualizado (`git pull origin main`),
- no queda ninguna migración sin mergear en ramas feature,
- `npx supabase migration list` (solo lectura, no modifica nada) muestra local y remoto
  alineados, sin filas pendientes de un lado solo.

Si `migration list` muestra un cambio aplicado a mano en el remoto pero sin registrar, se
registra sin reejecutarlo:

```bash
npx supabase migration repair --status applied <timestamp>
```

Y antes de cualquiera de estas operaciones, respalda el remoto: es la única copia de los
datos reales de la vidriería.

```bash
npx supabase db dump -f backup_esquema.sql
npx supabase db dump -f backup_datos.sql --data-only
```

## Crear una migración nueva

Cada vez que necesites cambiar el esquema (nueva tabla, columna, índice, política RLS,
etc.):

1. Crea el archivo de migración:
   ```bash
   supabase migration new agregar_columna_descuento_clientes
   ```
   Esto genera `supabase/migrations/<timestamp>_agregar_columna_descuento_clientes.sql`.
2. Escribe el SQL a mano en ese archivo. Ejemplo:
   ```sql
   alter table public.clientes
     add column descuento_pct numeric not null default 0;
   ```
3. Pruébala contra tu base local:
   ```bash
   npx supabase start        # si no está levantada
   npx supabase db reset     # reaplica TODAS las migraciones desde cero + el seed
   ```
   Si `db reset` falla, tu migración tiene un error — corrígela antes de seguir. Esto es
   lo que hubiera detectado, por ejemplo, un error de sintaxis al crear en su momento
   las tablas `referencias_producto` / `referencias_corte`. El CI corre exactamente este
   mismo `db reset` en cada PR.
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
- Referencia rápida de comandos: `supabase migration new`, `supabase db reset` (local),
  `supabase db pull` (traer remoto → local), `supabase db push` (aplicar local → remoto).
