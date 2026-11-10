# 🍽️ SavorAI — Sistema de Restaurante con IA

Plataforma de operación gastronómica completa: mesas, KDS, toma de pedidos, reservas/CRM,
facturación, inventario y un **agente de IA** que audita el servicio en tiempo real.

Diseño original: Stitch → *"Warm Culinary Intelligence"* (6 pantallas replicadas en React).

---

## 📦 Estructura del proyecto

```
restaurante-IA/
├── docker-compose.yml        # PostgreSQL 16 (puerto 5433)
├── backend/                  # Node + Express + TypeScript
│   └── src/
│       ├── index.ts          # Servidor Express (puerto 3001)
│       ├── db/
│       │   ├── schema.sql    # 42 tablas + ENUMs + índices
│       │   ├── init.ts       # Crea el esquema
│       │   └── seed.ts       # Datos realistas de ejemplo
│       └── routes/           # API REST (/api/...)
├── frontend/                 # React + TypeScript + Vite (puerto 5173)
│   └── src/
│       ├── styles/           # Design tokens "Warm Culinary Intelligence"
│       ├── components/       # Sidebar, TopBar, ServiceStatus...
│       ├── lib/api.ts        # Cliente de la API
│       └── pages/            # Las 6 pantallas del diseño
├── docs/
│   └── ESPECIFICACIONES.md    # Specs completas del sistema
└── README.md                 # ← este archivo
```

## 🚀 Puesta en marcha

### 1. Base de datos (Docker)

```bash
docker compose up -d
```

Levanta `savorai_db` (PostgreSQL 16) en **localhost:5433** con usuario/contraseña/BD: `savorai`.

### 2. Backend

```bash
cd backend
npm install
npm run db:init      # crea las 42 tablas
npm run db:seed      # carga datos de ejemplo
npm run dev          # http://localhost:3001
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

## 🗄️ Base de datos

- **Motor:** PostgreSQL 16
- **Esquema:** `backend/src/db/schema.sql` — 42 tablas, 20 ENUMs, índices de consulta
- **Módulos:** Base/organización · Menú · Inventario · Pedidos · Pagos · CRM/Reservas · IA · Soporte
- **Specs del modelo:** [`docs/ESPECIFICACIONES.md`](docs/ESPECIFICACIONES.md)

Ver las tablas en acción:

```bash
docker exec -it savorai_db psql -U savorai -d savorai
\dt                # listar tablas
SELECT * FROM mesas LIMIT 5;
```

## 🤖 Agente IA

El asistente operativo se conecta a TPV, KDS, inventario y sensores de patio:

| Función | Tablas | Endpoint |
|---|---|---|
| Chat conversacional | `conversaciones_ia`, `mensajes_ia` | `POST /api/ia/chat` |
| Recomendaciones accionables | `recomendaciones_ia` | `GET /api/ia/recomendaciones` |
| Predicción de ocupación | `predicciones_demanda` | `GET /api/ia/predicciones` |

Toda recomendación queda **trazada**: estado (`pendiente → aplicada/descartada`),
confianza y acción ejecutada (avisar 86, orden a proveedor, reasignar personal…).

## 🖥️ Pantallas (réplica del diseño Stitch)

| Ruta | Pantalla |
|---|---|
| `/mesas` | Mesas & Zonas — Salón y Terraza |
| `/pedidos` | Gestión de Pedidos (KDS Kanban) |
| `/menu` | Menú & Toma de Pedidos |
| `/reservas` | Reservas & Libro de Clientes (CRM) |
| `/ia` | Agente Operativo SavorAI |
| `/analiticas` | Analíticas & Facturación Gastronómica |

## 🛠️ Comandos útiles

| Comando | Qué hace |
|---|---|
| `docker compose up -d` | Levanta PostgreSQL |
| `docker compose down` | Para PostgreSQL (conserva datos) |
| `docker compose down -v` | Para y **borra** los datos |
| `npm run db:init` | (Re)crea el esquema — borra tablas existentes |
| `npm run db:seed` | Carga datos de ejemplo |
| `npm run build` | Compila TypeScript a `dist/` |

## 📄 Licencia

Proyecto privado.
