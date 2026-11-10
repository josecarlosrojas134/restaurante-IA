import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Insumo, type Prediccion, type RecomendacionIA } from '../lib/api';
import { eur, hora, num, pct } from '../lib/format';
import './AsistenteIA.css';

/* ---------- Tipos derivados del cliente API (sin repetir definiciones) ---------- */
type EstadoIA = Awaited<ReturnType<typeof api.estadoIA>>;
type ResumenPedidos = Awaited<ReturnType<typeof api.resumenPedidos>>;
type CajaTurno = Awaited<ReturnType<typeof api.cajaActual>>;
type ComandaRow = Awaited<ReturnType<typeof api.pedidos>>[number];

interface ChatMsg {
  id: number;
  rol: 'user' | 'assistant';
  contenido: string;
  datos: Record<string, unknown> | null;
  ts: number;
}

interface ZonaTiempo {
  nombre: string;
  min: number;
  camareros: number;
}

const QUERY_INICIAL =
  '¿Cómo viene el rendimiento de cocina y qué mesas de 4 tenemos operativas en patio ahora mismo?';

const CONSULTAS: { icono: string; texto: string }[] = [
  { icono: '🪑', texto: '¿Mesas libres en Patio (4 pax)?' },
  { icono: '📈', texto: 'Plato más rentable del turno' },
  { icono: '🌤️', texto: 'Clima Patio & Sugerencias' },
  { icono: '⚠️', texto: 'Stock crítico de cocina' },
  { icono: '📊', texto: 'Ocupación y reservas de hoy' },
];

/* ---------- Guardas: los metadatos del chat llegan tipados como unknown ---------- */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function listaDe(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

const str = (v: unknown): string =>
  typeof v === 'string' ? (v.length ? v : '—') : v == null ? '—' : String(v);

const toNum = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));

function textoCorto(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const j = JSON.stringify(v);
    return j.length > 110 ? `${j.slice(0, 110)}…` : j;
  } catch {
    return '—';
  }
}

function hace(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'Ahora mismo';
  if (m < 60) return `Hace ${m} min`;
  return `Hace ${Math.floor(m / 60)} h`;
}

/* ============================================================
   Bloque de "datos" adjuntos a la respuesta del asistente
   ============================================================ */
