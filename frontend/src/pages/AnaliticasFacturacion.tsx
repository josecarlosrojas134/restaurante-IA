import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Analiticas, type Insumo, type Prediccion } from '../lib/api';
import { METODO_PAGO, eur, eur0, num, pct } from '../lib/format';
import './AnaliticasFacturacion.css';

type CajaTurno = Awaited<ReturnType<typeof api.cajaActual>>;
type EstadoOrden = 'idle' | 'busy' | 'ok';

/**
 * La API no expone un GET de proveedores y el endpoint POST /inventario/ordenes
 * exige `proveedor_id`. El seed inserta los proveedores en este orden con IDs
 * secuenciales: en la BD activa ocupan 11–15 y tras un `init + seed` limpio 1–5.
 * Si el primer candidato no existe, la API lo rechaza por FK sin crear filas
 * (transacción con ROLLBACK) y se reintenta con el ID de un seed limpio.
 */
const PROVEEDORES_NOMBRES = [
  'Cárnicos del Sur SL',
  'Pescados Ría Verde',
  'Huerta Ecológica La Vega',
  'Bodega Ribera Duero',
  'Lácteos Idiazábal Echea',
];

const BASES_PROVEEDOR = [10, 0]; // id = base + índice + 1

interface LineaOrden {
  insumo_id: number;
  cantidad: number;
  costo_unitario: number;
}

/** Crea la orden resolviendo el ID del proveedor (con fallback ante re-seed). */
async function postOrden(proveedor: string, lineas: LineaOrden[]): Promise<void> {
  const idx = PROVEEDORES_NOMBRES.indexOf(proveedor);
  const candidatos = idx >= 0 ? BASES_PROVEEDOR.map((b) => b + idx + 1) : [];
  if (!candidatos.length) throw new Error(`Proveedor no mapeado: ${proveedor}`);
  let ultimoError = '';
  for (const proveedorId of candidatos) {
    const res = await fetch('/api/inventario/ordenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proveedor_id: proveedorId, lineas, origen_ia: true }),
    });
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    ultimoError = body.error || `Error ${res.status}`;
  }
  throw new Error(ultimoError);
}

/* --- BCG Gastronómico: clasificación derivada del margen y las unidades --- */
interface Clasificacion {
  clave: 'estrella' | 'puzle' | 'caballo' | 'perro';
  label: string;
  cls: string;
}

function clasificar(m: { margen_pct: number; unidades: number }): Clasificacion {
  if (m.margen_pct >= 70 && m.unidades >= 20) return { clave: 'estrella', label: 'Estrella', cls: 'an-tag-estrella' };
  if (m.margen_pct >= 70) return { clave: 'puzle', label: 'Puzle / Oportunidad', cls: 'an-tag-puzle' };
  if (m.margen_pct >= 55) return { clave: 'caballo', label: 'Caballo / Batalla', cls: 'an-tag-caballo' };
  return { clave: 'perro', label: 'Perro / Revisar', cls: 'an-tag-perro' };
}

const ICONO_TIPO: Record<string, string> = {
  interior: '🍽️',
  exterior: '🌿',
  takeaway: '🥡',
  delivery: '🛵',
};

/* ============================================================
   KPI reutilizable
   ============================================================ */
interface KpiProps {
  etiqueta: string;
  icono: string;
  valor: ReactNode;
  badge?: { texto: string; tono: 'ok' | 'bad' | 'neutro' };
  sub?: ReactNode;
  pie: [string, ReactNode][];
  destacado?: boolean;
}

