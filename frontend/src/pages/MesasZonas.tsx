import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Comanda, type Mesa, type Reserva, type ResumenMesas } from '../lib/api';
import { badgeEstado, desde, ESTADO_MESA, eur, eur0 } from '../lib/format';
import './MesasZonas.css';

/* ------------------------------------------------------------------ */
/*  Tipos y constantes de presentación                                 */
/* ------------------------------------------------------------------ */

type VistaZona = 'interior' | 'exterior' | 'todo';
type FiltroEstado = 'todas' | 'libre' | 'ocupada' | 'reservada' | 'cuenta_solicitada';

interface SubZona {
  nombre: string;
  icono: string;
  nota?: string;
}

interface GrupoZona {
  tipo: 'interior' | 'exterior';
  icono: string;
  titulo: string;
  subtitulo: string;
  zonas: SubZona[];
}

const GRUPOS: GrupoZona[] = [
  {
    tipo: 'interior',
    icono: '🍽️',
    titulo: 'Salón Principal & Salones VIP',
    subtitulo: 'Ambiente cálido acústico · Servicio de sala continuo',
    zonas: [
      { nombre: 'Barra & Zona Ventanal', icono: '🍸', nota: 'Orientación Calle Mayor' },
      { nombre: 'Salón Central & Reservados VIP', icono: '🛋️', nota: 'Acceso directo a cava' },
      { nombre: 'Salón Interior', icono: '🏛️' },
    ],
  },
  {
    tipo: 'exterior',
    icono: '🌿',
    titulo: 'Patio & Terraza Ajardinada',
    subtitulo: 'Pérgolas bioclimáticas activas · Calefacción radiante encendida (Zona 2)',
    zonas: [
      { nombre: 'Patio / Terraza', icono: '⛱️', nota: 'Terraza abierta · 24 °C' },
      { nombre: 'Pérgola Climatizada & Jardín Central', icono: '🍃' },
    ],
  },
];

