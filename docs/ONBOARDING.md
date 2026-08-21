# Poner a andar Glazz en tu máquina

Guía para el segundo desarrollador. Al terminar vas a tener el proyecto corriendo contra
**tu propia base de datos**, en contenedores, sin riesgo de tocar los datos de la vidriería
ni de pisar el trabajo del otro.

Toma entre 20 y 40 minutos, casi todo esperando descargas.

---

## Lo que hay que entender antes de empezar

Hasta agosto de 2026 se trabajaba directo contra la base de Supabase en la nube. Con dos
personas eso ya no funciona: ambos escribirían sobre las mismas tablas y probar un cambio a
medias rompería el trabajo del otro.

Ahora hay **dos entornos separados**:

| | Dónde vive | Para qué |
|---|---|---|
| **Tu base local** | Contenedores Docker en tu PC | Todo el desarrollo y las pruebas |
| **Producción** | Supabase Cloud | La vidriería. **No se desarrolla contra esto.** |

Tu base local arranca vacía y se llena con datos de ejemplo. Puedes borrarla y recrearla
cuantas veces quieras: no le afecta a nadie.

---

## 1. Instalar lo necesario

| Herramienta | Cómo | Nota |
|---|---|---|
| **Node.js 20+** | https://nodejs.org | Trae `npm` y `npx` |
| **Docker Desktop** | https://docker.com/products/docker-desktop | Obligatorio. Aquí corre la base de datos |
| **Git** | https://git-scm.com | |

**Docker Desktop tiene que estar corriendo** antes de los pasos siguientes. Tarda entre 1 y
3 minutos en arrancar del todo; el ícono de la ballena deja de animarse cuando terminó. La
primera vez puede pedir configurar WSL 2 y reiniciar Windows.

Para comprobar que el motor está listo:

```powershell
docker info
```

Si responde con información del sistema, vas bien. Si dice
`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`, Docker
todavía no terminó de arrancar.

## 2. Clonar el repositorio

```powershell
git clone https://github.com/SergioMaje/VidrioSystem.git
cd VidrioSystem
npm install
```

## 3. Levantar tu base de datos

```powershell
npx supabase start
```

**La primera vez tarda entre 5 y 15 minutos**: descarga alrededor de diez imágenes de
contenedor (Postgres, autenticación, API, Studio…), varios GB en total. Va a imprimir
muchas líneas de progreso que se parecen entre sí — no es que esté colgado. Los arranques
siguientes toman segundos.

Termina imprimiendo un bloque con URLs y llaves. **Guarda esa salida**, la necesitas en el
paso siguiente. Si la pierdes:

```powershell
npx supabase status
```

Luego carga el esquema y los datos de ejemplo:

```powershell
npx supabase db reset
```

## 4. Configurar las variables de entorno

Copia `.env.example` a `.env.local` y llena el bloque de desarrollo local con los valores
que imprimió el paso anterior:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54421
VITE_SUPABASE_ANON_KEY=<la "anon key" que imprimió supabase status>
```

Esa `anon key` local es fija y pública: la genera la CLI, es la misma en todas las máquinas
y no es un secreto.

> **Deja comentado el bloque del proyecto en la nube.** Si apuntas ahí sin darte cuenta,
> vas a estar desarrollando contra los datos reales de la vidriería.

## 5. Arrancar la app

```powershell
npm run dev
```

Abre **http://localhost:5180** y entra con:

```
admin@glazz.local
admin123
```

Ese usuario solo existe en tu máquina — está definido en `supabase/seed.sql` y nunca viaja
al proyecto de la nube.

Vas a encontrar 4 categorías, 5 unidades de medida, 5 tipos de producto, 6 ítems de
inventario y un cliente de ejemplo. Suficiente para crear una cotización y recorrer el flujo
completo.

---

## Tu día a día

```powershell
npx supabase start     # al empezar (si no quedó corriendo)
npm run dev            # la app
npx supabase db reset  # dejar la base como recién instalada
npx supabase stop      # al terminar (los datos sobreviven)
```

`db reset` es el comando que más vas a agradecer: si tu base local queda en un estado raro,
o traes migraciones nuevas del otro, volver a cero cuesta segundos.

Otras URLs útiles mientras la base está levantada:

| | |
|---|---|
| Studio — ver y editar tablas | http://127.0.0.1:54423 |
| Mailpit — correos que envía la app | http://127.0.0.1:54324 |

## Las tres reglas del equipo

**1. Nunca cambies el esquema desde el dashboard de Supabase.** Todo cambio de tabla,
columna, índice o política va en una migración `.sql` dentro de `supabase/migrations/`,
commiteada en el mismo PR que el código que la usa. Esta regla no es una preferencia de
estilo: fue lo que hizo divergir git de producción durante meses, y la historia completa
está en [MIGRACIONES.md](MIGRACIONES.md).

**2. No desarrolles contra la nube.** Ese proyecto es la vidriería trabajando.

**3. Nada llega a `main` sin Pull Request.** El otro revisa, aunque sea una pasada rápida, y
el CI tiene que pasar. Ver [CONTRIBUTING.md](../CONTRIBUTING.md).

## Si algo falla

| Síntoma | Causa y solución |
|---|---|
| `open //./pipe/dockerDesktopLinuxEngine...` | Docker Desktop no está corriendo, o aún no terminó de arrancar. Espera y verifica con `docker info` |
| `supabase start` parece repetirse sin fin | Normal la primera vez: está descargando imágenes. Si el texto repetido es el error del pipe, es Docker |
| La app carga pero no muestra datos | Falta correr `npx supabase db reset` |
| No puedes entrar con el usuario semilla | `npx supabase db reset` lo vuelve a crear |
| Pantalla en blanco | `.env.local` sin valores o mal escrito |
| Un puerto está ocupado | Los puertos están desplazados a propósito (5180, 54421-54424) para no chocar con otros proyectos. Si aun así choca, avisa antes de cambiarlos: están fijos en `vite.config.ts` y `supabase/config.toml` |

## Lo que necesitas que te den

Estas cosas no se pueden automatizar, alguien te las tiene que conceder:

- [ ] Acceso al repositorio en GitHub (Settings → Collaborators)
- [ ] Invitación al proyecto de Supabase, **solo si vas a aplicar migraciones a
      producción** (Settings → Team). Para el trabajo diario no hace falta.

Nada más. En particular **no necesitas** la contraseña de la base de datos ni un token de
acceso de Supabase: el entorno local no los usa.

---

## Si además quieres correr la imagen Docker del frontend

Opcional, y solo para verificar cómo se ve la app tal como se despliega. No sirve para
desarrollar, porque la imagen queda congelada en el momento del build. Está explicado en
[DOCKER.md](DOCKER.md).