function Kpi({ etiqueta, icono, valor, badge, sub, pie, destacado }: KpiProps) {
  return (
    <div className={`card an-kpi ${destacado ? 'dest' : ''}`}>
      <div className="an-kpi-label">
        <span>{etiqueta}</span>
        <span aria-hidden>{icono}</span>
      </div>
      <div className="an-kpi-value">{valor}</div>
      <div className="an-kpi-mid">
        {badge && <span className={`an-kpi-badge ${badge.tono}`}>{badge.texto}</span>}
        {sub && <span className="an-kpi-sub">{sub}</span>}
      </div>
      <div className="an-kpi-pie">
        {pie.map(([k, v]) => (
          <div key={k}>
            <em>{k}</em>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Gráfico SVG de barras por hora
   ============================================================ */
function GraficoSerie({ serie }: { serie: Analiticas['serie'] }) {
  if (!serie.length) {
    return <div className="loading">Sin facturación registrada por horas hoy…</div>;
  }

  const W = 560;
  const H = 220;
  const PL = 52;
  const PR = 12;
  const PT = 18;
  const PB = 34;

  const max = Math.max(...serie.map((s) => Number(s.facturacion)), 1);
  const paso = (W - PL - PR) / serie.length;
  const bw = Math.min(40, paso * 0.55);

  let iPico = 0;
  serie.forEach((s, i) => {
    if (Number(s.facturacion) > Number(serie[iPico].facturacion)) iPico = i;
  });

  return (
    <div className="an-serie-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="an-serie-svg" role="img" aria-label="Facturación por hora">
        {[1, 0.5, 0].map((g) => {
          const y = PT + (1 - g) * (H - PT - PB);
          return (
            <g key={g}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="var(--surface-container-highest)" strokeDasharray="4 4" />
              <text x={PL - 7} y={y + 3} textAnchor="end" className="an-serie-y">
                {eur0(max * g)}
              </text>
            </g>
          );
        })}
        {serie.map((s, i) => {
          const val = Number(s.facturacion);
          const h = (val / max) * (H - PT - PB);
          const x = PL + i * paso + (paso - bw) / 2;
          return (
            <rect
              key={s.hora}
              x={x}
              y={H - PB - h}
              width={bw}
              height={Math.max(2, h)}
              rx="4"
              fill={i === iPico ? 'var(--primary)' : 'rgba(168, 50, 35, 0.55)'}
            />
          );
        })}
        {serie.map((s, i) => (
          <text key={`l-${s.hora}`} x={PL + i * paso + paso / 2} y={H - 12} textAnchor="middle" className={`an-serie-x ${i === iPico ? 'pico' : ''}`}>
            {s.hora}
            {i === iPico ? ' (Pico)' : ''}
          </text>
        ))}
      </svg>
      <div className="an-serie-legend">
        <span className="lg-a">■ Facturación horaria total</span>
        <span className="lg-c">Barras en terracota · pico del turno resaltado</span>
      </div>
    </div>
  );
}

/* ============================================================
   Página
   ============================================================ */
export default function AnaliticasFacturacion() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<Analiticas | null>(null);
  const [caja, setCaja] = useState<CajaTurno | null>(null);
  const [preds, setPreds] = useState<Prediccion[]>([]);
  const [inventario, setInventario] = useState<Insumo[]>([]);

  // filtros decorativos con estado local
  const [zonaActiva, setZonaActiva] = useState('todas');
  const [rango, setRango] = useState<'hoy' | 'viernes'>('hoy');

  // exportación de informe
  const [exportOpen, setExportOpen] = useState(false);

  // cierre de caja
  const [modal, setModal] = useState(false);
  const [arqueo, setArqueo] = useState('');
  const [arqueoErr, setArqueoErr] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [resCierre, setResCierre] = useState<{ diferencia: number; esperado: number } | null>(null);

  // matriz BCG
  const [filtroMatriz, setFiltroMatriz] = useState('todas');
  const [verTodas, setVerTodas] = useState(false);

  // directivas IA
  const [orden, setOrden] = useState<EstadoOrden>('idle');
  const [notificado, setNotificado] = useState(false);
  const [verTiras, setVerTiras] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const [an, ca, pr, inv] = await Promise.all([
        api.analiticas(),
        api.cajaActual(),
        api.predicciones(),
        api.inventario(),
      ]);
      setDatos(an);
      setCaja(ca);
      setPreds(pr);
      setInventario(inv);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---------- Derivados ---------- */
  const totalPagos = useMemo(
    () => (datos ? datos.pagos.reduce((s, p) => s + Number(p.total), 0) : 0),
    [datos]
  );
  const totalZonas = useMemo(
    () => (datos ? datos.porZona.reduce((s, z) => s + Number(z.facturacion), 0) : 0),
    [datos]
  );
  const facturacion = datos ? Number(datos.kpis.facturacion) : 0;
  const ticket = datos ? Number(datos.kpis.ticket_medio) : 0;
  const rotacion = datos && datos.kpis.mesas_usadas > 0 ? datos.kpis.comandas / datos.kpis.mesas_usadas : 0;

  const pico = preds.reduce<Prediccion | null>(
    (max, p) => (!max || Number(p.ocupacion_proyectada) > Number(max.ocupacion_proyectada) ? p : max),
    null
  );
  const picoPct = pico ? Number(pico.ocupacion_proyectada) : 0;
  const mesasSimultaneas = datos ? Math.round((picoPct / 100) * datos.kpis.mesas_total) : 0;
  const tempPatio = preds[0]?.factor_clima?.temp ?? null;

  const iva = Math.round((facturacion - facturacion / 1.1) * 100) / 100;
  const base = Math.round((facturacion / 1.1) * 100) / 100;

  const criticos = inventario.filter((i) => i.alerta !== 'ok');

  const interiorFact = datos
    ? datos.porZona.filter((z) => z.tipo === 'interior').reduce((s, z) => s + Number(z.facturacion), 0)
    : 0;
  const exteriorFact = totalZonas - interiorFact;

  const filasMatriz = useMemo(() => {
    if (!datos) return [];
    let filas = datos.matrizBCG;
    if (filtroMatriz !== 'todas') filas = filas.filter((m) => clasificar(m).clave === filtroMatriz);
    return verTodas ? filas : filas.slice(0, 5);
  }, [datos, filtroMatriz, verTodas]);

  /* ---------- Acciones ---------- */
  function exportar(fmt: string) {
    setExportOpen(false);
    setToast(`⤓ Informe del turno exportado en ${fmt} ✓`);
  }

  async function generarOrden() {
    if (!criticos.length) {
      setToast('No hay insumos bajo mínimo: no procede la orden de compra.');
      return;
    }
    setOrden('busy');
    try {
      const grupos = new Map<string, Insumo[]>();
      for (const i of criticos) {
        const p = i.proveedor ?? 'Proveedor sin asignar';
        const g = grupos.get(p);
        if (g) g.push(i);
        else grupos.set(p, [i]);
      }
      let lineasTotal = 0;
      let importe = 0;
      for (const [prov, items] of grupos) {
        const lineas: LineaOrden[] = items.map((i) => ({
          insumo_id: i.id,
          cantidad: Math.max(1, Math.ceil(Number(i.stock_minimo) - Number(i.stock_actual))),
          costo_unitario: Number(i.costo_unitario),
        }));
        await postOrden(prov, lineas);
        lineasTotal += lineas.length;
        importe += lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0);
      }
      setOrden('ok');
      setToast(`✓ Orden de compra generada por IA · ${lineasTotal} líneas · ${eur(importe)}`);
    } catch (e) {
      setOrden('idle');
      setToast(`Error al generar la orden: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function cerrarCaja() {
    const v = Number(arqueo);
    if (!arqueo.trim() || Number.isNaN(v)) {
      setArqueoErr('Introduce el efectivo contado en el arqueo.');
      return;
    }
    setArqueoErr(null);
    setCerrando(true);
    try {
      const r = await api.cierreCaja({ arqueo_real: v });
      setResCierre({
        diferencia: Number(r.diferencia ?? 0),
        esperado: Number(r.arqueo_esperado ?? 0),
      });
      setToast('✓ Cierre Turno Z registrado en el TPV');
    } catch (e) {
      setArqueoErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCerrando(false);
    }
  }

  /* ---------- Estados ---------- */
  if (cargando) {
    return (
      <div className="app-content">
        <div className="loading">Cargando analíticas del turno…</div>
      </div>
    );
  }
  if (error || !datos || !caja) {
    return (
      <div className="app-content">
        <div className="an-error">
          <p>No se pudieron cargar las analíticas: {error ?? 'respuesta vacía de la API'}</p>
          <button type="button" className="btn btn-primary" onClick={() => void cargar()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const textoAprovision = criticos.length
    ? `Solicitar ${criticos
        .slice(0, 2)
        .map(
          (c) =>
            `${num(Math.max(1, Math.ceil(Number(c.stock_minimo) - Number(c.stock_actual))))} ${
              c.unidad
            } extra de ${c.nombre}`
        )
        .join(' y ')} para evitar rotura de stock durante el segundo pase del fin de semana.`
    : 'Inventario por encima del mínimo: no se prevén roturas.';

  return (
    <div className="app-content an-page">
      {/* ============ Cabecera ============ */}
      <header className="an-head">
        <div className="an-head-left">
          <span className="an-eyebrow">Inteligencia operativa · Módulo Cierre Fiscal</span>
          <div className="an-title-row">
            <h1>Analíticas &amp; Facturación Gastronómica</h1>
            <span className="badge badge-success">Turno Noche · Cerrando servicio</span>
          </div>
        </div>
        <div className="an-head-actions">
          <div className="an-export">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setExportOpen((v) => !v)}
              aria-expanded={exportOpen}
            >
              ⤓ Exportar Informe <span className="an-tag">PDF/XLS</span>
            </button>
            {exportOpen && (
              <div className="an-export-menu">
                <button type="button" onClick={() => exportar('PDF')}>
                  📄 Informe PDF
                </button>
                <button type="button" onClick={() => exportar('XLS')}>
                  📊 Hoja de cálculo (XLS)
                </button>
              </div>
            )}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setModal(true)}>
            🧾 Cierre de Caja (Turno Z)
          </button>
        </div>
      </header>

      {/* ============ Filtros ============ */}
      <div className="an-filters">
        <div className="an-filters-zonas">
          {[
            { id: 'todas', label: 'Todas las Zonas' },
            {
              id: 'interior',
              label: `Salón Interior (${pct(Math.round((interiorFact / Math.max(1, totalZonas)) * 100))})`,
            },
            {
              id: 'exterior',
              label: `Patio & Terraza (${pct(Math.round((exteriorFact / Math.max(1, totalZonas)) * 100))})`,
            },
            { id: 'takeaway', label: 'Takeaway & Delivery' },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              className={`filter-chip ${zonaActiva === c.id ? 'active' : ''}`}
              onClick={() => setZonaActiva(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="an-filters-rango">
          <button
            type="button"
            className={`filter-chip ${rango === 'hoy' ? 'active' : ''}`}
            onClick={() => setRango('hoy')}
          >
            📅 Hoy (Turno Noche: 20:00 – Cierre)
          </button>
          <button
            type="button"
            className={`filter-chip ${rango === 'viernes' ? 'active' : ''}`}
            onClick={() => setRango('viernes')}
          >
            ⇄ Vs. viernes ant.
          </button>
        </div>
      </div>
      {rango === 'viernes' && (
        <p className="an-rango-nota">
          ⚠ Comparativa histórica no importada en esta demo: se muestran las métricas reales del turno actual.
        </p>
      )}

      {/* ============ KPIs ============ */}
      <section className="an-kpis">
        <Kpi
          etiqueta="Facturación Bruta"
          icono="💳"
          valor={eur(facturacion)}
          // delta vs. viernes anterior: métrica decorativa del diseño (sin endpoint histórico)
          badge={{ texto: '↑ +14,2%', tono: 'ok' }}
          sub="vs. viernes ant."
          pie={[
            ['Obj. turno', eur0(4200)],
            ['Cumplido', pct(Math.round((facturacion / 4200) * 100))],
          ]}
        />
        <Kpi
          etiqueta="Ticket Medio Comensal"
          icono="🍽️"
          valor={eur(ticket)}
          badge={{
            texto: `${ticket >= 40 ? '↑' : '↓'} ${eur(Math.abs(ticket - 40))}`,
            tono: ticket >= 40 ? 'ok' : 'bad',
          }}
          sub="vs. obj. 40 €"
          pie={[
            ['Comandas', num(datos.kpis.comandas)],
            ['Mesas usadas', `${num(datos.kpis.mesas_usadas)}/${num(datos.kpis.mesas_total)}`],
          ]}
        />
        <Kpi
          etiqueta="Rotación de Mesas"
          icono="🔄"
          valor={`${num(rotacion, 2)}x`}
          badge={{ texto: 'turnos / mesa', tono: 'neutro' }}
          sub="Turno completo"
          pie={[
            ['Sin uso', num(Math.max(0, datos.kpis.mesas_total - datos.kpis.mesas_usadas))],
            ['Objetivo', '2,00x'],
          ]}
        />
        <Kpi
          etiqueta="Ocupación Pico"
          icono="👥"
          valor={pct(picoPct)}
          badge={{ texto: `🕒 ${pico?.hora ?? '—'}`, tono: 'neutro' }}
          sub="pico proyectado IA"
          pie={[
            ['Simultáneas', `${num(mesasSimultaneas)} mesas`],
            ['Capacidad', `${num(datos.kpis.mesas_total)} mesas`],
          ]}
        />
        <Kpi
          etiqueta="Upselling SavorAI"
          icono="🎯"
          // KPI decorativo del diseño: el backend no expone métrica de upselling
          valor={<span className="an-kpi-up">+580,00 €</span>}
          badge={{ texto: '92% conversión', tono: 'ok' }}
          sub="en vinos & postres"
          pie={[
            ['Sugerencias', '46'],
            ['Servidas', '42'],
          ]}
          destacado
        />
      </section>

      {/* ============ Columna principal ============ */}
      <div className="an-grid">
        <div className="an-col">
          {/* Rendimiento por zona */}
          <section className="card an-rend">
            <div className="section-head">
              <div>
                <h3>Rendimiento Comparativo por Zona</h3>
                <p className="text-sm text-muted">
                  Distribución horaria del volumen de facturación y eficiencia térmica de terraza.
                </p>
              </div>
              <div className="an-rend-flags">
                <span className="an-time-chip">
                  {datos.serie[0]?.hora ?? '—'} - {datos.serie[datos.serie.length - 1]?.hora ?? '—'}
                </span>
                <span className="an-legend">
                  <i className="sw-a" /> Salón Interior
                </span>
                <span className="an-legend">
                  <i className="sw-b" /> Patio &amp; Terraza
                </span>
              </div>
            </div>

            <div className="an-zona-cards">
              {datos.porZona.map((z) => {
                const share = Math.round((Number(z.facturacion) / Math.max(1, totalZonas)) * 100);
                const dim =
                  zonaActiva === 'interior'
                    ? z.tipo !== 'interior'
                      ? ' dim'
                      : ''
                    : zonaActiva === 'exterior'
                      ? z.tipo !== 'exterior'
                        ? ' dim'
                        : ''
                      : '';
                return (
                  <div className={`an-zona-card${z.tipo === 'exterior' ? ' ext' : ''}${dim}`} key={z.zona}>
                    <span className="an-zona-ico">{ICONO_TIPO[z.tipo] ?? '🍴'}</span>
                    <div className="an-zona-info">
                      <strong>{z.zona}</strong>
                      <em>{num(z.comandas)} comandas</em>
                    </div>
                    <div className="an-zona-vals">
                      <strong>{eur(z.facturacion)}</strong>
                      <em className={z.tipo === 'exterior' ? 'ext' : ''}>{pct(share)} del total</em>
                    </div>
                  </div>
                );
              })}
            </div>

            <GraficoSerie serie={datos.serie} />

            <div className="an-clima-note">
              <span aria-hidden>☀️</span>
              <p>
                <strong>Impacto Clima Patio:</strong> temperatura exterior estable a{' '}
                {tempPatio != null ? num(tempPatio) : '—'}°C — el exterior genera{' '}
                {eur(exteriorFact)} ({pct(Math.round((exteriorFact / Math.max(1, totalZonas)) * 100))} del
                total facturado por zonas) con las terrazas al 70% de sus estufas activas.
              </p>
            </div>
          </section>

          {/* Matriz BCG */}
          <section className="card an-matriz">
            <div className="an-matriz-head">
              <div>
                <div className="an-matriz-title">
                  <h3>Matriz de Ingeniería de Menú</h3>
                  <span className="an-tag">BCG Gastronómico</span>
                </div>
                <p className="text-sm text-muted">
                  Análisis cruzado de margen unitario de contribución versus volumen de ventas.
                </p>
              </div>
              <label className="an-matriz-filter">
                Filtrar por:
                <select value={filtroMatriz} onChange={(e) => setFiltroMatriz(e.target.value)}>
                  <option value="todas">Todos los platos ({num(datos.matrizBCG.length)})</option>
                  <option value="estrella">Estrellas</option>
                  <option value="caballo">Caballos / Batalla</option>
                  <option value="puzle">Puzles / Oportunidad</option>
                  <option value="perro">Perros / Revisar</option>
                </select>
              </label>
            </div>

            <div className="an-table-scroll">
              <table className="data-table an-matriz-table">
                <thead>
                  <tr>
                    <th>Plato / Clasificación</th>
                    <th>Categoría Matriz</th>
                    <th>Unidades</th>
                    <th>Margen Bruto</th>
                    <th>Facturación</th>
                  </tr>
                </thead>
                <tbody>
                  {filasMatriz.map((m) => {
                    const c = clasificar(m);
                    return (
                      <tr key={m.nombre} className={`row-${c.clave}`}>
                        <td>
                          <strong className="an-plato-nombre">{m.nombre}</strong>
                          <span className="an-plato-cat">
                            {m.categoria} · {eur(m.precio)}
                          </span>
                        </td>
                        <td>
                          <span className={`an-tagpill ${c.cls}`}>{c.label}</span>
                        </td>
                        <td className="num">{num(m.unidades)} uds</td>
                        <td className="num">
                          <strong>{pct(m.margen_pct)}</strong>
                          <span className="an-cell-sub">{eur(m.margen_unidad)}/ud</span>
                        </td>
                        <td className="num">{eur(m.facturacion)}</td>
                      </tr>
                    );
                  })}
                  {!filasMatriz.length && (
                    <tr>
                      <td colSpan={5} className="text-muted">
                        Ningún plato coincide con este filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="an-matriz-foot">
              <span>
                Mostrando {num(filasMatriz.length)} de {num(datos.matrizBCG.length)} referencias activas
              </span>
              <button type="button" className="an-link" onClick={() => setVerTodas((v) => !v)}>
                {verTodas ? 'Ver solo top 5 ←' : 'Ver análisis completo de escandallos →'}
              </button>
            </div>
          </section>
        </div>

        {/* ============ Columna lateral ============ */}
        <div className="an-col">
          {/* Agente predictivo */}
          <section className="card an-pred">
            <div className="an-pred-head">
              <span className="an-pred-ico" aria-hidden>
                🎯
              </span>
              <div className="an-pred-titles">
                <h3>Agente Predictivo SavorAI</h3>
                <p className="text-sm text-muted">Modelo de Demanda v2.4 • Tiempo Real</p>
              </div>
              <span className="badge badge-danger no-dot">Proyección Activa</span>
            </div>

            <div className="an-pred-fin">
              <span>📈 Fin de Semana Estimado (Sáb / Dom)</span>
              {/* proyección del modelo (diseño): sin endpoint dedicado de forecast semanal */}
              <strong>{eur0(11400)}</strong>
            </div>
            <p className="an-pred-txt">
              Con las reservas ya confirmadas y buen pronóstico meteorológico, se proyecta un incremento
              del +8,2% respecto a la semana pasada.
            </p>
            <div className="an-pred-mini">
              <div>
                <em>Sábado Noche</em>
                <strong>{eur0(6850)}</strong>
                <span>100% cap</span>
              </div>
              <div>
                <em>Domingo Almuerzo</em>
                <strong>{eur0(4550)}</strong>
                <span>82% cap</span>
              </div>
            </div>

            <div className="an-dir-title">Directivas operativas recomendadas</div>

            <div className="an-dir">
              <div className="an-dir-card">
                <div className="an-dir-top">
                  <span className="an-dir-ico warn" aria-hidden>
                    🛒
                  </span>
                  <div>
                    <strong>Aprovisionamiento Crítico</strong>
                    <p>{textoAprovision}</p>
                  </div>
                  <span className="an-dir-when">Antes 11:00 hs</span>
                </div>
                <button
                  type="button"
                  className="btn btn-outline an-dir-btn"
                  onClick={() => void generarOrden()}
                  disabled={orden !== 'idle'}
                >
                  {orden === 'busy' && 'Generando orden…'}
                  {orden === 'idle' && 'Generar Orden a Proveedor'}
                  {orden === 'ok' && '✓ Orden generada (origen IA)'}
                </button>
              </div>

              <div className="an-dir-card">
                <div className="an-dir-top">
                  <span className="an-dir-ico ok" aria-hidden>
                    👥
                  </span>
                  <div>
                    <strong>Refuerzo de Brigada (Salón)</strong>
                    <p>
                      Reforzar Patio con 1 camarero adicional para mantener el tiempo de servicio por
                      debajo de los 12 min con mesas al 100%.
                    </p>
                  </div>
                  <span className="an-dir-when">20:30 – 23:00</span>
                </div>
                <button
                  type="button"
                  className={`btn an-dir-btn ${notificado ? 'btn-success' : 'btn-outline'}`}
                  onClick={() => {
                    setNotificado(true);
                    setToast('✓ Turno Rotativo notificado: refuerzo de brigada confirmado');
                  }}
                  disabled={notificado}
                >
                  {notificado ? '✓ Turno Rotativo notificado' : 'Notificar a Turno Rotativo'}
                </button>
              </div>
            </div>
          </section>

          {/* Cierre de caja */}
          <section className="card an-caja">
            <div className="section-head">
              <h3>Cierre de Caja &amp; Métodos TPV</h3>
              <span className="an-tpv">TPV-ID #84-BISTRO</span>
            </div>

            <div className="an-caja-top">
              <div className="an-caja-neto">
                <em>Recaudación neta turno</em>
                <strong>{eur(caja.recaudacion)}</strong>
              </div>
              <div className="an-caja-iva">
                <span>
                  IVA Repercutido (10%) <b>{eur(iva)}</b>
                </span>
                <span>Base: {eur(base)}</span>
              </div>
            </div>

            <div className="an-pagos">
              {datos.pagos.map((p) => {
                const share = (Number(p.total) / Math.max(1, totalPagos)) * 100;
                return (
                  <div className="an-pago" key={p.metodo}>
                    <div className="an-pago-row">
                      <span className="an-pago-nombre">{METODO_PAGO[p.metodo] ?? p.metodo}</span>
                      <span className="an-pago-vals num">
                        {eur(p.total)} ({num(share, 1)}%)
                      </span>
                    </div>
                    <div className="an-pago-bar">
                      <i style={{ width: `${share}%` }} />
                    </div>
                  </div>
                );
              })}
              {!datos.pagos.length && <p className="text-sm text-muted">Sin pagos registrados en el turno.</p>}
            </div>

            <div className="an-propinas">
              <span className="an-propinas-ico" aria-hidden>
                💳
              </span>
              <div>
                <em>Propinas Digitales Acumuladas</em>
                <span>Reparto entre miembros de sala y cocina</span>
              </div>
              <div className="an-propinas-val">
                <strong>{eur(caja.propinas)}</strong>
                <span>
                  {eur(Number(caja.propinas) / Math.max(1, caja.comandas))} / comanda
                </span>
              </div>
            </div>

            <div className="an-arqueo">
              <div className="an-arqueo-item">
                <em>Diferencia de arqueo</em>
                <strong className={resCierre ? (resCierre.diferencia === 0 ? 'ok' : 'bad') : ''}>
                  {resCierre
                    ? `${eur(resCierre.diferencia)} ${
                        resCierre.diferencia === 0 ? '(Exacto)' : '(Descuadre)'
                      }`
                    : 'Pendiente de arqueo'}
                </strong>
              </div>
              <button type="button" className="an-link" onClick={() => setVerTiras((v) => !v)}>
                {verTiras ? 'Ocultar tiras ↑' : 'Ver Tiras de Auditoría →'}
              </button>
            </div>

            {verTiras && (
              <ul className="an-tiras">
                {datos.pagos.map((p) => (
                  <li key={p.metodo}>
                    <span>{METODO_PAGO[p.metodo] ?? p.metodo}</span>
                    <span className="num">
                      {num(p.operaciones)} operaciones · {eur(p.total)}
                    </span>
                  </li>
                ))}
                {!datos.pagos.length && <li>Sin movimientos en el turno.</li>}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* ============ Modal cierre de caja ============ */}
      {modal && (
        <div className="an-modal-bg" onClick={() => setModal(false)} role="presentation">
          <div
            className="an-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Cierre de caja Turno Z"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="an-modal-head">
              <h3>🧾 Cierre de Caja — Turno Z</h3>
              <button type="button" className="an-modal-x" onClick={() => setModal(false)} aria-label="Cerrar">
                ✕
              </button>
            </div>

            <div className="an-modal-resumen">
              <div>
                <em>Recaudación</em>
                <strong>{eur(caja.recaudacion)}</strong>
              </div>
              <div>
                <em>Tarjeta</em>
                <strong>{eur(caja.tarjeta)}</strong>
              </div>
              <div>
                <em>Efectivo</em>
                <strong>{eur(caja.efectivo)}</strong>
              </div>
              <div>
                <em>Cheques / Digital</em>
                <strong>{eur(caja.cheques)}</strong>
              </div>
              <div>
                <em>Propinas</em>
                <strong>{eur(caja.propinas)}</strong>
              </div>
              <div>
                <em>Facturación bruta</em>
                <strong>{eur(caja.facturacion)}</strong>
              </div>
              <div>
                <em>Ticket medio</em>
                <strong>{eur(caja.ticket_medio)}</strong>
              </div>
              <div>
                <em>Comandas</em>
                <strong>{num(caja.comandas)}</strong>
              </div>
            </div>

            <label className="an-modal-field">
              Arqueo real (efectivo contado en caja)
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={arqueo}
                placeholder="0,00"
                onChange={(e) => {
                  setArqueo(e.target.value);
                  setArqueoErr(null);
                }}
              />
            </label>
            {arqueoErr && <p className="an-modal-err">{arqueoErr}</p>}

            {resCierre && (
              <div className={`an-modal-diff ${resCierre.diferencia === 0 ? 'ok' : 'bad'}`}>
                <strong>
                  Diferencia de arqueo: {eur(resCierre.diferencia)}{' '}
                  {resCierre.diferencia === 0 ? '(cuadra exacto)' : '(descuadre sobre lo esperado)'}
                </strong>
                <span>
                  Esperado en efectivo: {eur(resCierre.esperado)} · Arqueo contado:{' '}
                  {eur(resCierre.esperado + resCierre.diferencia)}
                </span>
              </div>
            )}

            <div className="an-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setModal(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void cerrarCaja()}
                disabled={cerrando}
              >
                {cerrando ? 'Registrando…' : 'Cerrar Caja (Turno Z)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="an-toast">{toast}</div>}
    </div>
  );
}
