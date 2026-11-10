/**
 * Cliente de la API SavorAI — tipado según docs/ESPECIFICACIONES.md
 * El proxy de Vite redirige /api → http://localhost:3001
 */

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.json();
}

const get = <T,>(url: string) => req<T>(url);
const post = <T,>(url: string, body: unknown) =>
  req<T>(url, { method: 'POST', body: JSON.stringify(body) });
const patch = <T,>(url: string, body: unknown) =>
  req<T>(url, { method: 'PATCH', body: JSON.stringify(body) });

// ---------- Tipos ----------
export interface Mesa {
  id: number;
  codigo: string;
  capacidad: number;
  estado: string;
  ambiente: string | null;
  posx: number;
  posy: number;
  zona: string;
  zona_corto: string;
  zona_tipo: string;
  comanda_numero: string | null;
  comensales: number | null;
  abierta_en: string | null;
  camarero: string | null;
  importe_comanda: string;
}

export interface ResumenMesas {
  total: number;
  libres: number;
  ocupadas: number;
  reservadas: number;
  cuentas: number;
  venta_activa: string;
}

export interface LineaComanda {
  id: number;
  plato: string;
  cantidad: number;
  precio: string;
  estado: string;
  partida: string;
  asiento: number | null;
  notas: string | null;
  alerta_alergeno: string | null;
  fuego: string | null;
  estacion: string | null;
}

export interface Comanda {
  id: number;
  numero: string;
  comensales: number;
  canal: string;
  estado: string;
  canal_externo: string | null;
  pedido_externo_id: string | null;
  repartidor: string | null;
  abierta_en: string;
  enviada_cocina_en: string | null;
  notas: string | null;
  mesa: string | null;
  mesa_id: number | null;
  zona: string | null;
  zona_tipo: string | null;
  camarero: string | null;
  camarero_id: number | null;
  segundos_transcurridos: number;
  lineas: LineaComanda[];
}

export interface ResumenPedidos {
  total: number;
  pendientes: number;
  en_cocina: number;
  listas: number;
  entregadas: number;
  takeaway: number;
  salon: number;
  delivery: number;
  tiempo_medio_pase_min: number;
}

export interface Plato {
  id: number;
  nombre: string;
  descripcion: string;
  precio: string;
  tiempo_prep_min: number;
  disponible: boolean;
  es_vegetariano: boolean;
  categoria_id: number;
  alergenos: string[];
  etiquetas: string[];
  raciones_restantes: number | null;
}

export interface Categoria {
  id: number;
  nombre: string;
  icono: string;
  orden: number;
  platos: Plato[];
}

export interface Reserva {
  id: number;
  fecha: string;
  hora: string;
  comensales: number;
  estado: string;
  origen: string;
  confirmada_via: string | null;
  id_externo: string | null;
  notas: string | null;
  duracion_est_min: number;
  cliente_id: number;
  cliente: string;
  telefono: string;
  nivel_vip: string;
  fidelizado: boolean;
  mesa: string | null;
  mesa_id: number | null;
  zona: string | null;
  alertas_criticas: number;
  preferencias: { clave: string; valor: string; severidad: string }[] | null;
}

export interface Cliente {
  id: number;
  nombre: string;
  telefono: string | null;
  email: string | null;
  sector: string | null;
  fecha_nacimiento: string | null;
  nivel_vip: string;
  fidelizado: boolean;
  miembro_desde: string;
  visitas_total: number;
  gasto_total: string;
  ticket_medio: string;
  ultima_visita: string | null;
  notas: string | null;
}

export interface RecomendacionIA {
  id: number;
  tipo: string;
  titulo: string;
  contenido: string;
  confianza: string;
  datos: Record<string, unknown>;
  estado: string;
  accion_ejecutada: string | null;
  creada_en: string;
  resuelta_en: string | null;
}

export interface Prediccion {
  hora: string;
  ocupacion_proyectada: string;
  ocupacion_real: string | null;
  ingresos_proyectados: string | null;
  factor_clima: { temp?: number; lluvia?: boolean } | null;
}

export interface Analiticas {
  kpis: {
    facturacion: string;
    ticket_medio: string;
    comandas: number;
    mesas_usadas: number;
    mesas_total: number;
  };
  porZona: { zona: string; tipo: string; facturacion: string; comandas: number }[];
  matrizBCG: {
    nombre: string;
    precio: string;
    costo: string;
    unidades: number;
    facturacion: string;
    margen_pct: number;
    margen_unidad: string;
    categoria: string;
  }[];
  pagos: { metodo: string; total: string; operaciones: number }[];
  serie: { hora: string; facturacion: string; comandas: number }[];
}

export interface Insumo {
  id: number;
  nombre: string;
  unidad: string;
  stock_actual: string;
  stock_minimo: string;
  costo_unitario: string;
  proveedor: string | null;
  alerta: 'critico' | 'bajo' | 'ok';
}

export interface MensajeIA {
  id: number;
  rol: 'user' | 'assistant';
  contenido: string;
  metadatos: Record<string, unknown> | null;
  creado_en: string;
}

