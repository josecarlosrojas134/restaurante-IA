/** Helpers de formato compartidos por todas las pantallas */

export const eur = (v: string | number, dec = 2) =>
  new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(Number(v));

export const eur0 = (v: string | number) => eur(v, 0);

export const num = (v: string | number, dec = 0) =>
  new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(Number(v));

export const pct = (v: string | number) => `${num(v, 0)}%`;

/** segundos → "14m" / "1h 22m" / "42s" */
export function desde(segundos: number): string {
  if (segundos < 60) return `${Math.max(0, Math.floor(segundos))}s`;
  const m = Math.floor(segundos / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "2026-11-10T20:38:00Z" → "20:38" */
export function hora(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const fechaLarga = (d = new Date()) =>
  d.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });

/** Estados de comanda → etiqueta ES */
export const ESTADO_COMANDA: Record<string, string> = {
  pendiente: 'Pendiente',
  en_cocina: 'En Cocina',
  lista: 'Listo para Servir',
  entregada: 'Entregada',
  cobrada: 'Cobrada',
  cancelada: 'Cancelada',
};

export const ESTADO_MESA: Record<string, string> = {
  libre: 'Libre',
  ocupada: 'Ocupada',
  reservada: 'Reservada',
  cuenta_solicitada: 'Cuenta',
  limpieza: 'Limpieza',
  mantenimiento: 'Mantenimiento',
};

export const ESTADO_RESERVA: Record<string, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  en_curso: 'En Curso',
  atendida: 'Atendida',
  retrasada: 'Retrasada',
  no_show: 'No-Show',
  cancelada: 'Cancelada',
};

export const ESTADO_LINEA: Record<string, string> = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparación',
  lista: 'Lista',
  servida: 'Servida',
  cancelada: 'Cancelada',
};

export const METODO_PAGO: Record<string, string> = {
  tarjeta: 'Tarjeta / Contactless',
  efectivo: 'Efectivo en Caja',
  cheque_gourmet: 'Cheques Gourmet',
  digital: 'Cheques & Digital',
  bizum: 'Bizum',
};

/** Color de badge según estado */
export function badgeEstado(estado: string): string {
  const mapa: Record<string, string> = {
    libre: 'badge-success',
    lista: 'badge-success',
    entregada: 'badge-success',
    cobrada: 'badge-success',
    confirmada: 'badge-success',
    atendida: 'badge-success',
    en_cocina: 'badge-warning',
    en_preparacion: 'badge-warning',
    en_curso: 'badge-warning',
    pendiente: 'badge-neutral',
    reservada: 'badge-neutral',
    cuenta_solicitada: 'badge-danger',
    retrasada: 'badge-danger',
    cancelada: 'badge-danger',
    no_show: 'badge-danger',
    servida: 'badge-success',
  };
  return mapa[estado] || 'badge-neutral';
}