function BloqueDatos({ datos }: { datos: Record<string, unknown> }) {
  const bloques: ReactNode[] = [];

  // --- Mesas libres → tarjetas de mesa ---
  const mesas = listaDe(datos.mesas_libres);
  if (mesas.length) {
    bloques.push(
      <div className="ia-dato-card" key="mesas">
        <div className="ia-dato-head">
          <span className="ia-dato-title">🪑 Mesas Disponibles Recomendadas</span>
          <span className="badge badge-success no-dot">Listas para sentar</span>
        </div>
        <div className="ia-mesas-grid">
          {mesas.map((m, i) => (
            <article className="ia-mesa-card" key={i}>
              <div className="ia-mesa-top">
                <h4>Mesa {str(m.codigo)}</h4>
                <span className="badge badge-success">{str(m.zona)}</span>
              </div>
              <p>Capacidad: {num(toNum(m.capacidad))} personas</p>
              {typeof m.ambiente === 'string' && m.ambiente ? (
                <p className="ia-mesa-amb">{m.ambiente}</p>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    );
  }

  // --- Top platos → tabla ---
  const top = listaDe(datos.top_platos);
  if (top.length) {
    bloques.push(
      <div className="ia-dato-card" key="top">
        <div className="ia-dato-head">
          <span className="ia-dato-title">🍴 Top de Facturación del Turno</span>
          <span className="badge badge-neutral no-dot">Datos en vivo</span>
        </div>
        <table className="ia-mini-table">
          <thead>
            <tr>
              <th>Plato / Elaboración</th>
              <th>Unidades</th>
              <th>Facturación</th>
            </tr>
          </thead>
          <tbody>
            {top.map((t, i) => (
              <tr key={i}>
                <td>{str(t.nombre)}</td>
                <td>{num(toNum(t.unidades))} uds</td>
                <td>{eur(str(t.facturacion))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // --- Stock crítico → alerta roja ---
  const stock = listaDe(datos.stock_critico);
  if (stock.length) {
    bloques.push(
      <div className="ia-dato-alerta" key="stock">
        <div className="ia-dato-head">
          <span className="ia-dato-title">⚠️ Alerta Crítica de Stock</span>
          <span className="badge badge-danger no-dot">{stock.length} insumos</span>
        </div>
        <ul>
          {stock.map((s, i) => (
            <li key={i}>
              <strong>{str(s.nombre)}</strong> — quedan{' '}
              <strong>
                {num(toNum(s.stock_actual), 1)} {str(s.unidad)}
              </strong>{' '}
              (mínimo {num(toNum(s.stock_minimo), 1)})
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // --- Ocupación / reservas ---
  const occ = isRecord(datos.ocupacion) ? datos.ocupacion : null;
  const resv = isRecord(datos.reservas) ? datos.reservas : null;
  if (occ || resv) {
    const chips: ReactNode[] = [];
    if (occ) {
      const ocupadas = toNum(occ.ocupadas);
      const total = toNum(occ.total);
      chips.push(
        <span className="ia-dchip" key="occ">
          <em>Ocupación</em> {num(ocupadas)}/{num(total)} mesas
          {total > 0 ? ` · ${pct(Math.round((ocupadas / total) * 100))}` : ''}
        </span>
      );
    }
    if (resv) {
      chips.push(
        <span className="ia-dchip" key="res">
          <em>Reservas hoy</em> {num(toNum(resv.total))} · {num(toNum(resv.pax))} pax
        </span>
      );
    }
    bloques.push(
      <div className="ia-dato-chips" key="occ-res">
        {chips}
      </div>
    );
  }

  // --- Brigada ---
  const brigada = listaDe(datos.brigada);
  if (brigada.length) {
    bloques.push(
      <div className="ia-dato-card" key="brigada">
        <div className="ia-dato-head">
          <span className="ia-dato-title">👥 Brigada del Turno</span>
        </div>
        <ul className="ia-brigada">
          {brigada.map((b, i) => (
            <li key={i}>
              <strong>{str(b.nombre)}</strong>
              <span>
                {str(b.rol)}
                {b.zona ? ` · ${str(b.zona)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // --- Resumen general ---
  if (isRecord(datos.resumen)) {
    const r = datos.resumen;
    bloques.push(
      <div className="ia-dato-chips" key="resumen">
        <span className="ia-dchip">
          <em>Comandas activas</em> {num(toNum(r.activas))}
        </span>
        <span className="ia-dchip">
          <em>Pendientes</em> {num(toNum(r.pendientes))}
        </span>
        <span className="ia-dchip">
          <em>Lista espera</em> {num(toNum(r.espera))}
        </span>
        <span className="ia-dchip">
          <em>Sugerencias IA</em> {num(toNum(r.sugerencias))}
        </span>
      </div>
    );
  }

  // --- Clima ---
  if (isRecord(datos.clima)) {
    const c = datos.clima;
    bloques.push(
      <div className="ia-dato-chips" key="clima">
        <span className="ia-dchip">
          <em>Sensor patio</em> {num(toNum(c.temp))}°C
        </span>
        <span className="ia-dchip">
          <em>Lluvia</em> {c.lluvia ? 'Sí' : 'No'}
        </span>
        {typeof c.viento === 'string' ? (
          <span className="ia-dchip">
            <em>Viento</em> {c.viento}
          </span>
        ) : null}
      </div>
    );
  }

  // --- Resto de claves → chips genéricos ---
  const vistas = new Set([
    'mesas_libres',
    'top_platos',
    'stock_critico',
    'ocupacion',
    'reservas',
    'brigada',
    'resumen',
    'clima',
    'error',
  ]);
  const resto = Object.entries(datos).filter(([k]) => !vistas.has(k));
  if (resto.length) {
    bloques.push(
      <div className="ia-dato-chips" key="resto">
        {resto.map(([k, v]) => (
          <span className="ia-dchip" key={k}>
            <em>{k}</em> {textoCorto(v)}
          </span>
        ))}
      </div>
    );
  }

  if (!bloques.length) return null;
  return <div className="ia-datos">{bloques}</div>;
}

/* ============================================================
   Gráfico SVG: ocupación proyectada vs. real
   ============================================================ */
function GraficoOcupacion({ predicciones }: { predicciones: Prediccion[] }) {
  if (!predicciones.length) {
    return <div className="loading">Sin predicciones disponibles para hoy…</div>;
  }

  const W = 640;
  const H = 210;
  const PL = 38;
  const PR = 16;
  const PT = 16;
  const PB = 30;

  const pts = predicciones.map((p, i) => ({
    x: PL + (i * (W - PL - PR)) / Math.max(1, predicciones.length - 1),
    y: PT + (1 - Math.min(100, toNum(p.ocupacion_proyectada)) / 100) * (H - PT - PB),
    p,
  }));

  const linea = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
  const area = `${linea} L ${pts[pts.length - 1].x.toFixed(1)} ${H - PB} L ${pts[0].x.toFixed(1)} ${H - PB} Z`;

  const conReal = predicciones.some((p) => p.ocupacion_real != null);
  const lineaReal = conReal
    ? pts
        .filter((pt) => pt.p.ocupacion_real != null)
        .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
        .join(' ')
    : '';

  // pico proyectado
  let iPico = 0;
  pts.forEach((pt, i) => {
    if (toNum(pt.p.ocupacion_proyectada) > toNum(pts[iPico].p.ocupacion_proyectada)) iPico = i;
  });
  const pico = pts[iPico];

  return (
    <div className="ia-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="ia-chart-svg" role="img" aria-label="Ocupación proyectada por hora">
        <defs>
          <linearGradient id="ia-occ-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* rejilla */}
        {[100, 50, 0].map((g) => {
          const y = PT + (1 - g / 100) * (H - PT - PB);
          return (
            <g key={g}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="var(--surface-container-highest)" strokeDasharray="4 4" />
              <text x={PL - 8} y={y + 3} textAnchor="end" className="ia-chart-y">
                {g}%
              </text>
            </g>
          );
        })}

        <path d={area} fill="url(#ia-occ-fill)" />
        <path d={linea} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" />
        {conReal && lineaReal ? (
          <path d={lineaReal} fill="none" stroke="var(--tertiary)" strokeWidth="2" strokeDasharray="5 4" />
        ) : null}

        {/* pico marcado */}
        <line
          x1={pico.x}
          y1={PT}
          x2={pico.x}
          y2={H - PB}
          stroke="var(--primary)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <circle cx={pico.x} cy={pico.y} r="5" fill="var(--primary)" />
        <text
          x={Math.min(pico.x + 8, W - PR - 96)}
          y={Math.max(pico.y - 10, PT + 10)}
          className="ia-chart-peak"
        >
          Pico {pico.p.hora} · {pct(toNum(pico.p.ocupacion_proyectada))}
        </text>

        {/* eje X */}
        {pts.map((pt, i) => (
          <text key={i} x={pt.x} y={H - 8} textAnchor="middle" className="ia-chart-x">
            {pt.p.hora}
          </text>
        ))}
      </svg>
      <div className="ia-chart-legend">
        <span className="lg-proy">● Ocupación proyectada</span>
        <span className={conReal ? 'lg-real' : 'lg-real off'}>
          {conReal ? '▮ Ocupación real registrada' : 'Real: sin datos registrados'}
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   Página
   ============================================================ */
export default function AsistenteIA() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [estado, setEstado] = useState<EstadoIA | null>(null);
  const [predicciones, setPredicciones] = useState<Prediccion[]>([]);
  const [inventario, setInventario] = useState<Insumo[]>([]);
  const [pendientes, setPendientes] = useState<RecomendacionIA[]>([]);
  const [aplicadas, setAplicadas] = useState<number[]>([]);
  const [resumenPedidos, setResumenPedidos] = useState<ResumenPedidos | null>(null);
  const [caja, setCaja] = useState<CajaTurno | null>(null);
  const [pedidos, setPedidos] = useState<ComandaRow[]>([]);

  const [mensajes, setMensajes] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [escribiendo, setEscribiendo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [filtrosTurno, setFiltrosTurno] = useState(false);
  const [ahora, setAhora] = useState(() => hora(new Date().toISOString()));

  const seq = useRef(0);
  const arrancado = useRef(false);
  const chatRef = useRef<HTMLDivElement | null>(null);

  /* ---------- Carga inicial de paneles ---------- */
  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const [est, preds, inv, recs, resumen, cajaAct, comandas] = await Promise.all([
        api.estadoIA(),
        api.predicciones(),
        api.inventario(),
        api.recomendaciones('pendiente'),
        api.resumenPedidos(),
        api.cajaActual(),
        api.pedidos(),
      ]);
      setEstado(est);
      setPredicciones(preds);
      setInventario(inv);
      setPendientes(recs);
      setResumenPedidos(resumen);
      setCaja(cajaAct);
      setPedidos(comandas);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  /* ---------- Chat ---------- */
  function pushMensaje(m: Omit<ChatMsg, 'id'>) {
    seq.current += 1;
    setMensajes((prev) => [...prev, { ...m, id: seq.current }]);
  }

  async function enviar(texto: string) {
    const t = texto.trim();
    if (!t || escribiendo) return;
    setInput('');
    pushMensaje({ rol: 'user', contenido: t, datos: null, ts: Date.now() });
    setEscribiendo(true);
    try {
      const r = await api.chatIA(t);
      pushMensaje({
        rol: 'assistant',
        contenido: r.respuesta.contenido,
        datos: r.datos,
        ts: Date.now(),
      });
    } catch (e) {
      pushMensaje({
        rol: 'assistant',
        contenido: `⚠️ No he podido contactar con el núcleo IA (${e instanceof Error ? e.message : String(e)}). El TPV sigue operativo; vuelve a intentarlo en unos segundos.`,
        datos: null,
        ts: Date.now(),
      });
    } finally {
      setEscribiendo(false);
    }
  }

  async function aplicarReco(r: RecomendacionIA) {
    if (aplicadas.includes(r.id)) return;
    try {
      await api.aplicarRecomendacion(r.id, 'aplicada');
      setAplicadas((prev) => [...prev, r.id]);
      setToast(`✓ Acción aplicada: ${r.titulo}`);
    } catch (e) {
      setToast(`Error al aplicar la acción: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /* ---------- Efectos ---------- */
  useEffect(() => {
    if (arrancado.current) return;
    arrancado.current = true;
    void cargar();
    // Replica el estado inicial del diseño con datos reales del motor IA
    void enviar(QUERY_INICIAL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setAhora(hora(new Date().toISOString())), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [mensajes, escribiendo]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---------- Derivados ---------- */
  const criticos = inventario.filter((i) => i.alerta === 'critico');
  const stockAlerta: Insumo | null = criticos[0] ?? inventario[0] ?? null;
  const recoStock = pendientes.find((r) => r.tipo === 'stock_critico') ?? null;
  const recoClima = pendientes.find((r) => r.tipo === 'clima') ?? null;

  const racionesStock = recoStock ? recoStock.titulo.match(/(\d+)\s*raciones/i)?.[1] : undefined;
  const demanda = recoClima && isRecord(recoClima.datos) ? toNum(recoClima.datos.demanda) : 120;
  const mesasLounge =
    recoClima && isRecord(recoClima.datos) ? Math.max(1, toNum(recoClima.datos.mesas_sugeridas)) : 2;
  const ticketMedio = caja ? toNum(caja.ticket_medio) : 0;

  const pico = predicciones.reduce<Prediccion | null>(
    (max, p) =>
      !max || toNum(p.ocupacion_proyectada) > toNum(max.ocupacion_proyectada) ? p : max,
    null
  );
  const clima = predicciones[0]?.factor_clima ?? null;
  const lluviaPct = clima?.lluvia ? 100 : 0;
  const mesasTotal = estado ? estado.mesas.libres + estado.mesas.ocupadas : 0;
  const mesasOcupadas = estado ? estado.mesas.ocupadas : 0;

  const tiemposZona: ZonaTiempo[] = (() => {
    const activos = pedidos.filter((c) => c.estado !== 'cobrada' && c.estado !== 'cancelada');
    const grupos = new Map<string, ComandaRow[]>();
    for (const c of activos) {
      const k = c.zona_tipo ?? 'otro';
      const g = grupos.get(k);
      if (g) g.push(c);
      else grupos.set(k, [c]);
    }
    const nombres: Record<string, string> = {
      interior: 'Salón Principal (Interior)',
      exterior: 'Terraza & Jardín (Patio)',
    };
    const orden: Record<string, number> = { interior: 0, exterior: 1, otro: 2 };
    return [...grupos.entries()]
      .map(([tipo, lista]) => ({
        nombre: nombres[tipo] ?? `Zona ${tipo}`,
        min:
          lista.reduce((s, c) => s + c.segundos_transcurridos, 0) / Math.max(1, lista.length) / 60,
        camareros: new Set(lista.map((c) => c.camarero).filter((c): c is string => !!c)).size,
        orden: orden[tipo] ?? 3,
      }))
      .sort((a, b) => a.orden - b.orden)
      .map(({ nombre, min, camareros }) => ({ nombre, min, camareros }));
  })();

  const maxZona = Math.max(15, ...tiemposZona.map((z) => z.min));

  /* ---------- Render ---------- */
  if (cargando && !estado) {
    return (
      <div className="app-content">
        <div className="loading">Conectando con el agente operativo…</div>
      </div>
    );
  }
  if (!cargando && error && !estado) {
    return (
      <div className="app-content">
        <div className="ia-error">
          <p>No se pudo conectar con la API: {error}</p>
          <button type="button" className="btn btn-primary" onClick={() => void cargar()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-content ia-page">
      <div className="ia-main">
        {/* Cabecera */}
        <header className="card ia-head">
          <div className="ia-head-row">
            <div className="ia-head-icon" aria-hidden>
              🧠
            </div>
            <div className="ia-head-txt">
              <div className="ia-title-row">
                <h1>Agente Operativo SavorAI</h1>
                <span className={`badge ${estado?.online ? 'badge-success' : 'badge-warning'}`}>
                  {estado?.online ? 'En línea' : 'Conectando'}
                </span>
              </div>
              <p className="ia-sub">
                Conectado a TPV, Sensores de Patio, KDS Cocina e Inventario en Tiempo Real
              </p>
            </div>
          </div>
          <div className="ia-head-chips">
            <div className="ia-hchip">
              <span className="ia-hchip-ico">⚡</span>
              <span>
                <em>Ritmo de sala</em>
                <strong>{resumenPedidos ? num(resumenPedidos.tiempo_medio_pase_min) : '—'} min / pase</strong>
              </span>
            </div>
            <div className="ia-hchip">
              <span className="ia-hchip-ico">🌡️</span>
              <span>
                <em>Patio Clima</em>
                <strong>
                  {clima && clima.temp != null ? num(clima.temp) : '—'}°C · {lluviaPct}% Lluvia
                </strong>
              </span>
            </div>
            <button
              type="button"
              className={`ia-hchip ia-hchip-btn ${filtrosTurno ? 'on' : ''}`}
              onClick={() => setFiltrosTurno((v) => !v)}
              aria-pressed={filtrosTurno}
            >
              <span className="ia-hchip-ico">⚙️</span>
              <span>
                <em>Filtros de Turno</em>
                <strong>{filtrosTurno ? 'Activos' : 'Noche'}</strong>
              </span>
            </button>
          </div>
        </header>

        {/* Consultas rápidas */}
        <section className="ia-quick">
          <div className="ia-quick-head">
            <span className="ia-eyebrow">⚡ Consultas rápidas sugeridas</span>
            <span className="ia-quick-meta">
              Turno Noche · {ahora}
            </span>
          </div>
          <div className="ia-quick-chips">
            {CONSULTAS.map((c) => (
              <button
                key={c.texto}
                type="button"
                className="ia-qchip"
                disabled={escribiendo}
                onClick={() => void enviar(c.texto)}
              >
                <span aria-hidden>{c.icono}</span> {c.texto}
              </button>
            ))}
          </div>
        </section>

        {/* Chat */}
        <section className="card ia-chat-card">
          <div className="ia-chat" ref={chatRef}>
            {mensajes.map((m) =>
              m.rol === 'user' ? (
                <div className="ia-msg-user" key={m.id}>
                  <div className="ia-msg-meta">Mateo Rossi (Jefe de Sala) · {hora(new Date(m.ts).toISOString())}</div>
                  <div className="ia-msg-user-row">
                    <div className="ia-bubble-user">{m.contenido}</div>
                    <div className="ia-avatar-user" aria-hidden>
                      🧑‍💼
                    </div>
                  </div>
                </div>
              ) : (
                <div className="ia-msg-bot" key={m.id}>
                  <div className="ia-avatar-bot" aria-hidden>
                    🧠
                  </div>
                  <div className="ia-msg-body">
                    <div className="ia-bot-meta">
                      <span className="ia-bot-name">SavorAI Co-Pilot</span>
                      <span className="badge badge-neutral no-dot">Auditoría en tiempo real</span>
                      <span className="ia-bot-time">{hace(m.ts)}</span>
                    </div>
                    <div className="ia-bubble-bot">{m.contenido}</div>
                    {m.datos ? <BloqueDatos datos={m.datos} /> : null}
                  </div>
                </div>
              )
            )}
            {escribiendo && (
              <div className="ia-msg-bot">
                <div className="ia-avatar-bot" aria-hidden>
                  🧠
                </div>
                <div className="ia-msg-body">
                  <div className="ia-bot-meta">
                    <span className="ia-bot-name">SavorAI Co-Pilot</span>
                    <span className="badge badge-neutral no-dot">Auditando datos en vivo…</span>
                  </div>
                  <div className="ia-bubble-bot ia-typing" aria-label="Escribiendo">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Gráfico de ocupación */}
        <section className="card ia-chart-card">
          <div className="section-head">
            <div>
              <h3>
                Ocupación Proyectada vs. Real
                {pico ? ` (Pico de las ${pico.hora})` : ''}
              </h3>
              <p className="text-sm text-muted">
                Predicción basada en reservas históricas, sensores de terraza y clima exterior
              </p>
            </div>
            <div className="ia-chart-kpi">{pico ? pct(toNum(pico.ocupacion_proyectada)) : '—'} Previsto</div>
          </div>
          {error && !predicciones.length ? (
            <div className="ia-error-inline">No se pudieron cargar las predicciones ({error}).</div>
          ) : (
            <GraficoOcupacion predicciones={predicciones} />
          )}
        </section>

        {/* Acciones sugeridas + barra de entrada */}
        <section className="card ia-composer">
          <div className="ia-actions">
            <span className="ia-actions-label">Acciones automáticas sugeridas:</span>
            <div className="ia-actions-chips">
              {cargando && !pendientes.length && <span className="text-sm text-muted">Cargando sugerencias…</span>}
              {!cargando && !pendientes.length && (
                <span className="text-sm text-muted">Sin acciones pendientes — todo revisado ✓</span>
              )}
              {pendientes.map((r) => {
                const hecha = aplicadas.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`ia-achip ${hecha ? 'done' : ''}`}
                    disabled={hecha}
                    title={r.contenido}
                    onClick={() => void aplicarReco(r)}
                  >
                    {hecha ? '✓' : '⚡'} {r.titulo}
                  </button>
                );
              })}
            </div>
          </div>

          <form
            className="ia-inputbar"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar(input);
            }}
          >
            <span className="ia-mic" aria-hidden title="Entrada de voz (demo)">
              🎙️
            </span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregunta sobre stock, previsión de terraza, rotación o brigada…"
              aria-label="Consulta al agente operativo"
            />
            <span className="ia-input-icons" aria-hidden>
              🪑 🍽️
            </span>
            <button type="submit" className="btn btn-primary" disabled={escribiendo || !input.trim()}>
              Consultar →
            </button>
          </form>
          <div className="ia-input-foot">
            <span>✓ Algoritmo de optimización gastronómica v4.1 • Modo Salón Activo</span>
            <span>Presiona Enter ↵ para procesar</span>
          </div>
        </section>
      </div>

      {/* ---------- Panel lateral derecho ---------- */}
      <aside className="ia-side">
        {/* Cámaras + insights */}
        <section className="card ia-cam">
          <div className="ia-cam-bar">
            <span className="ia-cam-live">● Cámaras de Sala I.A.</span>
            <span className="ia-cam-count">
              {num(mesasOcupadas)} / {num(mesasTotal)} Mesas Activas
            </span>
          </div>
          <div className="ia-cam-grid" aria-hidden>
            <div className="ia-cam-tile t1">🍽️</div>
            <div className="ia-cam-tile t2">🌿</div>
            <div className="ia-cam-tile t3">📹</div>
          </div>
          <div className="ia-cam-ins">
            <h3>Insights en Tiempo Real</h3>
            <p>Análisis predictivo cruzado con ventas y sensores</p>
            <div className="ia-ins-row">
              <span>Recomendaciones aplicadas</span>
              <strong>
                {estado ? `${num(estado.recomendaciones.aplicadas)} / ${num(estado.recomendaciones.total)}` : '—'}
              </strong>
            </div>
            <div className="ia-ins-row">
              <span>Confianza media del agente</span>
              <strong>{estado ? pct(estado.recomendaciones.confianza_media) : '—'}</strong>
            </div>
            <div className="ia-ins-row">
              <span>Insumos en alerta</span>
              <strong className={estado && estado.stock_critico > 0 ? 'danger' : ''}>
                {estado ? num(estado.stock_critico) : '—'}
              </strong>
            </div>
          </div>
        </section>

        {/* Alerta crítica de stock */}
        <section className="card ia-stock">
          <div className="ia-stock-head">
            <span className="ia-stock-tag">Alerta crítica de stock</span>
            <span className="ia-stock-num">
              {racionesStock ? (
                <>
                  {num(toNum(racionesStock))} <em>raciones</em>
                </>
              ) : stockAlerta ? (
                <>
                  {num(toNum(stockAlerta.stock_actual), 1)} <em>{stockAlerta.unidad}</em>
                </>
              ) : (
                <em>sin alertas</em>
              )}
            </span>
          </div>
          {stockAlerta ? (
            <>
              <div className="ia-stock-body">
                <span className="ia-stock-ico" aria-hidden>
                  🥫
                </span>
                <h3>{recoStock ? recoStock.titulo.split(':')[0].trim() : stockAlerta.nombre}</h3>
              </div>
              <p className="ia-stock-txt">
                {recoStock
                  ? recoStock.contenido
                  : `Quedan ${num(toNum(stockAlerta.stock_actual), 1)} ${stockAlerta.unidad} de «${stockAlerta.nombre}» (mínimo ${num(toNum(stockAlerta.stock_minimo), 1)}). Riesgo de rotura durante el servicio.`}
              </p>
              <button
                type="button"
                className="btn btn-primary ia-stock-btn"
                onClick={() => setToast('↻ Sugerencia enviada a los dispositivos de comanderos')}
              >
                ↻ Enviar Sugerencia a Comanderos
              </button>
            </>
          ) : (
            <p className="ia-stock-txt">Inventario por encima del mínimo. Sin roturas previstas para hoy.</p>
          )}
        </section>

        {/* Demanda de patio */}
        <section className="card ia-dem">
          <div className="ia-dem-top">
            <span className="badge badge-success no-dot">Optimización de terraza</span>
            <span aria-hidden>📈</span>
          </div>
          <div className="ia-dem-body">
            <span className="ia-dem-ico" aria-hidden>
              🌡️
            </span>
            <h3>
              Demanda de Patio:
              <br />+{num(demanda)}%
            </h3>
          </div>
          <p className="ia-dem-txt">
            {recoClima
              ? recoClima.contenido
              : 'Noche templada. Clientes en lista de espera solicitan exterior.'}
          </p>
          <div className="ia-dem-stats">
            <div>
              <em>Capacidad adicional</em>
              <strong>+{num(mesasLounge * 4)} comensales</strong>
            </div>
            <div>
              <em>Incremento facturación estimado</em>
              <strong>
                +{eur(mesasLounge * 4 * ticketMedio)}
              </strong>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-outline ia-dem-btn"
            onClick={() => setToast(`⊕ ${mesasLounge} mesas lounge habilitadas en Terraza`)}
          >
            ⊕ Habilitar {num(mesasLounge)} Mesas Lounge
          </button>
        </section>

        {/* Tiempos por zona */}
        <section className="card ia-zonas">
          <div className="section-head">
            <div>
              <h3>Tiempos y Eficiencia por Zona</h3>
              <p className="text-sm text-muted">Velocidad de atención vs. estándar de la casa (12 min)</p>
            </div>
            <button className="ia-ghost-ico" type="button" title="Editar objetivos (demo)" onClick={() => setToast('Objetivos de zona editables en la versión completa')}>
              ✎
            </button>
          </div>

          {tiemposZona.length === 0 && <p className="text-sm text-muted">Sin comandas activas ahora mismo.</p>}
          {tiemposZona.map((z) => {
            const over = z.min > 12;
            return (
              <div className="ia-zona" key={z.nombre}>
                <div className="ia-zona-top">
                  <span className="ia-zona-nombre">{z.nombre}</span>
                  <span className={`ia-zona-min ${over ? 'over' : ''}`}>{num(z.min, 1)} min</span>
                </div>
                <div className="ia-zona-bar">
                  <i style={{ width: `${Math.min(100, (z.min / maxZona) * 100)}%` }} className={over ? 'over' : ''} />
                </div>
                <div className="ia-zona-foot">
                  <span>{num(z.camareros)} camareros activos</span>
                  <span className={over ? 'danger' : 'ok'}>{over ? 'Sobre objetivo' : 'En objetivo'}</span>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            className="btn btn-outline ia-zona-btn"
            onClick={() => setToast('⇄ Camarero de Barra reasignado al Patio (demo)')}
          >
            ⇄ Reasignar Camarero de Barra al Patio
          </button>
        </section>
      </aside>

      {toast && <div className="ia-toast">{toast}</div>}
    </div>
  );
}