// ---------- Endpoints ----------
export const api = {
  // Mesas
  mesas: (filtro?: { zona?: string; estado?: string }) => {
    const q = new URLSearchParams(filtro as Record<string, string>).toString();
    return get<Mesa[]>(`/mesas${q ? `?${q}` : ''}`);
  },
  resumenMesas: () => get<ResumenMesas>('/mesas/resumen'),
  actualizarMesa: (id: number, body: { estado?: string; ambiente?: string }) =>
    patch<Mesa>(`/mesas/${id}`, body),

  // Pedidos / KDS
  pedidos: (filtro?: { estado?: string; canal?: string; zona?: string }) => {
    const q = new URLSearchParams(filtro as Record<string, string>).toString();
    return get<Comanda[]>(`/pedidos${q ? `?${q}` : ''}`);
  },
  resumenPedidos: () => get<ResumenPedidos>('/pedidos/resumen'),
  cambiarEstadoPedido: (id: number, estado: string) =>
    patch<Comanda>(`/pedidos/${id}`, { estado }),
  cambiarEstadoLinea: (comandaId: number, lineaId: number, body: { estado?: string; notas?: string }) =>
    patch<LineaComanda>(`/pedidos/${comandaId}/lineas/${lineaId}`, body),
  crearPedido: (body: {
    mesa_id?: number;
    camarero_id?: number;
    comensales?: number;
    canal?: string;
    lineas: { plato_id: number; cantidad: number; asiento?: number; partida?: string; notas?: string }[];
  }) => post<Comanda>('/pedidos', body),

  // Menú
  menu: () => get<Categoria[]>('/menu'),
  plato: (id: number) => get<Plato>(`/menu/platos/${id}`),

  // Reservas
  reservas: (fecha?: string) =>
    get<{ reservas: Reserva[]; cronograma: { franja: string; total: number }[] }>(
      `/reservas${fecha ? `?fecha=${fecha}` : ''}`
    ),
  resumenReservas: () =>
    get<{ total: number; pax: number; confirmadas: number; en_curso: number; retrasadas: number; no_show: number; externas: number; grupos: number; espera_media: number }>('/reservas/resumen'),
  actualizarReserva: (id: number, body: { estado?: string; mesa_id?: number }) =>
    patch<Reserva>(`/reservas/${id}`, body),
  listaEspera: () => get<Record<string, unknown>[]>('/reservas/lista-espera'),
  notificarListaEspera: (id: number) =>
    post<Record<string, unknown>>(`/reservas/lista-espera/${id}/notificar`, {}),

  // Clientes
  clientes: (buscar?: string) =>
    get<Cliente[]>(`/clientes${buscar ? `?buscar=${encodeURIComponent(buscar)}` : ''}`),
  cliente: (id: number) =>
    get<Cliente & {
      preferencias: { tipo: string; clave: string; valor: string; severidad: string }[];
      resenas: { puntuacion: number; fecha: string; comentario: string; comanda: string | null }[];
      reservas: { fecha: string; hora: string; comensales: number; estado: string; mesa: string | null }[];
      visitas: { numero: string; abierta_en: string; mesa: string | null; total: string }[];
    }>(`/clientes/${id}`),

  // Cuentas y pagos
  cuenta: (id: number) => get<Record<string, unknown>>(`/cuentas/${id}`),
  pagarCuenta: (id: number, body: { metodo: string; monto: number; propina?: number; usuario_id?: number }) =>
    post<Record<string, unknown>>(`/cuentas/${id}/pagos`, body),
  cajaActual: () =>
    get<{ recaudacion: string; tarjeta: string; efectivo: string; cheques: string; propinas: string; facturacion: string; ticket_medio: string; comandas: number }>('/cuentas/caja/actual'),
  cierreCaja: (body: { usuario_id?: number; arqueo_real: number }) =>
    post<Record<string, unknown>>('/cuentas/caja/cierre', body),

  // Inventario
  inventario: () => get<Insumo[]>('/inventario'),
  ordenesCompra: () => get<Record<string, unknown>[]>('/inventario/ordenes'),

  // Analíticas
  analiticas: () => get<Analiticas>('/analiticas'),

  // IA
  recomendaciones: (estado?: string) =>
    get<RecomendacionIA[]>(`/ia/recomendaciones${estado ? `?estado=${estado}` : ''}`),
  aplicarRecomendacion: (id: number, accion: 'aplicada' | 'descartada') =>
    post<RecomendacionIA>(`/ia/recomendaciones/${id}/aplicar`, { accion }),
  chatIA: (mensaje: string, usuario_id?: number) =>
    post<{
      conversacion_id: number;
      respuesta: { id: number; contenido: string; creado_en: string };
      datos: Record<string, unknown>;
    }>('/ia/chat', { mensaje, usuario_id }),
  predicciones: (fecha?: string) =>
    get<Prediccion[]>(`/ia/predicciones${fecha ? `?fecha=${fecha}` : ''}`),
  estadoIA: () =>
    get<{ online: boolean; recomendaciones: { total: number; aplicadas: number; pendientes: number; confianza_media: number }; stock_critico: number; mesas: { libres: number; ocupadas: number } }>('/ia/estado'),

  health: () => get<{ db: string; service: string }>('/health'),
};
