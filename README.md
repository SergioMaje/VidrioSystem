# 🪟 VidrioSystem — Sistema de Inventario para Vidriería

Sistema web para gestionar materiales, configurar productos personalizados (ventanas, puertas, divisiones y espejos), crear cotizaciones y controlar órdenes de producción.

---

## 📋 Contexto del negocio

La vidriería fabrica y vende productos personalizados. Cada producto terminado se compone de materiales del inventario. El sistema resuelve dos necesidades clave:

1. **Control de stock** — saber en todo momento cuánto vidrio, perfil, herraje y sellante hay disponible, con alertas cuando el stock baja del mínimo.
2. **Configurador de productos** — al ingresar las medidas de una ventana o puerta, el sistema calcula automáticamente qué materiales se necesitan, cuánto cuestan y si hay stock suficiente. El producto se visualiza en tiempo real mientras se configura.

El flujo completo es:

```
Configurar producto → Crear cotización → Cliente aprueba → Orden de trabajo → Producción → Descuento automático de stock → Entrega
```

---

## 🛠️ Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | Vite + React 18 + TypeScript |
| Estilos | Tailwind CSS + shadcn/ui |
| Navegación | React Router v6 |
| Datos | TanStack Query (React Query) |
| Formularios | React Hook Form + Zod |
| Gráficos | Recharts |
| Íconos | Lucide React |
| Base de datos | Supabase (PostgreSQL) — local en Docker, producción en Supabase Cloud |
| Autenticación | Supabase Auth |
| Contenedores | Docker (base de datos local + imagen nginx del frontend) |
| Despliegue | GitHub Pages (frontend) + Supabase Cloud (DB) |

---

## ⚙️ Configuración inicial

### 1. Clonar e instalar dependencias

```bash
git clone <url-del-repositorio>
cd vidrieria
npm install
```

### 2. Levantar la base de datos local

Cada desarrollador trabaja contra su propia base en Docker, no contra el proyecto de la
nube (que es producción). Requiere Docker Desktop:

```bash
npx supabase start      # Postgres + Auth + API en contenedores
npx supabase db reset   # aplica migraciones + datos semilla
npx supabase status     # imprime la URL y la anon key locales
```

### 3. Variables de entorno

Copia `.env.example` a `.env.local` y usa los valores que imprimió `supabase status`:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54421
VITE_SUPABASE_ANON_KEY=<anon key local>
```

### 4. Levantar el servidor local

```bash
npm run dev
```

La app queda disponible en `http://localhost:5180` (puerto fijo, para no chocar con otros proyectos que corran en el 5173). Entra con el usuario semilla `admin@glazz.local` / `admin123`.

Para correr la app tal como se despliega (imagen Docker con nginx), ver
[docs/DOCKER.md](docs/DOCKER.md).

---

## 🗂️ Estructura del proyecto

```
src/
├── components/
│   ├── ui/                  # Componentes shadcn/ui
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Navbar.tsx
│   │   └── DashboardLayout.tsx
│   └── shared/
│       ├── StockBadge.tsx
│       ├── LoadingSpinner.tsx
│       ├── EmptyState.tsx
│       └── ConfirmDialog.tsx
├── hooks/
│   ├── useAuth.ts
│   ├── useInventario.ts
│   ├── useProductos.ts
│   ├── useCotizaciones.ts
│   └── useClientes.ts
├── lib/
│   ├── supabase.ts
│   └── utils.ts
├── pages/
│   ├── auth/
│   │   ├── LoginPage.tsx
│   │   └── RegistroPage.tsx
│   ├── dashboard/
│   │   └── DashboardPage.tsx
│   ├── inventario/
│   │   ├── InventarioPage.tsx
│   │   ├── ItemDetalleDrawer.tsx
│   │   └── ItemFormDialog.tsx
│   ├── productos/
│   │   ├── ProductosPage.tsx
│   │   ├── ConfiguradorProducto.tsx
│   │   └── PreviewProducto.tsx
│   ├── cotizaciones/
│   │   ├── CotizacionesPage.tsx
│   │   ├── CotizacionDetalle.tsx
│   │   └── CotizacionFormPage.tsx
│   ├── clientes/
│   │   ├── ClientesPage.tsx
│   │   └── ClienteFormDialog.tsx
│   └── ordenes/
│       ├── OrdenesPage.tsx
│       └── OrdenDetalle.tsx
├── routes/
│   ├── index.tsx
│   └── ProtectedRoute.tsx
└── types/
    └── database.ts
```

