import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type Categoria,
  type Comanda,
  type LineaComanda,
  type Mesa,
  type ResumenPedidos,
} from '../lib/api';
import {
  badgeEstado,
  desde,
  ESTADO_COMANDA,
  ESTADO_LINEA,
  eur,
  hora,
} from '../lib/format';
import { useHealth } from '../components/Stats';
import './GestionPedidos.css';

/* ------------------------------------------------------------------ */
/*  Tipos y constantes                                                 */
/* ------------------------------------------------------------------ */

type VistaKds = 'kanban' | 'lista';
type FiltroOrigen = 'todos' | 'interior' | 'exterior' | 'llevar';

const ORIGENES: { id: FiltroOrigen; label: string; icono: string }[] = [
  { id: 'todos', label: 'Todos los Pedidos', icono: '🧾' },
  { id: 'interior', label: 'Salón Interior', icono: '🍽️' },
  { id: 'exterior', label: 'Patio / Terraza', icono: '🌿' },
  { id: 'llevar', label: 'Takeaway / Llevar', icono: '🥡' },
];

const COLS: { estado: string; titulo: string; dot: string; badgeCls: string }[] = [
  { estado: 'pendiente', titulo: 'Pendientes', dot: 'var(--primary)', badgeCls: 'badge-danger' },
  { estado: 'en_cocina', titulo: 'En Cocina', dot: 'var(--success)', badgeCls: 'badge-danger' },
  { estado: 'lista', titulo: 'Listos para Servir', dot: 'var(--success)', badgeCls: 'badge-success' },
  { estado: 'entregada', titulo: 'Entregados en Mesa', dot: 'var(--neutral)', badgeCls: 'badge-neutral' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** SLA de ticket: verde <15 min · ámbar 15–25 · rojo >25 */
function slaTono(seg: number): 'ok' | 'warn' | 'bad' {
  if (seg < 900) return 'ok';
  if (seg <= 1500) return 'warn';
  return 'bad';
}

function totalComanda(c: Comanda): number {
  return c.lineas.reduce((s, l) => s + l.cantidad * Number(l.precio), 0);
}

function capTexto(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function origenLabel(c: Comanda): string {
  if (c.mesa) return `Mesa ${c.mesa.replace('-', ' ')}${c.zona ? ` · ${c.zona}` : ''}`;
  if (c.canal === 'takeaway' || c.canal === 'delivery') {
    return c.canal_externo ? `Takeaway-${capTexto(c.canal_externo)}` : 'Takeaway';
  }
  if (c.canal === 'barra') return 'Barra';
  return 'Sin mesa';
}

function matchesOrigen(c: Comanda, o: FiltroOrigen): boolean {
  if (o === 'todos') return true;
  if (o === 'llevar') return c.canal === 'takeaway' || c.canal === 'delivery';
  if (o === 'exterior') return c.zona_tipo === 'exterior';
  return c.zona_tipo !== 'exterior';
}

function iconoLinea(estado: string): string {
  switch (estado) {
    case 'servida':
    case 'lista':
      return '✓';
    case 'en_preparacion':
      return '⏱';
    case 'cancelada':
      return '✕';
    default:
      return '○';
  }
}

/** siguiente estado del flujo de una línea de comanda (o null si ya está servida) */
function siguienteEstadoLinea(estado: string): string | null {
  switch (estado) {
    case 'pendiente':
      return 'en_preparacion';
    case 'en_preparacion':
      return 'lista';
    case 'lista':
      return 'servida';
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Botón de acción por estado de comanda                              */
/* ------------------------------------------------------------------ */

function AccionComanda({
  c,
  deshabilitado,
  onCambio,
  onAviso,
}: {
  c: Comanda;
  deshabilitado: boolean;
  onCambio: (c: Comanda, nuevo: string) => void;
  onAviso: (msg: string) => void;
}) {
  if (c.estado === 'pendiente') {
    return (
      <>
        <button
          type="button"
          className="kds-iconbtn"
          title="Imprimir ticket"
          disabled={deshabilitado}
          onClick={() => onAviso(`Ticket #${c.numero} enviado a impresora 🖨️`)}
        >
          🖨️
        </button>
        <button
          type="button"
          className="kds-iconbtn"
          title="Avisar camarero"
          disabled={deshabilitado}
          onClick={() => onAviso(`Camarero avisado — ticket #${c.numero} 🔔`)}
        >
          🔔
        </button>
        <button
          type="button"
          className="btn btn-primary kds-action"
          disabled={deshabilitado}
          onClick={() => onCambio(c, 'en_cocina')}
        >
          ✓ Aceptar a Cocina
        </button>
      </>
    );
  }

  if (c.estado === 'en_cocina') {
    return (
      <>
        <button
          type="button"
          className="kds-iconbtn"
          title="Imprimir pase"
          disabled={deshabilitado}
          onClick={() => onAviso(`Pase de cocina #${c.numero} reimprimido 🖨️`)}
        >
          🖨️
        </button>
        <button
          type="button"
          className="kds-iconbtn"
          title="Priorizar"
          disabled={deshabilitado}
          onClick={() => onAviso(`Ticket #${c.numero} marcado como prioritario ❗`)}
        >
          ❗
        </button>
        <button
          type="button"
          className="btn btn-primary kds-action"
          disabled={deshabilitado}
          onClick={() => onCambio(c, 'lista')}
        >
          ✓ Marcar Todo Listo
        </button>
      </>
    );
  }

  if (c.estado === 'lista') {
    const takeaway = c.canal === 'takeaway' || c.canal === 'delivery';
    if (takeaway) {
      return (
        <button
          type="button"
          className="btn btn-success kds-action"
          disabled={deshabilitado}
          onClick={() => onCambio(c, 'entregada')}
        >
          🛵 Escanear Entrega a Repartidor
        </button>
      );
    }
    return (
      <>
        <button
          type="button"
          className="btn btn-outline kds-action"
          disabled={deshabilitado}
          onClick={() => onAviso(`Ticket de pase #${c.numero} reimprimido 🖨️`)}
        >
          Reimprimir Ticket Pase
        </button>
        <button
          type="button"
          className="btn btn-success kds-action"
          disabled={deshabilitado}
          onClick={() => onCambio(c, 'entregada')}
        >
          ✓ Confirmar Entrega
        </button>
      </>
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Tarjeta-ticket KDS                                                 */
/* ------------------------------------------------------------------ */

function TicketCard({
  c,
  seg,
  deshabilitado,
  onCambio,
  onAviso,
  onLinea,
}: {
  c: Comanda;
  seg: number;
  deshabilitado: boolean;
  onCambio: (c: Comanda, nuevo: string) => void;
  onAviso: (msg: string) => void;
  onLinea: (c: Comanda, l: LineaComanda, nuevo: string) => void;
}) {
  const alertas = c.lineas
    .map((l) => l.alerta_alergeno)
    .filter((a): a is string => !!a);
  const total = totalComanda(c);
  const tono = slaTono(seg);
  const entregadoEn = hora(new Date(Date.parse(c.abierta_en) + seg * 1000).toISOString());

  return (
    <article className={`kds-card e-${c.estado}`}>
      <div className="kds-chead">
        <span className="kds-num">#{c.numero}</span>
        {c.mesa && <span className="badge badge-outline no-dot">{origenLabel(c)}</span>}
        {c.canal !== 'salon' && c.canal !== 'barra' && (
          <span className="badge badge-dark no-dot">
            {c.canal_externo ? `Takeaway-${capTexto(c.canal_externo)}` : 'Takeaway'}
          </span>
        )}
        {c.canal === 'barra' && <span className="badge badge-outline no-dot">Barra</span>}
        {c.pedido_externo_id && (
          <span className="badge badge-outline no-dot">#{c.pedido_externo_id}</span>
        )}
        <span className={`kds-clock t-${tono}`}>⏱ {desde(seg)}</span>
        {c.estado === 'pendiente' && seg < 300 && (
          <span className="badge badge-danger no-dot">NUEVO</span>
        )}
        {c.estado === 'entregada' && <span className="kds-check">✔</span>}
      </div>

      <div className="kds-meta">
        <span>
          {c.canal === 'takeaway' || c.canal === 'delivery'
            ? `🛵 Repartidor: ${c.repartidor ?? 'Pendiente'}`
            : `👤 Cam: ${c.camarero ?? '—'}`}
        </span>
        <span>🕐 {hora(c.abierta_en)} · Hace {desde(seg)}</span>
      </div>

      {alertas.length > 0 && (
        <div className="kds-alerg">
          ⚠ {alertas[0]}
          {alertas.length > 1 ? ` (+${alertas.length - 1})` : ''}
        </div>
      )}

      <ul className="kds-lineas">
        {c.lineas.map((l) => {
          const sig = c.estado === 'entregada' ? null : siguienteEstadoLinea(l.estado);
          const etiqueta = `${ESTADO_LINEA[l.estado] ?? l.estado}${l.partida ? ` · ${l.partida}` : ''}`;
          return (
            <li key={l.id} className="kds-linea">
              <span className="kds-cant">{l.cantidad}x</span>
              <div className="kds-linfo">
                <div className="kds-lname">{l.plato}</div>
                {l.notas && <em className="kds-lnotas">{l.notas}</em>}
                {sig ? (
                  <button
                    type="button"
                    className={`kds-lestp s-${l.estado} clickable`}
                    disabled={deshabilitado}
                    title="Avanzar estado de la línea"
                    onClick={() => onLinea(c, l, sig)}
                  >
                    {etiqueta} ▸
                  </button>
                ) : (
                  <span className={`kds-lestp s-${l.estado}`}>{etiqueta}</span>
                )}
              </div>
              <div className="kds-lright">
                {(l.fuego || l.estacion) && (
                  <span className="kds-estacion">🔥 {l.fuego ?? l.estacion}</span>
                )}
                <span className={`kds-lico i-${l.estado}`} title={ESTADO_LINEA[l.estado] ?? l.estado}>
                  {iconoLinea(l.estado)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="kds-foot">
        {c.estado === 'entregada' ? (
          <div className="kds-entregado">
            <div>
              <div>Servido a las {entregadoEn} · Cam: {c.camarero ?? '—'}</div>
              <div className="kds-total">Total comanda: {eur(total)}</div>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                onAviso(`Detalle #${c.numero}: ${c.lineas.length} líneas · ${eur(total)}`)
              }
            >
              Ver detalle ›
            </button>
          </div>
        ) : (
          <AccionComanda c={c} deshabilitado={deshabilitado} onCambio={onCambio} onAviso={onAviso} />
        )}
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  Página                                                             */
/* ------------------------------------------------------------------ */

export default function GestionPedidos() {
  const [pedidos, setPedidos] = useState<Comanda[]>([]);
  const [resumen, setResumen] = useState<ResumenPedidos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vista, setVista] = useState<VistaKds>('kanban');
  const [origen, setOrigen] = useState<FiltroOrigen>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [cambiandoId, setCambiandoId] = useState<number | null>(null);

  const [tick, setTick] = useState(0);
  const [fetchAt, setFetchAt] = useState(() => Date.now());
  const ahora = useMemo(() => Date.now(), [tick]);
  const conexion = useHealth();

  /* ---------- modal de pedido manual ---------- */
  const [modal, setModal] = useState(false);
  const [menu, setMenu] = useState<Categoria[] | null>(null);
  const [modalMesas, setModalMesas] = useState<Mesa[] | null>(null);
  const [mMesa, setMMesa] = useState('');
  const [mPax, setMPax] = useState(2);
  const [mPlato, setMPlato] = useState('');
  const [mCant, setMCant] = useState(1);
  const [mLineas, setMLineas] = useState<{ plato_id: number; nombre: string; cantidad: number }[]>([]);
  const [mError, setMError] = useState<string | null>(null);
  const [mEnviando, setMEnviando] = useState(false);

  const avisar = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  const cargar = useCallback(async () => {
    try {
      const [ps, rs] = await Promise.all([api.pedidos(), api.resumenPedidos()]);
      setPedidos(ps);
      setResumen(rs);
      setFetchAt(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar los pedidos');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    const t = window.setInterval(() => void cargar(), 8000);
    return () => window.clearInterval(t);
  }, [cargar]);

  // reloj para los cronómetros (1s)
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  // datos del modal al abrirlo
  useEffect(() => {
    if (!modal) return;
    let vivo = true;
    Promise.all([api.menu(), api.mesas()])
      .then(([cats, ms]) => {
        if (!vivo) return;
        setMenu(cats);
        setModalMesas(ms.filter((m) => m.estado === 'libre'));
      })
      .catch((e: unknown) => {
        if (vivo) setMError(e instanceof Error ? e.message : 'Error al cargar menú y mesas');
      });
    return () => {
      vivo = false;
    };
  }, [modal]);

  /* ---------- derivados ---------- */

  const enJuego = useMemo(
    () => pedidos.filter((c) => c.estado !== 'cobrada' && c.estado !== 'cancelada'),
    [pedidos]
  );

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return enJuego.filter((c) => {
      if (!matchesOrigen(c, origen)) return false;
      if (!q) return true;
      return (
        c.numero.includes(q) ||
        (c.mesa ?? '').toLowerCase().includes(q) ||
        (c.zona ?? '').toLowerCase().includes(q) ||
        (c.camarero ?? '').toLowerCase().includes(q) ||
        c.lineas.some((l) => l.plato.toLowerCase().includes(q))
      );
    });
  }, [enJuego, origen, busqueda]);

  const porEstado = useMemo(
    () => ({
      pendiente: filtrados.filter((c) => c.estado === 'pendiente'),
      en_cocina: filtrados.filter((c) => c.estado === 'en_cocina'),
      lista: filtrados.filter((c) => c.estado === 'lista'),
      entregada: filtrados.filter((c) => c.estado === 'entregada'),
    }),
    [filtrados]
  );

  const conteoOrigen = useCallback(
    (o: FiltroOrigen) => enJuego.filter((c) => matchesOrigen(c, o)).length,
    [enJuego]
  );

  const platosMenu = useMemo(() => (menu ?? []).flatMap((cat) => cat.platos), [menu]);

  const segDe = useCallback(
    (c: Comanda) => c.segundos_transcurridos + Math.max(0, Math.floor((ahora - fetchAt) / 1000)),
    [ahora, fetchAt]
  );

  /* ---------- acciones ---------- */

  const cambiarEstado = useCallback(
    async (c: Comanda, nuevo: string) => {
      setCambiandoId(c.id);
      try {
        await api.cambiarEstadoPedido(c.id, nuevo);
        avisar(`#${c.numero} → ${ESTADO_COMANDA[nuevo] ?? nuevo}`);
        await cargar();
      } catch (e) {
        avisar(e instanceof Error ? e.message : 'Error al cambiar el estado');
      } finally {
        setCambiandoId(null);
      }
    },
    [avisar, cargar]
  );

  const avanzarLinea = useCallback(
    async (c: Comanda, l: LineaComanda, nuevo: string) => {
      setCambiandoId(c.id);
      try {
        await api.cambiarEstadoLinea(c.id, l.id, { estado: nuevo });
        avisar(`"${l.plato}" → ${ESTADO_LINEA[nuevo] ?? nuevo}`);
        await cargar();
      } catch (e) {
        avisar(e instanceof Error ? e.message : 'Error al actualizar la línea');
      } finally {
        setCambiandoId(null);
      }
    },
    [avisar, cargar]
  );

  const abrirModal = useCallback(() => {
    setMError(null);
    setModal(true);
  }, []);

  const cerrarModal = useCallback(() => {
    setModal(false);
    setMError(null);
    setMMesa('');
    setMPax(2);
    setMPlato('');
    setMCant(1);
    setMLineas([]);
  }, []);

  const anadirLinea = useCallback(() => {
    const plato = platosMenu.find((p) => p.id === Number(mPlato));
    if (!plato) return;
    setMLineas((prev) => {
      const i = prev.findIndex((l) => l.plato_id === plato.id);
      if (i >= 0) {
        const copia = [...prev];
        copia[i] = { ...copia[i], cantidad: copia[i].cantidad + mCant };
        return copia;
      }
      return [...prev, { plato_id: plato.id, nombre: plato.nombre, cantidad: mCant }];
    });
    setMPlato('');
    setMCant(1);
  }, [platosMenu, mPlato, mCant]);

  const crearPedido = useCallback(async () => {
    if (!mLineas.length) {
      setMError('Añade al menos una línea al pedido.');
      return;
    }
    setMEnviando(true);
    setMError(null);
    try {
      const nueva = await api.crearPedido({
        mesa_id: mMesa ? Number(mMesa) : undefined,
        comensales: mPax,
        canal: 'salon',
        lineas: mLineas.map((l) => ({ plato_id: l.plato_id, cantidad: l.cantidad })),
      });
      avisar(`Pedido #${nueva.numero} creado correctamente ✓`);
      cerrarModal();
      await cargar();
    } catch (e) {
      setMError(e instanceof Error ? e.message : 'Error al crear el pedido');
    } finally {
      setMEnviando(false);
    }
  }, [mLineas, mMesa, mPax, avisar, cerrarModal, cargar]);

  /* ---------- render ---------- */

  if (cargando && !pedidos.length) {
    return (
      <div className="app-content">
        <div className="loading">Cargando KDS…</div>
      </div>
    );
  }

  if (error && !pedidos.length) {
    return (
      <div className="app-content">
        <div className="loading">
          <div>
            <p>Error al cargar: {error}</p>
            <button
              type="button"
              className="btn btn-primary mt-2"
              onClick={() => { setCargando(true); void cargar(); }}
            >
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const enMarcha = resumen ? resumen.pendientes + resumen.en_cocina + resumen.listas : null;

  return (
    <div className="app-content kds">
      {/* ---------- cabecera ---------- */}
      <div className="kds-head">
        <div className="kds-title">
          <h1>KDS &amp; Comandas Activas</h1>
          <span className="badge badge-success kds-live">TURNO NOCHE · EN VIVO</span>
        </div>

        <div className="kds-controls">
          <div className="kds-toggle">
            <button
              type="button"
              className={vista === 'kanban' ? 'active' : ''}
              onClick={() => setVista('kanban')}
            >
              ▦ Tablero Kanban
            </button>
            <button
              type="button"
              className={vista === 'lista' ? 'active' : ''}
              onClick={() => setVista('lista')}
            >
              ☰ Lista Cocina
            </button>
          </div>

          <div className="kds-search">
            <span>🔍</span>
            <input
              type="search"
              placeholder="Buscar ticket o mesa (#1042, M5)"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>

          <button type="button" className="btn btn-primary" onClick={abrirModal}>
            🛒 Nuevo Pedido Manual
          </button>
        </div>
      </div>

      {/* ---------- alerta IA ---------- */}
      <div className="kds-alerta">
        <span className="a-ico">🪄</span>
        <div className="a-body">
          <div className="a-title">
            ALERTA INTELIGENTE SavorAI <span className="a-badge">Desviación +6m</span>
          </div>
          <div className="a-text">
            Demora acumulada en Partida Calientes (Platos principales superan en +6 min el
            promedio). Sugerido adelantar tiempos de pase y reforzar la parrilla.
          </div>
        </div>
        <div className="a-btns">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => avisar('Tiempos de pase ajustados: +6 min aplicados a Partida Calientes')}
          >
            Ajustar Tiempos
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => avisar('Prioridad enviada a la estación Parrilla 🔥')}
          >
            Priorizar Parrilla
          </button>
        </div>
      </div>

      {/* ---------- filtros + KPIs ---------- */}
      <div className="kds-filters">
        {ORIGENES.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`filter-chip ${origen === o.id ? 'active' : ''}`}
            onClick={() => setOrigen(o.id)}
          >
            <span>{o.icono}</span> {o.label} <span className="count">{conteoOrigen(o.id)}</span>
          </button>
        ))}

        <div className="kds-kpis">
          <div className="kds-kpi">
            <span className="lbl">Comandas en marcha:</span>
            <span className="val">{enMarcha ?? '—'}</span>
          </div>
          <div className="kds-kpi">
            <span className="lbl">Tiempo medio pase:</span>
            <span className="val">
              {resumen ? desde(resumen.tiempo_medio_pase_min * 60) : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* ---------- tablero / lista ---------- */}
      {vista === 'kanban' ? (
        <div className="kds-cols">
          {COLS.map((col) => {
            const items = porEstado[col.estado as 'pendiente' | 'en_cocina' | 'lista' | 'entregada'];
            return (
              <section key={col.estado} className={`kds-col c-${col.estado}`}>
                <header className="kds-col-head">
                  <i className="dot" style={{ background: col.dot }} />
                  <h3>{col.titulo}</h3>
                  <span className={`badge ${col.badgeCls}`}>
                    {col.estado === 'entregada' ? `Últimos ${items.length}` : `${items.length} comandas`}
                  </span>
                </header>
                <div className="kds-col-body">
                  {items.length === 0 ? (
                    <div className="kds-empty">Sin comandas en esta columna</div>
                  ) : (
                    items.map((c) => (
                      <TicketCard
                        key={c.id}
                        c={c}
                        seg={segDe(c)}
                        deshabilitado={cambiandoId === c.id}
                        onCambio={(com, nuevo) => void cambiarEstado(com, nuevo)}
                        onAviso={avisar}
                        onLinea={(com, l, nuevo) => void avanzarLinea(com, l, nuevo)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="kds-lista-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Estado</th>
                <th>Origen</th>
                <th>Camarero</th>
                <th>Tiempo</th>
                <th>Líneas</th>
                <th>Total</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => {
                const seg = segDe(c);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong className="kds-num-sm">#{c.numero}</strong>
                    </td>
                    <td>
                      <span className={`badge ${badgeEstado(c.estado)}`}>
                        {ESTADO_COMANDA[c.estado] ?? c.estado}
                      </span>
                    </td>
                    <td>{origenLabel(c)}</td>
                    <td>{c.camarero ?? '—'}</td>
                    <td>
                      <span className={`kds-clock t-${slaTono(seg)}`}>⏱ {desde(seg)}</span>
                    </td>
                    <td>{c.lineas.length}</td>
                    <td>{eur(totalComanda(c))}</td>
                    <td>
                      <div className="kds-foot">
                        {c.estado === 'entregada' ? (
                          <span className="text-sm text-muted">
                            Servido a las {hora(new Date(Date.parse(c.abierta_en) + seg * 1000).toISOString())}
                          </span>
                        ) : (
                          <AccionComanda
                            c={c}
                            deshabilitado={cambiandoId === c.id}
                            onCambio={(com, nuevo) => void cambiarEstado(com, nuevo)}
                            onAviso={avisar}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-muted" style={{ textAlign: 'center' }}>
                    Sin pedidos para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- pie ---------- */}
      <footer className="kds-footer">
        <div className="kds-legend">
          <span><i className="ld" style={{ background: 'var(--success)' }} /> SLA &lt; 15 min (Normal)</span>
          <span><i className="ld" style={{ background: 'var(--warning)' }} /> SLA 15–25 min (Atención)</span>
          <span><i className="ld" style={{ background: 'var(--primary)' }} /> SLA &gt; 25 min (Crítico)</span>
        </div>
        <div className="kds-conn">
          Conexión KDS Cocina:{' '}
          <span className={`badge ${conexion === false ? 'badge-danger' : 'badge-success'}`}>
            {conexion === false ? 'Sin conexión' : 'Fibra Local 1Gbps · 0ms lag'}
          </span>
        </div>
      </footer>

      {toast && <div className="kds-toast">{toast}</div>}

      {/* ---------- modal nuevo pedido manual ---------- */}
      {modal && (
        <div
          className="kds-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) cerrarModal();
          }}
        >
          <div className="kds-modal" role="dialog" aria-modal="true" aria-label="Nuevo pedido manual">
            <div className="row-between">
              <h2>Nuevo Pedido Manual</h2>
              <button type="button" className="kds-closebtn" onClick={cerrarModal} title="Cerrar">
                ✕
              </button>
            </div>
            <p className="text-sm text-muted">
              Crea una comanda para salón, barra o takeaway. Se numerará automáticamente.
            </p>

            {mError && <div className="kds-merror">⚠ {mError}</div>}

            <div className="kds-form-row">
              <div className="kds-field">
                <label htmlFor="kds-mesa">Mesa</label>
                <select id="kds-mesa" value={mMesa} onChange={(e) => setMMesa(e.target.value)}>
                  <option value="">Sin mesa (takeaway)</option>
                  {(modalMesas ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.codigo} · {m.zona_corto} · {m.capacidad} pax
                    </option>
                  ))}
                </select>
              </div>
              <div className="kds-field">
                <label htmlFor="kds-pax">Comensales</label>
                <input
                  id="kds-pax"
                  type="number"
                  min={1}
                  max={20}
                  value={mPax}
                  onChange={(e) => setMPax(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
                />
              </div>
            </div>

            <div className="kds-form-row">
              <div className="kds-field">
                <label htmlFor="kds-plato">Plato</label>
                <select id="kds-plato" value={mPlato} onChange={(e) => setMPlato(e.target.value)}>
                  <option value="">
                    {menu ? 'Elegir plato…' : 'Cargando menú…'}
                  </option>
                  {platosMenu.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} · {eur(p.precio)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="kds-field">
                <label htmlFor="kds-cant">Cantidad</label>
                <input
                  id="kds-cant"
                  type="number"
                  min={1}
                  max={20}
                  value={mCant}
                  onChange={(e) => setMCant(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
                />
              </div>
            </div>

            <button
              type="button"
              className="btn btn-outline mt-2"
              disabled={!mPlato}
              onClick={anadirLinea}
            >
              ＋ Añadir línea
            </button>

            {mLineas.length > 0 && (
              <ul className="kds-mlines">
                {mLineas.map((l, i) => (
                  <li key={l.plato_id}>
                    <span>
                      <strong>{l.cantidad}x</strong> {l.nombre}
                    </span>
                    <button
                      type="button"
                      title="Quitar línea"
                      onClick={() => setMLineas((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="kds-modal-foot">
              <button type="button" className="btn btn-ghost" onClick={cerrarModal}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={mEnviando || mLineas.length === 0}
                onClick={() => void crearPedido()}
              >
                {mEnviando ? 'Creando…' : 'Crear Pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
