# SavorAI — Especificaciones del Sistema

> Sistema web de gestión de restaurante con asistente de IA
> Versión del documento: 1.0 · Basado en el diseño Stitch "Warm Culinary Intelligence" (6 pantallas)

---

## 1. Visión general

SavorAI es una plataforma de operación gastronómica para restaurantes que cubre el ciclo completo
desde la reserva hasta el cierre de caja, con un agente de IA integrado que audita en tiempo real
y genera recomendaciones accionables.

**Stack tecnológico**

| Capa | Tecnología |
|---|---|
| Base de datos | PostgreSQL 16 (Docker, puerto 5433) |
| Backend | Node.js + Express + TypeScript |
| Frontend | React 19 + TypeScript + Vite |
| Diseño | Design system "Warm Culinary Intelligence" (Stitch) |

## 2. Módulos funcionales

### 2.1 Mesas & Zonas
- Mapa de mesas por zona: **Salón Interior (18)** y **Patio/Terraza (12)**, total 30.
- Estados: `libre`, `ocupada`, `reservada`, `cuenta_solicitada`, `limpieza`, `mantenimiento`.
- Tarjeta de detalle de mesa con: titular de la comanda, comensales, tiempo sentado, comanda activa
  con estado por línea (servido / en cocina con tiempo de pase), acciones
  (añadir items, cobrar, transferir, liberar mesa).
- Métricas en vivo: ocupación %, tiempo medio de permanencia, venta activa €.
- Recomendación IA contextual: disponibilidad sugerida por zona.

### 2.2 Gestión de Pedidos (KDS)
- Tablero Kanban con 4 columnas: **Pendientes → En Cocina → Listos para Servir → Entregados**.
- Filtros por canal: Salón, Patio/Terraza, Takeaway/Llevar (Glovo, UberEats).
- Ticket con: número, mesa/zona, camarero, cronómetro, alérgenos críticos, líneas con
  modificaciones ("poco hecho", "sin picante"), estación de cocina (Fuego 4, Horno B…).
- Estados de línea: `pendiente → en_preparacion → lista → servida`.
- Alerta IA de desviación de tiempos SLA (<15 min normal, 15–25 atención, >25 crítico).
- Acciones: aceptar a cocina, marcar listo, avisar camarero, imprimir pase, confirmar entrega,
  escanear entrega a repartidor.

### 2.3 Menú & Toma de Pedidos
- Categorías: Entrantes & Tapas, Carnes & Brasas, Pescados & Mariscos, Postres (…).
- Tarjeta de plato: imagen, precio, descripción, alérgenos, etiquetas
  (Top Ventas, Especial Chef, Vegetariano…), tiempo de prep, contador de raciones restantes.
- Filtros de dieta: Sin Gluten, Vegano, Sin Lactosa.
- **Comanda activa** lateral con: asignación por asiento, partida (entrante/principal),
  notas de modificación, subtotal + IVA 10% + total.
- Acciones: enviar a cocina, pre-cuenta, cobro rápido, cambiar mesa, dividir cuenta.
- Sugerencia IA de ritmo de brasas + maridaje inteligente (match %).

### 2.4 Reservas & Clientes (CRM)
- Reservas por fecha/turno con cronograma horario (20:00, 20:30, 21:00…).
- Estados: `pendiente, confirmada, en_curso, atendida, retrasada, no_show, cancelada`.
- Origen: manual, TheFork, Google, teléfono, web, IA.
- Ficha de cliente: visitas, gasto acumulado, ticket medio, nivel VIP, sector, cumpleaños,
  preferencias registradas, últimas visitas con reseña (estrellas), notas del maître.
- Alertas médicas (alergias críticas) visibles en reserva y comanda.
- Lista de espera inteligente: posición, tiempo estimado, notificación SMS.
- Sincronización TheFork/Google, exportación del libro, alta manual.

### 2.5 Cuentas y Pagos
- Cuenta agrupa 1..N comandas; estados: `abierta, cuenta_solicitada, dividida, cobrada`.
- IVA restauración 10% calculado por cuenta.
- Métodos de pago: tarjeta/contactless, efectivo, cheques gourmet & digital, bizum.
- Reparto de propinas entre miembros de sala y cocina.
- **Cierre de caja (Turno Z)**: recaudación neta, IVA repercutido, base imponible,
  desglose por método, propinas, arqueo y diferencia de auditoría.

### 2.6 Inventario
- Insumos con stock actual/mínimo, unidad, costo unitario, proveedor.
- Recetas: plato → insumo → cantidad por ración (habilita "raciones restantes" y alertas 86).
- Movimientos con auditoría: entrada, salida, ajuste, merma, pedido.
- Órdenes de compra con líneas; puede ser generada por la IA (`origen_ia`).

### 2.7 Asistente IA (Agente Operativo)
- **Chat conversacional** (`conversaciones_ia`, `mensajes_ia`): el usuario pregunta
  ("¿Mesas libres en Patio?", "Plato más rentable del turno") y el agente responde
  citando datos operativos.
- **Recomendaciones** (`recomendaciones_ia`): tipo, contenido, confianza 0–100,
  payload JSON, estado `pendiente → aplicada/descartada` y acción ejecutada
  (notificar 86, orden a proveedor, abrir mesas, reasignar personal).
- **Predicciones** (`predicciones_demanda`): ocupación proyectada por fecha/zona/hora
  con factor clima, para la gráfica "Ocupación Proyectada vs. Real".