const FILTROS: { id: FiltroEstado; label: string; cls: string }[] = [
  { id: 'todas', label: 'Todas', cls: '' },
  { id: 'libre', label: 'Disponibles', cls: 'chip-libre' },
  { id: 'ocupada', label: 'Ocupadas', cls: 'chip-ocupada' },
  { id: 'reservada', label: 'Reservadas', cls: 'chip-reservada' },
  { id: 'cuenta_solicitada', label: 'Cuenta Solicitada', cls: 'chip-cuenta' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** segundos transcurridos desde un ISO dado (o null si no hay marca) */
function segDesde(iso: string | null, ahora: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((ahora - t) / 1000));
}

function tonoCrono(seg: number | null): string {
  if (seg === null) return '';
  if (seg < 900) return 't-ok';
  if (seg <= 1500) return 't-warn';
  return 't-bad';
}

/** etiqueta inferior de la tarjeta de mesa */
function etiquetaPie(m: Mesa, clienteReserva?: string): { texto: string; cls: string } {
  if (m.estado === 'cuenta_solicitada') return { texto: 'Cuenta', cls: 'tag-cuenta' };
  if (m.estado === 'reservada') return { texto: clienteReserva ?? 'Reservada', cls: 'tag-neutral' };
  if (m.estado === 'libre') {
    if (m.ambiente === 'Limpieza lista') return { texto: 'Limpieza lista', cls: 'tag-neutral' };
    if (m.capacidad >= 4) return { texto: 'Disponible IA', cls: 'tag-ia' };
    return { texto: 'Montada', cls: 'tag-ok' };
  }
  return { texto: m.comanda_numero ? `Comanda #${m.comanda_numero}` : 'En servicio', cls: 'tag-neutral' };
}

/** nota contextual inferior del panel de detalle */
function notaMesa(m: Mesa): string {
  if (m.estado === 'cuenta_solicitada') return 'Cuenta solicitada: pendiente de cobro en caja. Prioridad de cobro alta.';
  if (m.estado === 'reservada') return 'Mesa preparada para la reserva: menú de temporada y carta de bodega listos.';
  if (m.estado === 'libre') {
    return m.ambiente === 'Limpieza lista'
      ? 'Limpieza terminada: mesa lista para sentar nuevos comensales.'
      : 'Mesa disponible: lista para abrir nueva comanda.';
  }
  return m.zona_tipo === 'exterior'
    ? 'Estufa exterior nivel 2 encendida · Terraza abierta (24 °C).'
    : 'Climatización de sala a 21 °C · Ambiente estable.';
}

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

/* ------------------------------------------------------------------ */
/*  Tarjeta de mesa                                                    */
/* ------------------------------------------------------------------ */

function MesaCard({
  mesa,
  sel,
  ahora,
  clienteReserva,
  horaReserva,
  onClick,
}: {
  mesa: Mesa;
  sel: boolean;
  ahora: number;
  clienteReserva?: string;
  horaReserva?: string;
  onClick: () => void;
}) {
  const seg = segDesde(mesa.abierta_en, ahora);
  const importe = Number(mesa.importe_comanda) || 0;
  const pie = etiquetaPie(mesa, clienteReserva);
  const estadoLabel = ESTADO_MESA[mesa.estado] ?? mesa.estado;

  return (
    <button type="button" className={`mz-card e-${mesa.estado}${sel ? ' sel' : ''}`} onClick={onClick}>
      <div className="mz-card-top">
        <span className="mz-cod">{mesa.codigo}</span>
        <span className={`badge ${badgeEstado(mesa.estado)}`}>{estadoLabel}</span>
        {seg !== null && (
          <span className={`badge no-dot mz-timer ${tonoCrono(seg)}`}>⏱ {desde(seg)}</span>
        )}
        {mesa.estado === 'reservada' && horaReserva && (
          <span className="badge badge-outline no-dot mz-timer">🕐 {horaReserva} h</span>
        )}
      </div>

      <div className="mz-card-mid">
        <span className="mz-pax">👥 {mesa.capacidad} pax</span>
        <span className="mz-who">{mesa.camarero ?? mesa.ambiente ?? '—'}</span>
      </div>

      <div className="mz-card-foot">
        <span className={`mz-tag ${pie.cls}`}>{pie.texto}</span>
        <span className={`mz-importe${importe > 0 ? '' : ' none'}`}>
          {importe > 0 ? eur(importe) : '--'}
        </span>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Página                                                             */
/* ------------------------------------------------------------------ */

export default function MesasZonas() {
  const navigate = useNavigate();

  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [resumen, setResumen] = useState<ResumenMesas | null>(null);
  const [pedidos, setPedidos] = useState<Comanda[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [zona, setZona] = useState<VistaZona>('interior');
  const [filtro, setFiltro] = useState<FiltroEstado>('todas');
  const [selId, setSelId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [accionando, setAccionando] = useState(false);
  const [transfiriendo, setTransfiriendo] = useState(false);
  const [destinoId, setDestinoId] = useState('');

  const [tick, setTick] = useState(0);
  const ahora = useMemo(() => Date.now(), [tick]);

  const avisar = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  const cargar = useCallback(async () => {
    try {
      const [ms, rs, ps, rvs] = await Promise.all([
        api.mesas(),
        api.resumenMesas(),
        api.pedidos(),
        api.reservas(),
      ]);
      setMesas(ms);
      setResumen(rs);
      setPedidos(ps);
      setReservas(rvs.reservas);
      setError(null);
      // preselecciona una mesa con comanda activa la primera vez
      setSelId((prev) => {
        if (prev !== null) return prev;
        const inicial = ms.find((m) => m.estado === 'ocupada' && m.comanda_numero) ?? ms[0];
        return inicial ? inicial.id : null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar las mesas');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // cronometros en vivo
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 30000);
    return () => window.clearInterval(t);
  }, []);

  /* ---------- derivados ---------- */

  const delZona = useMemo(
    () =>
      mesas.filter((m) => {
        if (zona === 'todo') return true;
        if (zona === 'interior') return m.zona_tipo !== 'exterior';
        return m.zona_tipo === 'exterior';
      }),
    [mesas, zona]
  );

  const conteos = useMemo(
    () => ({
      todas: delZona.length,
      libre: delZona.filter((m) => m.estado === 'libre').length,
      ocupada: delZona.filter((m) => m.estado === 'ocupada').length,
      reservada: delZona.filter((m) => m.estado === 'reservada').length,
      cuenta_solicitada: delZona.filter((m) => m.estado === 'cuenta_solicitada').length,
    }),
    [delZona]
  );

  const visibles = useMemo(
    () => (filtro === 'todas' ? delZona : delZona.filter((m) => m.estado === filtro)),
    [delZona, filtro]
  );

  const gruposVisibles = useMemo(
    () =>
      GRUPOS.filter(
        (g) => zona === 'todo' || (zona === 'interior' && g.tipo === 'interior') || (zona === 'exterior' && g.tipo === 'exterior')
      ),
    [zona]
  );

  const countZona = useCallback(
    (v: VistaZona) =>
      mesas.filter((m) => {
        if (v === 'todo') return true;
        if (v === 'interior') return m.zona_tipo !== 'exterior';
        return m.zona_tipo === 'exterior';
      }).length,
    [mesas]
  );

  const ocupacionPct = resumen && resumen.total > 0 ? Math.round(((resumen.total - resumen.libres) / resumen.total) * 100) : 0;
  const ocupadasAhora = resumen ? resumen.total - resumen.libres : 0;

  const tiempoMedioMin = useMemo(() => {
    const abiertas = mesas.filter((m): m is Mesa & { abierta_en: string } => m.abierta_en !== null);
    if (!abiertas.length) return 0;
    const total = abiertas.reduce((s, m) => s + (segDesde(m.abierta_en, ahora) ?? 0), 0);
    return Math.max(1, Math.round(total / abiertas.length / 60));
  }, [mesas, ahora]);

  const iaTexto = useMemo(() => {
    const libres = mesas.filter((m) => m.zona_tipo === 'exterior' && m.estado === 'libre');
    if (!libres.length) return 'Sin mesas libres en Patio ahora mismo';
    const porCap = new Map<number, number>();
    for (const m of libres) porCap.set(m.capacidad, (porCap.get(m.capacidad) ?? 0) + 1);
    let capMejor = libres[0].capacidad;
    let nMejor = 0;
    porCap.forEach((n, cap) => {
      if (n > nMejor || (n === nMejor && cap > capMejor)) {
        nMejor = n;
        capMejor = cap;
      }
    });
    return `${nMejor} mesas x ${capMejor} pax libres en Patio`;
  }, [mesas]);

  /* ---------- seleccionada ---------- */

  const sel = useMemo(() => mesas.find((m) => m.id === selId) ?? null, [mesas, selId]);

  const comandaSel = useMemo(() => {
    if (!sel) return null;
    const abiertas = pedidos.filter(
      (p) => p.mesa_id === sel.id && p.estado !== 'cobrada' && p.estado !== 'cancelada'
    );
    if (!abiertas.length) return null;
    return abiertas.reduce((a, b) => (a.abierta_en > b.abierta_en ? a : b));
  }, [pedidos, sel]);

  const reservaSel = useMemo(
    () =>
      sel
        ? reservas.find(
            (r) => r.mesa_id === sel.id && ['pendiente', 'confirmada', 'en_curso'].includes(r.estado)
          ) ?? null
        : null,
    [reservas, sel]
  );

  const reservaDe = useCallback(
    (m: Mesa) =>
      reservas.find(
        (r) => r.mesa_id === m.id && ['pendiente', 'confirmada', 'en_curso'].includes(r.estado)
      ) ?? null,
    [reservas]
  );

  const libresTransferibles = useMemo(
    () => mesas.filter((m) => m.estado === 'libre' && m.id !== selId),
    [mesas, selId]
  );

  /* ---------- acciones ---------- */

  const actualizar = useCallback(
    async (estado: string, mensaje: string) => {
      if (!sel) return;
      setAccionando(true);
      try {
        await api.actualizarMesa(sel.id, { estado });
        avisar(mensaje);
        setTransfiriendo(false);
        setDestinoId('');
        await cargar();
      } catch (e) {
        avisar(e instanceof Error ? e.message : 'Error al actualizar la mesa');
      } finally {
        setAccionando(false);
      }
    },
    [sel, avisar, cargar]
  );

  const transferir = useCallback(async () => {
    if (!sel || !destinoId) return;
    const destino = mesas.find((m) => m.id === Number(destinoId));
    setAccionando(true);
    try {
      await api.actualizarMesa(Number(destinoId), { estado: 'ocupada' });
      await api.actualizarMesa(sel.id, { estado: 'libre' });
      avisar(`Mesa ${sel.codigo} transferida a ${destino?.codigo ?? 'destino'} ✓`);
      setTransfiriendo(false);
      setDestinoId('');
      await cargar();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Error al transferir la mesa');
    } finally {
      setAccionando(false);
    }
  }, [sel, destinoId, mesas, avisar, cargar]);

  /* ---------- render ---------- */

  if (cargando && !mesas.length) {
    return (
      <div className="app-content">
        <div className="loading">Cargando mapa de mesas…</div>
      </div>
    );
  }

  if (error && !mesas.length) {
    return (
      <div className="app-content">
        <div className="loading">
          <div>
            <p>Error al cargar: {error}</p>
            <button type="button" className="btn btn-primary mt-2" onClick={() => { setCargando(true); void cargar(); }}>
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const segSel = segDesde(sel?.abierta_en ?? null, ahora);
  const totalComanda = comandaSel
    ? comandaSel.lineas.reduce((s, l) => s + l.cantidad * Number(l.precio), 0)
    : 0;

  return (
    <div className="app-content mz">
      {/* ---------- fila superior: zonas + KPIs + IA ---------- */}
      <div className="mz-top">
        <div className="mz-zonetoggle" role="tablist" aria-label="Zonas del restaurante">
          <button
            type="button"
            className={zona === 'interior' ? 'active' : ''}
            onClick={() => { setZona('interior'); setFiltro('todas'); }}
          >
            🍽️ Salón Interior <span className="zt-count">{countZona('interior')}</span>
          </button>
          <button
            type="button"
            className={zona === 'exterior' ? 'active' : ''}
            onClick={() => { setZona('exterior'); setFiltro('todas'); }}
          >
            🌿 Patio / Terraza <span className="zt-count">{countZona('exterior')}</span>
          </button>
          <button
            type="button"
            className={zona === 'todo' ? 'active' : ''}
            onClick={() => { setZona('todo'); setFiltro('todas'); }}
          >
            ▦ Ver Todo <span className="zt-count">{countZona('todo')}</span>
          </button>
        </div>

        <div className="mz-top-right">
          <div className="mz-kpis">
            <div className="mz-kpi">
              <span className="ico ico-pct">{ocupacionPct}%</span>
              <div>
                <div className="lbl">Ocupación</div>
                <div className="val">{ocupadasAhora} / {resumen?.total ?? 0} Mesas</div>
              </div>
            </div>
            <div className="mz-kpi">
              <span className="ico">🕐</span>
              <div>
                <div className="lbl">Tiempo Medio</div>
                <div className="val">{tiempoMedioMin} min</div>
              </div>
            </div>
            <div className="mz-kpi">
              <span className="ico">💶</span>
              <div>
                <div className="lbl">Venta Activa</div>
                <div className="val">{resumen ? eur0(resumen.venta_activa) : '—'}</div>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="mz-ia"
            onClick={() => avisar(`IA: ${iaTexto} — trasladar presión del salón a la lista de espera.`)}
          >
            <span className="mz-ia-ico">🤖</span>
            <span className="mz-ia-txt">
              <strong>IA DISPONIBILIDAD</strong>
              {iaTexto}
            </span>
            <span className="mz-ia-arrow">→</span>
          </button>
        </div>
      </div>

      {/* ---------- chips de filtro + contexto ---------- */}
      <div className="mz-chips">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`filter-chip ${filtro === f.id ? 'active' : ''} ${f.cls}`.trim()}
            onClick={() => setFiltro(f.id)}
          >
            {f.label} <span className="count">{conteos[f.id]}</span>
          </button>
        ))}
      </div>

      <div className="mz-ctx">
        <span><i className="dot ok" /> Climatización 21 °C</span>
        <span className="mz-sep">·</span>
        <span>☀️ Terraza abierta (24 °C)</span>
        <span className="mz-sep">·</span>
        <span>{visibles.length} mesas en vista</span>
      </div>

      {/* ---------- cuerpo: zonas + panel ---------- */}
      <div className="mz-body">
        <main className="mz-zonas">
          {gruposVisibles.map((g) => {
            const mesasGrupo = visibles.filter((m) =>
              g.zonas.some((z) => z.nombre === m.zona)
            );
            const capGrupo = mesasGrupo.reduce((s, m) => s + m.capacidad, 0);
            return (
              <section key={g.tipo} className="mz-group">
                <header className="mz-group-head">
                  <span className="g-ico">{g.icono}</span>
                  <div>
                    <h2>{g.titulo}</h2>
                    <div className="g-sub">
                      Capacidad máxima: {capGrupo} comensales · {g.subtitulo}
                    </div>
                  </div>
                  <span className="g-count">{mesasGrupo.length} Mesas distribuidas</span>
                </header>

                {g.zonas.map((z) => {
                  const mesasZona = mesasGrupo.filter((m) => m.zona === z.nombre);
                  if (!mesasZona.length) return null;
                  const capZona = mesasZona.reduce((s, m) => s + m.capacidad, 0);
                  const nota = z.nota ?? `Capacidad: ${capZona} comensales`;
                  return (
                    <div key={z.nombre} className="mz-subzone">
                      <div className="mz-sub-head">
                        <span>{z.icono}</span>
                        <span>{z.nombre}</span>
                        <span className="right">{nota}</span>
                      </div>
                      <div className="mz-grid">
                        {mesasZona.map((m) => {
                          const r = reservaDe(m);
                          return (
                            <MesaCard
                              key={m.id}
                              mesa={m}
                              sel={m.id === selId}
                              ahora={ahora}
                              clienteReserva={r?.cliente}
                              horaReserva={r?.hora}
                              onClick={() => { setSelId(m.id); setTransfiriendo(false); }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {mesasGrupo.length === 0 && (
                  <div className="mz-empty">Sin mesas con este filtro en esta zona.</div>
                )}
              </section>
            );
          })}
        </main>

        {/* ---------- panel de detalle ---------- */}
        <aside className="mz-panel">
          {!sel ? (
            <div className="mz-panel-empty">
              <div style={{ fontSize: 34 }}>🪑</div>
              <p>Selecciona una mesa para ver su comanda en vivo.</p>
            </div>
          ) : (
            <>
              <div className="mz-panel-head">
                <div className="mz-panel-cod">{sel.codigo}</div>
                <span className={`badge ${badgeEstado(sel.estado)}`}>
                  {sel.estado === 'ocupada' ? 'EN SERVICIO' : (ESTADO_MESA[sel.estado] ?? sel.estado).toUpperCase()}
                </span>
              </div>

              <div className="mz-panel-zona">
                {sel.zona_corto}
                {sel.ambiente && sel.ambiente !== 'Limpieza lista' ? ` · ${sel.ambiente}` : ''}
              </div>

              <div className="mz-panel-cap">
                Capacidad: {sel.capacidad} Comensales · {sel.zona}
                {sel.zona_tipo === 'exterior' ? ' — Sección Exterior Calefactada' : ''}
              </div>

              {/* titular de la comanda */}
              <div className="mz-block-title">Titular de la comanda</div>
              <div className="mz-titular">
                <span className="mz-avatar">
                  {comandaSel ? iniciales(comandaSel.camarero ?? 'Mesa') : iniciales(sel.codigo)}
                </span>
                <div className="flex-1">
                  <div className="mz-tit-name">
                    {comandaSel ? `Comanda #${comandaSel.numero}` : 'Sin comanda activa'}
                  </div>
                  <div className="mz-tit-sub">
                    {comandaSel ? (
                      <>
                        {comandaSel.comensales} pax · Sentados hace {segSel !== null ? desde(segSel) : '—'} · Cam: {comandaSel.camarero ?? '—'}
                      </>
                    ) : (
                      <>
                        {sel.comensales ? `${sel.comensales} pax · ` : ''}
                        {sel.camarero ? `Cam: ${sel.camarero}` : 'Mesa libre para nueva comanda'}
                      </>
                    )}
                  </div>
                </div>
                <span className={`badge ${comandaSel ? 'badge-success' : 'badge-outline'}`}>
                  {comandaSel ? `${comandaSel.lineas.length} líneas` : 'Vacía'}
                </span>
              </div>

              {/* comanda activa */}
              <div className="mz-block-title">
                Comanda activa {comandaSel ? `(#${comandaSel.numero})` : ''}
                {comandaSel && <span className="mz-total">{eur(totalComanda)}</span>}
              </div>

              {!comandaSel ? (
                <div className="mz-sincomanda">Sin líneas registradas para esta mesa.</div>
              ) : (
                <ul className="mz-lineas">
                  {comandaSel.lineas.map((l) => (
                    <li key={l.id} className={`mz-linea l-${l.estado}`}>
                      <span className="barra" />
                      <div className="flex-1">
                        <div className="l-nom">
                          <span className="l-cant">{l.cantidad}x</span>
                          {l.plato}
                        </div>
                        {l.notas && <em className="l-notas">{l.notas}</em>}
                        <span className={`l-est e-${l.estado}`}>
                          {l.estado === 'servida' ? '✓' : l.estado === 'en_preparacion' ? '🔥' : '○'}{' '}
                          {l.estado === 'en_preparacion' ? 'En cocina' : l.estado === 'servida' ? 'Servida' : l.estado === 'lista' ? 'Lista' : 'Pendiente'}
                          {l.partida ? ` · ${l.partida}` : ''}
                        </span>
                      </div>
                      <span className="l-precio">{eur(Number(l.precio) * l.cantidad)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* acciones rápidas */}
              <div className="mz-mini-actions">
                <button type="button" className="mz-iconbtn" title="Imprimir comanda" onClick={() => avisar('Comanda enviada a la impresora de sala 🖨️')}>
                  🖨️
                </button>
                <button type="button" className="mz-iconbtn" title="Avisar camarero" onClick={() => avisar('Aviso enviado al camarero de zona 🔔')}>
                  🔔
                </button>
                <button type="button" className="mz-iconbtn" title="Añadir observación" onClick={() => avisar('Observación añadida a la comanda')}>
                  ✎
                </button>
              </div>

              <div className="mz-actions">
                <button type="button" className="btn btn-primary" onClick={() => navigate('/menu')}>
                  🛒 Añadir Items
                </button>
                <button
                  type="button"
                  className="btn btn-dark"
                  disabled={accionando || !comandaSel}
                  onClick={() => void actualizar('libre', 'Cuenta cobrada — mesa liberada ✓')}
                >
                  💳 Cobrar Cuenta
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={accionando}
                  onClick={() => { setTransfiriendo((v) => !v); setDestinoId(''); }}
                >
                  ⇄ Transferir Mesa
                </button>
                <button
                  type="button"
                  className="btn btn-danger-soft"
                  disabled={accionando}
                  onClick={() => void actualizar('libre', `Mesa ${sel.codigo} liberada ✓`)}
                >
                  ✕ Liberar Mesa
                </button>
              </div>

              {transfiriendo && (
                <div className="mz-transfer">
                  <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
                    <option value="">Elegir mesa destino…</option>
                    {libresTransferibles.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.codigo} · {m.zona_corto} · {m.capacidad} pax
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!destinoId || accionando}
                    onClick={() => void transferir()}
                  >
                    Confirmar
                  </button>
                </div>
              )}

              <div className="mz-note">
                <span>ℹ️</span>
                <span>{notaMesa(sel)}</span>
              </div>
            </>
          )}
        </aside>
      </div>

      {toast && <div className="mz-toast">{toast}</div>}
    </div>
  );
}