---

## 🗃️ Modelo de base de datos

Las tablas están en Supabase con Row Level Security activado. La relación central es el **BOM (Bill of Materials)** — la receta que define qué materiales lleva cada producto.

```
categorias ──────────────────────────────┐
unidades_medida ──────────────────────────┤
proveedores ──────────────────────────────┤
                                          ↓
                              items_inventario ←── movimientos_inventario
                                          ↑
plantillas_producto ──── plantilla_componentes
        ↑
tipos_producto

clientes ──── cotizaciones ──── cotizacion_items
                   ↓
            ordenes_trabajo
```

### Tablas principales

| Tabla | Descripción |
|---|---|
| `usuarios` | Extiende auth.users con nombre, apellido y rol |
| `categorias` | Vidrio, Perfil de aluminio, Herrajes, Sellantes |
| `unidades_medida` | m², ml, und, kg, tubo |
| `proveedores` | Proveedores de materiales |
| `items_inventario` | Materiales con stock, precios y alertas |
| `movimientos_inventario` | Auditoría de entradas, salidas y ajustes |
| `tipos_producto` | ventana, puerta, division, espejo |
| `plantillas_producto` | Recetas de productos (BOM) |
| `plantilla_componentes` | Qué materiales y qué fórmula usa cada plantilla |
| `clientes` | Clientes naturales y jurídicos |
| `cotizaciones` | Cotizaciones con estados y totales |
| `cotizacion_items` | Items de cada cotización con medidas |
| `ordenes_trabajo` | Órdenes de producción con estados |

---

## 🚀 Plan de sprints

### ✅ Sprint 1 — Fundación (Semanas 1–2)
**Objetivo:** proyecto andando con autenticación y base de datos lista.

**Base de datos**
- [x] Crear tablas base (usuarios, categorias, unidades_medida)
- [x] Crear tablas de inventario (items, proveedores, movimientos)
- [x] Crear tablas de productos BOM (tipos, plantillas, componentes)
- [x] Crear tablas comerciales (clientes, cotizaciones, ordenes)
- [x] Activar RLS y políticas de seguridad en Supabase
- [x] Insertar datos semilla (categorías, unidades, tipos de producto)

**Autenticación y estructura**
- [x] Inicializar proyecto Vite + React + TypeScript
- [x] Instalar y configurar Tailwind CSS + shadcn/ui
- [x] Conectar proyecto con Supabase (.env.local)
- [x] Implementar login con Supabase Auth
- [x] Implementar registro de usuario
- [x] Crear hook `useAuth` con contexto global
- [x] Crear `ProtectedRoute` para rutas privadas
- [x] Crear layout base con Sidebar y Navbar
- [x] Crear `DashboardLayout` con área de contenido y React Router
- [x] Configurar todas las rutas de la app (React Router v6)
- [x] Crear `DashboardPage` con métricas placeholder
- [ ] Crear repositorio en GitHub y primer commit

**Entregable:** app con login/registro funcional, sidebar y dashboard vacío.

---

### ✅ Sprint 2 — Inventario (Semanas 3–4)
**Objetivo:** CRUD completo de materiales con control de stock y movimientos.

**Orden de implementación:**

| # | Tarea | Prioridad | Notas |
|---|---|---|---|
| 1 | Crear componente `StockBadge` (verde/amarillo/rojo) | Alta | Hacer primero — se usa en todas las pantallas del sprint |
| 2 | Crear hook `useInventario` con React Query | Alta | Centraliza todas las consultas a Supabase |
| 3 | `InventarioPage` — tabla con búsqueda y filtro por categoría | Alta | Usa el hook y el StockBadge |
| 4 | `ItemFormDialog` — modal para crear y editar items | Alta | El mismo formulario sirve para crear y editar |
| 5 | `ItemDetalleDrawer` — panel lateral con historial de movimientos | Alta | Se abre al hacer clic en una fila de la tabla |
| 6 | Registrar entradas y salidas de inventario | Alta | Va dentro del ItemDetalleDrawer |
| 7 | CRUD de proveedores | Media | Pantalla similar a clientes, más simple |
| 8 | Insertar items semilla (vidrios, perfiles, herrajes) | Media | Último paso — datos reales para probar |

**Entregable:** sistema funcional de inventario donde puedes administrar todos los materiales.

---