- Conexión declarada a TPV, sensores de patio, KDS e inventario en tiempo real.

### 2.8 Analíticas & Facturación
- KPIs: facturación bruta, ticket medio comensal, rotación de mesas, ocupación pico,
  upselling (sugerencias lanzadas/servidas, conversión %).
- Rendimiento comparativo por zona (gráfico horario de barras).
- **Matriz de ingeniería de menú** (BCG gastronómico): unidades, margen bruto, facturación
  → clasificación Estrella / Caballo de Batalla / Puzle / Perro.
- Agente predictivo: proyección de fin de semana, directivas operativas
  (aprovisionamiento crítico, refuerzo de brigada).
- Cierre de caja y exportación de informes (PDF/XLS).

## 3. Modelo de datos

42 tablas en 8 módulos. Ver `backend/src/db/schema.sql` para el DDL completo.

| Módulo | Tablas principales |
|---|---|
| Base | `locales`, `zonas`, `mesas`, `usuarios`, `turnos`, `asignaciones_turno` |
| Menú | `categorias_menu`, `platos`, `alergenos`, `etiquetas`, `recetas`, `estaciones` |
| Inventario | `proveedores`, `insumos`, `movimientos_inventario`, `ordenes_compra` |
| Pedidos | `comandas`, `lineas_comanda`, `historial_estados_comanda`, `descuentos_comanda` |
| Pagos | `cuentas`, `pagos`, `metodos_pago` (enum), `reparto_propinas`, `cierres_caja` |
| CRM | `clientes`, `preferencias_cliente`, `reservas`, `reserva_mesas`, `lista_espera`, `resenas` |
| IA | `conversaciones_ia`, `mensajes_ia`, `recomendaciones_ia`, `predicciones_demanda` |
| Soporte | `notificaciones`, `exportaciones_informes`, `dispositivos_iot` |

### Decisiones de modelado
1. **Raciones restantes** se deriva: `insumo.stock_actual / receta.cantidad` (no hay tabla de stock por plato).
2. **Analíticas sin tablas propias**: vistas SQL sobre `comandas + pagos`.
3. **SLA/timers KDS** derivan de `historial_estados_comanda`.
4. **Delivery externo** (Glovo/UberEats): `comandas.canal_externo + pedido_externo_id`.
5. **Estados cerrados** como ENUM de PostgreSQL.

## 4. API REST (prefijo `/api`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/mesas` | Mapa de mesas (filtros: zona, estado) |
| PATCH | `/mesas/:id` | Cambiar estado/asignación de mesa |
| GET | `/pedidos` | Comandas para KDS (filtros: estado, canal, zona) |
| POST | `/pedidos` | Crear comanda (manual o desde toma de pedidos) |
| PATCH | `/pedidos/:id` | Cambiar estado de comanda |
| PATCH | `/pedidos/:id/lineas/:lineaId` | Estado/nota de línea individual |
| GET | `/menu` | Categorías + platos con alérgenos y etiquetas |
| GET | `/menu/platos/:id` | Detalle de plato (raciones restantes) |
| GET | `/reservas?fecha=` | Reservas del día + cronograma |
| POST | `/reservas` | Alta de reserva |
| PATCH | `/reservas/:id` | Estado de reserva (sentar, no-show…) |
| GET | `/clientes` | Lista/CRM de clientes |
| GET | `/clientes/:id` | Ficha completa con preferencias y reseñas |
| GET | `/cuentas/:id` | Cuenta con comandas e IVA |
| POST | `/cuentas/:id/pagos` | Registrar pago (método, propina, split) |
| POST | `/cierre-caja/:turnoId` | Cierre Turno Z |
| GET | `/inventario` | Insumos con stock y alertas mínimas |
| GET | `/inventario/stock/:platoId` | Raciones restantes de un plato |
| POST | `/ordenes-compra` | Crear orden (acepta `origen_ia`) |
| GET | `/analiticas?desde=&hasta=` | KPIs, matriz BCG, rendimiento por zona |
| GET | `/ia/recomendaciones` | Recomendaciones pendientes/históricas |
| POST | `/ia/recomendaciones/:id/aplicar` | Marcar aplicada + ejecutar acción |
| POST | `/ia/chat` | Mensaje al agente (guarda conversación) |
| GET | `/ia/predicciones?fecha=` | Ocupación proyectada vs real |

## 5. Requisitos no funcionales

- **Tiempo real**: KDS y mapa de mesas se refrescan cada 5–10 s (polling inicial; SSE/WebSocket como mejora).
- **Rendimiento de pase**: SLA de referencia < 15 min; alerta automática al superar 25 min.
- **Trazabilidad IA**: toda recomendación queda registrada con estado y acción ejecutada.
- **Auditoría fiscal**: `cierres_caja` guarda IVA, base y diferencia de arqueo sin posibilidad de edición posterior (UNIQUE por turno).
- **Seguridad**: roles (`admin, jefe_sala, camarero, cocina, caja`) — el backend valida rol por ruta (v1: middleware básico).

## 6. Fuente del diseño

Carpeta `stitch_sistema_web_restaurante_con_ia.zip` → 6 pantallas + design system:

| Pantalla | Ruta frontend |
|---|---|
| Menú & Toma de Pedidos | `/menu` |
| Mesas & Zonas (Salón y Terraza) | `/mesas` |
| Gestión de Pedidos (KDS) | `/pedidos` |
| Asistente IA | `/ia` |
| Reservas & Clientes CRM | `/reservas` |
| Analíticas & Facturación | `/analiticas` |