### ✅ Sprint 3 — Configurador de productos (Semanas 5–6)
**Objetivo:** la pieza más valiosa — configurar productos con vista previa en tiempo real.

**Orden de implementación:**

| # | Tarea | Prioridad |
|---|---|---|
| 1 | Crear hook `useProductos` con React Query | Alta |
| 2 | `ConfiguradorProducto` — selector de tipo y inputs de medidas | Alta |
| 3 | `PreviewProducto` — dibuja SVG del producto en tiempo real | Alta |
| 4 | Cálculo automático de materiales (área, perímetro, fijo) | Alta |
| 5 | Tabla de materiales con disponibilidad de stock en tiempo real | Alta |
| 6 | Cálculo de costo total y precio de venta sugerido | Alta |
| 7 | Crear y editar plantillas de productos (recetas BOM) | Media |
| 8 | Insertar plantillas semilla (ventana corrediza, puerta baño, división ducha) | Media |

**Entregable:** pantalla donde generas un producto y ves materiales y costos al instante.

---

### ✅ Sprint 4 — Cotizaciones y órdenes (Semanas 7–8)
**Objetivo:** flujo completo desde cliente hasta entrega.

**Orden de implementación:**

| # | Tarea | Prioridad |
|---|---|---|
| 1 | Crear hook `useClientes` con React Query | Alta |
| 2 | `ClientesPage` — tabla con búsqueda | Alta |
| 3 | `ClienteFormDialog` — modal para crear y editar cliente | Alta |
| 4 | Crear hook `useCotizaciones` con React Query | Alta |
| 5 | `CotizacionesPage` — tabla con filtros por estado | Alta |
| 6 | `CotizacionFormPage` — crear cotización con items y subtotales | Alta |
| 7 | `CotizacionDetalle` — ver, aprobar, rechazar cotización | Alta |
| 8 | Convertir cotización aprobada en orden de trabajo | Alta |
| 9 | `OrdenesPage` — tabla con filtros por estado | Alta |
| 10 | `OrdenDetalle` — cambio de estado y descuento automático de stock | Alta |

**Entregable:** flujo completo: cliente → cotización → aprobación → orden → producción → entrega.

---

### ✅ Sprint 5 — Reportes y alertas (Semanas 9–10)
**Objetivo:** inteligencia del negocio — métricas, reportes y alertas.

**Orden de implementación:**

| # | Tarea | Prioridad |
|---|---|---|
| 1 | Conectar métricas reales al Dashboard (consultas Supabase) | Alta |
| 2 | Gráfico de ventas por mes con Recharts | Alta |
| 3 | Lista de items con stock bajo en el dashboard | Media |
| 4 | Top productos más vendidos y top clientes | Media |
| 5 | Reporte de inventario valorizado (exportar a CSV) | Media |
| 6 | Reporte de ventas por período | Media |
| 7 | Alertas de stock bajo configurables por umbral | Baja |

**Entregable:** dashboard ejecutivo y reportes exportables.

---

### ⬜ Sprint 6 — Pulido y despliegue (Semanas 11–12)
**Objetivo:** sistema listo para producción — rápido, seguro y bien probado.

**Orden de implementación:**

| # | Tarea | Prioridad |
|---|---|---|
| 1 | Pruebas de flujos críticos (login, cotización, descuento de stock) | Alta |
| 2 | Diseño responsivo (móvil y tablet) | Alta |
| 3 | Manejo global de errores y estados de carga | Alta |
| 4 | Despliegue en Vercel con dominio propio | Alta |
| 5 | Configurar backups automáticos en Supabase | Alta |
| 6 | Crear roles de usuario (admin, vendedor, bodega) en la UI | Media |
| 7 | Manual de uso del sistema | Baja |

**Entregable:** sistema en producción con dominio propio listo para operar.

---

## 👥 Roles de usuario

| Rol | Permisos |
|---|---|
| **Admin** | Acceso total — puede eliminar registros y gestionar usuarios |
| **Vendedor** | Crear y gestionar cotizaciones, clientes y ver inventario |
| **Bodega** | Ver y actualizar stock, registrar movimientos de inventario |

---

## 📌 Convenciones del proyecto

- Todos los textos de la UI en **español**
- Moneda en **pesos colombianos (COP)**
- Fechas en formato **DD/MM/YYYY**
- TypeScript estricto — sin usar `any`
- Errores mostrados con **toast notifications**
- Estados de loading en todas las operaciones async
