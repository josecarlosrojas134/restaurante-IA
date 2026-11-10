import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Cliente, type Mesa, type Reserva } from '../lib/api';
import { ESTADO_RESERVA, badgeEstado, eur0, num, pct } from '../lib/format';
import './ReservasClientes.css';

/** Fila de la lista de espera (api.listaEspera la declara como Record<string, unknown>) */
interface GrupoEspera {
  id: number;
  comensales: number;
  estado: string;
  tiempo_espera_est_min: number;
  posicion: number;
  notas: string | null;
  cliente: string;
  telefono: string | null;
  zona: string | null;
}

/** Ficha completa de cliente (api.cliente) */
type FichaCliente = Cliente & {
  preferencias: { tipo: string; clave: string; valor: string; severidad: string }[];
  resenas: { puntuacion: number; fecha: string; comentario: string; comanda: string | null }[];
  reservas: { fecha: string; hora: string; comensales: number; estado: string; mesa: string | null }[];
  visitas: { numero: string; abierta_en: string; mesa: string | null; total: string }[];
};

const VIP_LABEL: Record<string, string> = {
  platino: 'VIP Platino',
  oro: 'VIP Oro',
  plata: 'VIP Plata',
  ninguno: '',
};

const ORIGEN_LABEL: Record<string, string> = {
  thefork: 'TheFork',
  google: 'Google',
  web: 'Web',
  telefono: 'Teléfono',
  manual: 'Manual',
  ia: 'IA SavorAI',
};

const VIA_LABEL: Record<string, string> = { sms: 'SMS', email: 'Email', telefono: 'Teléfono' };

const ZONA_COLOR = ['var(--secondary)', 'var(--primary)', 'var(--ai)', 'var(--warning)'];

const hoyISO = () => new Date().toISOString().slice(0, 10);

/** "105" → "1h 45m" / "45" → "45m" */
const duracion = (min: number): string =>
  min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;

/** "2024-10-12" → "12 oct 2024" */
const fechaCorta = (iso: string): string =>
  new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });

/** "1986-10-24" → "nov 2021"-style "oct 1986" */
const mesAnio = (iso: string): string =>
  new Date(iso).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });

const iniciales = (nombre: string): string =>
  nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

interface Toast {
  tipo: 'ok' | 'error';
  texto: string;
}

interface FormReserva {
  cliente_id: string;
  hora: string;
  comensales: string;
  mesa_id: string;
  confirmada_via: string;
  notas: string;
}

export default function ReservasClientes() {
  // ---- Datos ----
  const [fecha, setFecha] = useState(hoyISO);
  const [servicio, setServicio] = useState<'noche' | 'comida'>('noche');
  const [estadoFiltro, setEstadoFiltro] = useState('todos');
  const [franjaSel, setFranjaSel] = useState<string | null>(null);

  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [cronograma, setCronograma] = useState<{ franja: string; total: number }[]>([]);
  const [resumen, setResumen] = useState<{
    total: number; pax: number; confirmadas: number; en_curso: number;
    retrasadas: number; no_show: number; externas: number; grupos: number; espera_media: number;
  } | null>(null);
  const [espera, setEspera] = useState<GrupoEspera[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [esperaCargando, setEsperaCargando] = useState(true);

  // ---- Ficha de cliente ----
  const [selId, setSelId] = useState<number | null>(null);
  const [ficha, setFicha] = useState<FichaCliente | null>(null);
  const [fichaCargando, setFichaCargando] = useState(false);
  const [fichaError, setFichaError] = useState<string | null>(null);
  const [insightDescartado, setInsightDescartado] = useState(false);
  const [notasLocales, setNotasLocales] = useState<string[]>([]);
  const [notaBorrador, setNotaBorrador] = useState('');
  const [editandoNota, setEditandoNota] = useState(false);

  // ---- Acciones ----
  const [ocupadas, setOcupadas] = useState<number | null>(null); // reserva en acción
  const [reasignando, setReasignando] = useState<number | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // ---- Reserva manual ----
  const [formAbierto, setFormAbierto] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [enviandoForm, setEnviandoForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<FormReserva>({
    cliente_id: '',
    hora: '20:30',
    comensales: '2',
    mesa_id: '',
    confirmada_via: 'sms',
    notas: '',
  });

  // ---- Carga ----
  const cargar = useCallback(() => {
    setCargando(true);
    setError(null);
    Promise.all([api.reservas(fecha), api.resumenReservas()])
      .then(([r, res]) => {
        setReservas(r.reservas);
        setCronograma(r.cronograma);
        setResumen(res);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Error al cargar reservas'))
      .finally(() => setCargando(false));
  }, [fecha]);

  useEffect(cargar, [cargar]);

  useEffect(() => {
    setEsperaCargando(true);
    api
      .listaEspera()
      // api.ts tipa este endpoint como Record<string, unknown>[]; se estrecha al shape real del backend
      .then((rows) => setEspera(rows as unknown as GrupoEspera[]))
      .catch(() => setEspera([]))
      .finally(() => setEsperaCargando(false));
    api.mesas().then(setMesas).catch(() => setMesas([]));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Ficha del cliente seleccionado ----
  useEffect(() => {
    if (selId === null) {
      setFicha(null);
      return;
    }
    setFichaCargando(true);
    setFichaError(null);
    setInsightDescartado(false);
    setNotasLocales([]);
    setEditandoNota(false);
    api
      .cliente(selId)
      .then(setFicha)
      .catch((e: unknown) => setFichaError(e instanceof Error ? e.message : 'Error al cargar la ficha'))
      .finally(() => setFichaCargando(false));
  }, [selId]);

  // Selecciona la primera reserva al cargar la lista
  useEffect(() => {
    if (reservas.length > 0 && selId === null) setSelId(reservas[0].cliente_id);
  }, [reservas, selId]);

  // ---- Filtros ----
  const filtradas = useMemo(() => {
    const desdeHora = servicio === 'noche' ? '17:00' : '00:00';
    const hastaHora = servicio === 'noche' ? '23:59' : '16:59';
    return reservas.filter((r) => {
      const h = r.hora.slice(0, 5);
      if (servicio === 'comida' ? h > hastaHora : h < desdeHora || h > hastaHora) return false;
      if (estadoFiltro !== 'todos' && r.estado !== estadoFiltro) return false;
      if (franjaSel && h !== franjaSel) return false;
      return true;
    });
  }, [reservas, servicio, estadoFiltro, franjaSel]);

  // ---- KPIs calculados ----
  const porZona = useMemo(() => {
    const m = new Map<string, number>();
    reservas.forEach((r) => {
      const z = r.zona ?? 'Sin mesa';
      m.set(z, (m.get(z) ?? 0) + 1);
    });
    const total = Math.max(1, reservas.length);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([zona, n]) => ({ zona, n, p: Math.round((n / total) * 100) }));
  }, [reservas]);

  const fidelizacion = useMemo(() => {
    const total = Math.max(1, reservas.length);
    const fid = reservas.filter((r) => r.fidelizado || r.nivel_vip !== 'ninguno').length;
    const vip = reservas.filter((r) => r.nivel_vip !== 'ninguno').length;
    return { p: Math.round((fid / total) * 100), fid, vip };
  }, [reservas]);

  const paxEspera = espera.reduce((s, g) => s + g.comensales, 0);

  // ---- Acciones de reserva ----
  const patchReserva = async (r: Reserva, body: { estado?: string; mesa_id?: number }) => {
    setOcupadas(r.id);
    try {
      const upd = await api.actualizarReserva(r.id, body);
      setReservas((prev) =>
        prev.map((x) =>
          x.id === r.id
            ? { ...x, estado: upd.estado, mesa_id: upd.mesa_id, mesa: body.mesa_id
                ? mesas.find((m) => m.id === body.mesa_id)?.codigo ?? x.mesa
                : x.mesa }
            : x
        )
      );
      setToast({ tipo: 'ok', texto: `Reserva de ${r.cliente} actualizada: ${ESTADO_RESERVA[upd.estado] ?? upd.estado}` });
    } catch (e: unknown) {
      setToast({ tipo: 'error', texto: e instanceof Error ? e.message : 'Error al actualizar la reserva' });
    } finally {
      setOcupadas(null);
      setReasignando(null);
    }
  };

  const sincronizar = () => {
    if (sincronizando) return;
    setSincronizando(true);
    setTimeout(() => {
      setSincronizando(false);
      setToast({ tipo: 'ok', texto: 'TheFork y Google sincronizados · 0 reservas nuevas' });
    }, 1100);
  };

  const exportarLibro = async () => {
    try {
      const cls = await api.clientes();
      const cab = 'nombre,telefono,email,nivel_vip,visitas,gasto_total,ticket_medio\n';
      const filas = cls
        .map((c) =>
          [c.nombre, c.telefono ?? '', c.email ?? '', c.nivel_vip, c.visitas_total, c.gasto_total, c.ticket_medio]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
        )
        .join('\n');
      const blob = new Blob([cab + filas], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `libro-clientes-${fecha}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setToast({ tipo: 'ok', texto: `Libro de clientes exportado (${cls.length} fichas)` });
    } catch {
      setToast({ tipo: 'error', texto: 'No se pudo exportar el libro de clientes' });
    }
  };

  const crearReserva = async () => {
    setFormError(null);
    if (!form.cliente_id || !form.hora || !form.comensales) {
      setFormError('Cliente, hora y comensales son obligatorios');
      return;
    }
    setEnviandoForm(true);
    try {
      const res = await fetch('/api/reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: Number(form.cliente_id),
          hora: form.hora,
          comensales: Number(form.comensales),
          mesa_id: form.mesa_id ? Number(form.mesa_id) : undefined,
          confirmada_via: form.confirmada_via || undefined,
          notas: form.notas || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Error ${res.status}`);
      }
      setToast({ tipo: 'ok', texto: 'Reserva manual creada correctamente' });
      setFormAbierto(false);
      setForm({ cliente_id: '', hora: '20:30', comensales: '2', mesa_id: '', confirmada_via: 'sms', notas: '' });
      cargar();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Error al crear la reserva');
    } finally {
      setEnviandoForm(false);
    }
  };

  const abrirForm = () => {
    setFormAbierto((v) => !v);
    setFormError(null);
    if (!clientes.length) api.clientes().then(setClientes).catch(() => setClientes([]));
  };

  const notificarEspera = async (g: GrupoEspera) => {
    try {
      await api.notificarListaEspera(g.id);
      setEspera((prev) => prev.map((x) => (x.id === g.id ? { ...x, estado: 'notificada' } : x)));
      setToast({ tipo: 'ok', texto: `SMS enviado a ${g.cliente} · mesa lista` });
    } catch (e: unknown) {
      setToast({ tipo: 'error', texto: e instanceof Error ? e.message : 'Error al notificar' });
    }
  };

  // ---- Insight IA de la ficha ----
  const insight = useMemo(() => {
    if (!ficha) return null;
    const alergia = ficha.preferencias.find((p) => p.severidad === 'critica');
    const nac = ficha.fecha_nacimiento ? new Date(ficha.fecha_nacimiento) : null;
    const cumpleEsteMes = nac !== null && nac.getMonth() === new Date().getMonth();
    if (cumpleEsteMes) {
      return {
        conf: 94,
        texto:
          `Este mes cumple años. Recibir con una copa de bienvenida de Cava Gran Reserva y cerrar con el postre insignia. ` +
          (alergia ? `Confirmar antes con cocina: ${alergia.clave}.` : 'Alta afinidad con la carta de temporada.'),
      };
    }
    if (alergia) {
      return {
        conf: 96,
        texto:
          `Cliente con alergia crítica registrada (${alergia.clave}). Avisar al Jefe de Cocina antes del pase y ` +
          `ofrecer alternativas seguras del menú. Ticket medio ${eur0(ficha.ticket_medio)}.`,
      };
    }
    if (ficha.visitas_total >= 10) {
      return {
        conf: 91,
        texto:
          `Cliente habitual (${ficha.visitas_total} visitas, ${eur0(ficha.gasto_total)} acumulados). ` +
          `Sugerir maridaje de temporada y recordar sus preferencias de servicio al llegar.`,
      };
    }
    return {
      conf: 84,
      texto:
        `Cliente con ${ficha.visitas_total} visitas. Cuidar el onboarding: explicar el concepto de brasas ` +
        `y ofrecer la copa del día para elevar el ticket medio (${eur0(ficha.ticket_medio)}).`,
    };
  }, [ficha]);

  const ambiente = useMemo(() => {
    const r = reservas.find((x) => x.cliente_id === selId);
    const zona = r?.zona ?? '';
    const exterior = /patio|pérgola|terraza/i.test(zona);
    return {
      titulo: r?.mesa ? `Mesa ${r.mesa}${zona ? ` · ${zona}` : ''}` : zona || 'Sin mesa asignada',
      clima: exterior ? 'Calefacción ON 24°C' : 'Clima Óptimo 21°C',
      texto: exterior
        ? 'Calefactores infrarrojos encendidos · Pérgola cerrada por brisa nocturna'
        : 'Climatización suave · Salón en penumbra confort',
      emoji: exterior ? '🌿' : '🛋️',
    };
  }, [reservas, selId]);

  // ==================================================================
  return (
    <div className="app-content rc-page">
      {toast && <div className={`rc-toast ${toast.tipo}`}>{toast.texto}</div>}

      {/* ============ Cabecera ============ */}
      <header className="rc-head">
        <div>
          <div className="rc-eyebrow">
            SAVORAI CRM GASTRONÓMICO <span className="badge badge-success no-dot">● En Vivo</span>
          </div>
          <h1 className="title-lg">Gestión de Reservas &amp; Libro de Clientes</h1>
        </div>
        <div className="rc-head-actions">
          <button className="btn btn-outline" onClick={sincronizar} disabled={sincronizando}>
            {sincronizando ? '⏳ Sincronizando…' : '⇄ Sincronizar (TheFork / Google)'}
          </button>
          <button className="btn btn-outline" onClick={exportarLibro}>⬇ Exportar Libro</button>
          <button className="btn btn-primary" onClick={abrirForm}>＋ Nueva Reserva Manual</button>
        </div>
      </header>

      {/* ============ Formulario reserva manual ============ */}
      {formAbierto && (
        <div className="rc-form card">
          <div className="rc-form-title">
            <strong>Nueva reserva manual</strong>
            <button className="rc-form-close" onClick={() => setFormAbierto(false)} aria-label="Cerrar formulario">✕</button>
          </div>
          <div className="rc-form-grid">
            <label>
              <span>Cliente</span>
              <select
                value={form.cliente_id}
                onChange={(e) => setForm((f) => ({ ...f, cliente_id: e.target.value }))}
              >
                <option value="">Seleccionar cliente…</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre} · {c.telefono ?? 's/tel'}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Hora</span>
              <input type="time" value={form.hora} onChange={(e) => setForm((f) => ({ ...f, hora: e.target.value }))} />
            </label>
            <label>
              <span>Comensales</span>
              <input
                type="number"
                min={1}
                max={20}
                value={form.comensales}
                onChange={(e) => setForm((f) => ({ ...f, comensales: e.target.value }))}
              />
            </label>
            <label>
              <span>Mesa (opcional)</span>
              <select value={form.mesa_id} onChange={(e) => setForm((f) => ({ ...f, mesa_id: e.target.value }))}>
                <option value="">Sin asignar</option>
                {mesas.map((m) => (
                  <option key={m.id} value={m.id}>{m.codigo} · {m.zona_corto} ({m.capacidad} pax)</option>
                ))}
              </select>
            </label>
            <label>
              <span>Vía de confirmación</span>
              <select
                value={form.confirmada_via}
                onChange={(e) => setForm((f) => ({ ...f, confirmada_via: e.target.value }))}
              >
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="telefono">Teléfono</option>
              </select>
            </label>
            <label className="wide">
              <span>Notas</span>
              <input
                type="text"
                placeholder="Ej. Alergias, celebración, preferencia de zona…"
                value={form.notas}
                onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
              />
            </label>
          </div>
          {formError && <div className="rc-form-error">⚠ {formError}</div>}
          <div className="rc-form-actions">
            <button className="btn btn-ghost" onClick={() => setFormAbierto(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={crearReserva} disabled={enviandoForm}>
              {enviandoForm ? 'Creando…' : 'Crear Reserva'}
            </button>
          </div>
        </div>
      )}

      {/* ============ Filtros ============ */}
      <div className="rc-filters">
        <label className="rc-filter">
          <span className="rc-filter-ico">📅</span>
          <div>
            <em>FECHA DE SERVICIO</em>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value || hoyISO())} />
          </div>
        </label>
        <label className="rc-filter">
          <span className="rc-filter-ico">🕐</span>
          <div>
            <em>SERVICIO</em>
            <select value={servicio} onChange={(e) => setServicio(e.target.value as 'noche' | 'comida')}>
              <option value="noche">Turno Noche (20:00 - 00:30)</option>
              <option value="comida">Turno Comida (13:00 - 17:00)</option>
            </select>
          </div>
        </label>
        <div className="rc-zona-chips" role="group" aria-label="Filtro de franja horaria">
          <button
            className={`filter-chip${franjaSel === null ? ' active' : ''}`}
            onClick={() => setFranjaSel(null)}
          >
            Todas las horas
          </button>
        </div>
        <label className="rc-filter">
          <span className="rc-filter-ico">✔</span>
          <div>
            <em>ESTADO</em>
            <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)}>
              <option value="todos">Todos los estados</option>
              {Object.entries(ESTADO_RESERVA).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </label>
      </div>

      {/* ============ KPIs ============ */}
      <div className="rc-kpis">
        <div className="kpi rc-kpi">
          <div className="kpi-label">Total Reservas Turno <span>👥</span></div>
          <div className="kpi-value">
            {resumen ? num(resumen.total) : '—'}
            <span className="rc-kpi-suffix">/ {resumen ? num(resumen.pax) : '—'} pax</span>
          </div>
          <div className="kpi-sub">
            {resumen
              ? `${resumen.confirmadas} confirmadas · ${resumen.en_curso} en curso · ${resumen.retrasadas} retrasadas`
              : 'Cargando…'}
          </div>
          <div className="rc-kpi-bar">
            <span
              style={{
                width: resumen ? `${Math.round((resumen.confirmadas / Math.max(1, resumen.total)) * 100)}%` : '0%',
              }}
            />
          </div>
        </div>

        <div className="kpi rc-kpi">
          <div className="kpi-label">Distribución de Zonas <span>🗺️</span></div>
          {porZona.length === 0 ? (
            <div className="kpi-sub">Sin reservas con mesa asignada</div>
          ) : (
            <div className="rc-zonas">
              {porZona.map((z, i) => (
                <div key={z.zona} className="rc-zona-row">
                  <div className="rc-zona-head">
                    <strong>{num(z.n)} res.</strong> <span>{z.zona}</span> <em>({pct(z.p)})</em>
                  </div>
                  <div className="rc-zona-track">
                    <span style={{ width: `${z.p}%`, background: ZONA_COLOR[i % ZONA_COLOR.length] }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="kpi rc-kpi">
          <div className="kpi-label">Fidelización &amp; VIPs <span>💎</span></div>
          <div className="kpi-value">
            {reservas.length ? pct(fidelizacion.p) : '—'}
            <span className="rc-kpi-pill">+{fidelizacion.vip} VIPs</span>
          </div>
          <div className="kpi-sub">
            {reservas.length
              ? `${fidelizacion.fid} clientes habituales detectados por IA hoy`
              : 'Cargando…'}
          </div>
        </div>

        <div className="kpi rc-kpi">
          <div className="kpi-label">Lista de Espera Activa <span>⏳</span></div>
          <div className="kpi-value">
            {resumen ? num(resumen.grupos) : '—'}
            <span className="rc-kpi-suffix">grupos ({num(paxEspera)} comensales)</span>
          </div>
          <div className="kpi-sub">
            Tiempo medio de asignación: <strong>{resumen ? `${resumen.espera_media} min` : '—'}</strong>
          </div>
        </div>
      </div>

      {/* ============ Cuerpo: lista + ficha ============ */}
      <div className="rc-body">
        <div className="rc-main">
          {/* Cronograma */}
          <div className="rc-crono card">
            <div className="rc-crono-title">
              <span className="rc-crono-ico">⏱</span>
              <strong>Cronograma de<br />Servicio</strong>
            </div>
            <div className="rc-crono-chips">
              {cronograma.length === 0 && <span className="text-muted text-sm">Sin franjas para esta fecha</span>}
              {cronograma.map((c) => (
                <button
                  key={c.franja}
                  className={`rc-crono-chip${franjaSel === c.franja ? ' on' : ''}`}
                  onClick={() => setFranjaSel(franjaSel === c.franja ? null : c.franja)}
                  title={`Filtrar reservas de las ${c.franja}`}
                >
                  <strong>{c.franja}</strong>
                  <span>({c.total})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Lista de reservas */}
          {cargando ? (
            <div className="loading">Cargando reservas…</div>
          ) : error ? (
            <div className="rc-error card">
              <span>⚠️</span>
              <p>{error}</p>
              <button className="btn btn-outline" onClick={cargar}>Reintentar</button>
            </div>
          ) : filtradas.length === 0 ? (
            <div className="rc-empty card">
              <span>🗓️</span>
              <p>No hay reservas con los filtros seleccionados.</p>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setEstadoFiltro('todos');
                  setFranjaSel(null);
                  setServicio('noche');
                }}
              >
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div className="rc-list">
              {filtradas.map((r) => {
                const critica = r.preferencias?.find((p) => p.severidad === 'critica');
                const tags = (r.preferencias ?? []).filter((p) => p.severidad !== 'critica').slice(0, 3);
                const sentable = ['pendiente', 'confirmada', 'retrasada'].includes(r.estado);
                const enCurso = r.estado === 'en_curso';
                const vip = VIP_LABEL[r.nivel_vip] ?? '';
                const activa = selId === r.cliente_id;
                return (
                  <article
                    key={r.id}
                    className={`rc-card card${activa ? ' activa' : ''}${critica ? ' con-alerta' : ''}`}
                    onClick={() => setSelId(r.cliente_id)}
                  >
                    <div className="rc-card-head">
                      <div className="rc-card-name">
                        <h3>{r.cliente}</h3>
                        <div className="rc-card-badges">
                          {vip && <span className="badge badge-outline no-dot">★ {vip}</span>}
                          {!vip && r.fidelizado && <span className="badge badge-outline no-dot">⇄ Frecuente</span>}
                          {!vip && !r.fidelizado && (
                            <span className="badge badge-outline no-dot">↗ Primera Visita</span>
                          )}
                          {ORIGEN_LABEL[r.origen] && (
                            <span className="badge badge-neutral no-dot">{ORIGEN_LABEL[r.origen]}</span>
                          )}
                        </div>
                      </div>
                      <span className={`badge ${badgeEstado(r.estado)}`}>{ESTADO_RESERVA[r.estado] ?? r.estado}</span>
                    </div>

                    <div className="rc-card-chips">
                      <span className="rc-chip rc-chip-hora">
                        🕐 {r.hora.slice(0, 5)} (Est. {duracion(r.duracion_est_min)})
                      </span>
                      <span className="rc-chip">👥 {r.comensales} pax</span>
                    </div>

                    <div className="rc-card-meta">
                      <span>
                        🪑 <strong>Mesa {r.mesa ?? '—'}</strong>
                        {r.zona && <> · {r.zona}{/patio|pérgola|terraza/i.test(r.zona) ? ' (Calefacción ON)' : ''}</>}
                      </span>
                      <span>📞 {r.telefono}</span>
                    </div>

                    <div className="rc-card-flags">
                      {r.confirmada_via && !['no_show', 'cancelada'].includes(r.estado) && (
                        <span className="badge badge-success no-dot">● Confirmada vía {VIA_LABEL[r.confirmada_via] ?? r.confirmada_via}</span>
                      )}
                      {r.estado === 'retrasada' && (
                        <span className="badge badge-danger no-dot">⏱ Alerta de Retraso</span>
                      )}
                      {r.estado === 'en_curso' && (
                        <span className="badge badge-warning no-dot">● En Curso (Plato Principal)</span>
                      )}
                    </div>

                    {critica && (
                      <div className="rc-alerta">
                        ⚠ <strong>Alergia Severa: {critica.clave}</strong> · {critica.valor}
                      </div>
                    )}

                    {tags.length > 0 && (
                      <div className="rc-tags">
                        {tags.map((t) => (
                          <span key={t.clave} className="rc-tag" title={t.valor}>{t.clave}</span>
                        ))}
                        {r.notas && tags.length < 3 && <span className="rc-tag muted">{r.notas.slice(0, 44)}</span>}
                      </div>
                    )}

                    <div className="rc-card-actions" onClick={(e) => e.stopPropagation()}>
                      {sentable && (
                        <>
                          <button
                            className="btn btn-success btn-sm"
                            disabled={ocupadas === r.id}
                            onClick={() => patchReserva(r, { estado: 'en_curso' })}
                          >
                            🪑 Sentar en Mesa
                          </button>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => setReasignando(reasignando === r.id ? null : r.id)}
                          >
                            ⇄ Reasignar
                          </button>
                          {reasignando === r.id && (
                            <select
                              className="rc-reasignar"
                              defaultValue=""
                              autoFocus
                              onChange={(e) => {
                                if (e.target.value) patchReserva(r, { mesa_id: Number(e.target.value) });
                              }}
                            >
                              <option value="" disabled>Elegir mesa…</option>
                              {mesas.filter((m) => m.estado === 'libre').map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.codigo} · {m.zona_corto} ({m.capacidad} pax)
                                </option>
                              ))}
                            </select>
                          )}
                          <button
                            className="btn btn-danger-soft btn-sm"
                            disabled={ocupadas === r.id}
                            onClick={() => patchReserva(r, { estado: 'no_show' })}
                            title="Marcar no-show"
                          >
                            ⊘ No-Show
                          </button>
                        </>
                      )}

                      {enCurso && (
                        <>
                          <Link className="btn btn-outline btn-sm" to="/pedidos">📋 Ver Comanda KDS</Link>
                          <button
                            className="btn btn-dark btn-sm"
                            onClick={() => setToast({ tipo: 'ok', texto: `Cuenta solicitada para ${r.cliente}` })}
                          >
                            💰 Solicitar Cuenta
                          </button>
                        </>
                      )}

                      {['atendida', 'no_show', 'cancelada'].includes(r.estado) && (
                        <span className="text-muted text-sm">Servicio finalizado · ver historial en la ficha</span>
                      )}

                      <button className="rc-ver-ficha" onClick={() => setSelId(r.cliente_id)}>
                        Ver Historial Completo →
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* ============ Ficha de cliente ============ */}
        <aside className="rc-ficha">
          {fichaCargando ? (
            <div className="loading">Cargando ficha…</div>
          ) : fichaError ? (
            <div className="rc-error card">
              <span>⚠️</span>
              <p>{fichaError}</p>
            </div>
          ) : !ficha ? (
            <div className="rc-ficha-empty card">
              <span>👤</span>
              <p>Selecciona una reserva para abrir la ficha del cliente.</p>
            </div>
          ) : (
            <div className="card rc-ficha-card">
              <div className="rc-ficha-head">
                <div className={`rc-avatar v-${ficha.nivel_vip}`}>{iniciales(ficha.nombre)}</div>
                <div className="rc-ficha-titles">
                  <h3>{ficha.nombre}</h3>
                  <p>
                    {ficha.sector ? `${ficha.sector} · ` : ''}
                    Miembro desde {mesAnio(ficha.miembro_desde)}
                  </p>
                  <div className="rc-ficha-badges">
                    {ficha.nivel_vip !== 'ninguno' && (
                      <span className="badge badge-dark no-dot">★ {VIP_LABEL[ficha.nivel_vip]}</span>
                    )}
                    {ficha.fidelizado && <span className="badge badge-success no-dot">● Fidelizado</span>}
                  </div>
                </div>
                <button
                  className="rc-ficha-edit"
                  title="Editar ficha"
                  onClick={() => setToast({ tipo: 'ok', texto: 'Editor de ficha (demo)' })}
                >
                  ✎
                </button>
              </div>

              <div className="rc-metrics">
                <div className="rc-metric">
                  <strong>{num(ficha.visitas_total)}</strong>
                  <span>Visitas Totales</span>
                  <em>Última: {ficha.ultima_visita ? fechaCorta(ficha.ultima_visita) : '—'}</em>
                </div>
                <div className="rc-metric">
                  <strong>{eur0(ficha.gasto_total)}</strong>
                  <span>Gasto Acumulado</span>
                  <em>Top 5% anual</em>
                </div>
                <div className="rc-metric">
                  <strong>{eur0(ficha.ticket_medio)}</strong>
                  <span>Ticket Medio / Pax</span>
                  <em>+28% vs media</em>
                </div>
              </div>

              {/* Insight IA */}
              {insight && !insightDescartado && (
                <div className="ai-panel rc-insight">
                  <div className="rc-insight-head">
                    <span>✳ SavorAI Insight</span>
                    <span className="badge badge-ai no-dot">Probabilidad {insight.conf}%</span>
                  </div>
                  <p>“{insight.texto}”</p>
                  <div className="rc-insight-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setToast({ tipo: 'ok', texto: 'Cortesía aplicada a la comanda del cliente' })}
                    >
                      Aplicar Cortesía a Comanda
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setInsightDescartado(true)}>
                      Descartar
                    </button>
                  </div>
                </div>
              )}

              {/* Alerta médica */}
              {(() => {
                const alergia = ficha.preferencias.find((p) => p.severidad === 'critica');
                if (!alergia) return null;
                return (
                  <div className="rc-medica">
                    <div className="rc-medica-head">🏥 Alerta Médica de Cocina (Crucial)</div>
                    <p>
                      <strong>{alergia.clave}</strong> — {alergia.valor}. Notificar explícitamente al Jefe de Cocina
                      para desinfección de plancha y verificar que los postres no presenten trazas cruzadas.
                    </p>
                  </div>
                );
              })()}

              {/* Preferencias */}
              <div className="rc-sec">
                <h4>PREFERENCIAS REGISTRADAS</h4>
                {ficha.preferencias.length === 0 ? (
                  <p className="text-muted text-sm">Sin preferencias registradas.</p>
                ) : (
                  <ul className="rc-prefs">
                    {ficha.preferencias.map((p) => (
                      <li key={p.clave} className={p.severidad === 'critica' ? 'critica' : ''}>
                        <span className="rc-pref-ico">{p.severidad === 'critica' ? '⚠' : '✓'}</span>
                        <div>
                          <strong>{p.clave}</strong>
                          <span>{p.valor}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Reseñas */}
              <div className="rc-sec">
                <h4>ÚLTIMAS VISITAS &amp; FEEDBACK</h4>
                {ficha.resenas.length === 0 ? (
                  <p className="text-muted text-sm">Todavía sin reseñas.</p>
                ) : (
                  <div className="rc-resenas">
                    {ficha.resenas.slice(0, 4).map((r, i) => (
                      <div key={i} className="rc-resena">
                        <div className="rc-resena-top">
                          <span className="rc-resena-fecha">
                            {fechaCorta(r.fecha)}
                            {r.comanda && <> · {r.comanda}</>}
                          </span>
                          <span className="rc-estrellas" aria-label={`${r.puntuacion} de 5`}>
                            {'★'.repeat(r.puntuacion)}
                            <i>{'★'.repeat(Math.max(0, 5 - r.puntuacion))}</i>
                          </span>
                        </div>
                        <p>{r.comentario}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Notas maître */}
              <div className="rc-sec">
                <div className="rc-sec-head">
                  <h4>NOTAS DEL MAÎTRE / SOMMELIER</h4>
                  <button className="rc-add-nota" onClick={() => setEditandoNota((v) => !v)}>＋ Añadir Nota</button>
                </div>
                {editandoNota && (
                  <div className="rc-nota-edit">
                    <input
                      type="text"
                      placeholder="Nota rápida para el equipo de sala…"
                      value={notaBorrador}
                      onChange={(e) => setNotaBorrador(e.target.value)}
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        if (notaBorrador.trim()) {
                          setNotasLocales((p) => [...p, notaBorrador.trim()]);
                          setNotaBorrador('');
                          setEditandoNota(false);
                          setToast({ tipo: 'ok', texto: 'Nota añadida a la ficha' });
                        }
                      }}
                    >
                      Guardar
                    </button>
                  </div>
                )}
                <div className="rc-notas">
                  {ficha.notas && <p className="rc-nota">“{ficha.notas}”</p>}
                  {notasLocales.map((n, i) => (
                    <p key={i} className="rc-nota nueva">“{n}”</p>
                  ))}
                  {!ficha.notas && notasLocales.length === 0 && (
                    <p className="text-muted text-sm">Sin notas del maître.</p>
                  )}
                </div>
              </div>

              {/* Ambiente */}
              <div className="rc-ambiente">
                <div className="rc-ambiente-head">
                  <span>Ambiente Asignado: <strong>{ambiente.titulo}</strong></span>
                  <span className="badge badge-success no-dot">{ambiente.clima}</span>
                </div>
                <div className="rc-ambiente-foto">
                  <span className="rc-ambiente-emoji">{ambiente.emoji}</span>
                  <p>{ambiente.texto}</p>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ============ Lista de espera ============ */}
      <section className="rc-wait card">
        <div className="rc-wait-head">
          <div className="rc-wait-title">
            <span className="rc-wait-ico">⏰</span>
            <div>
              <h3>Lista de Espera Inteligente (Smart Waitlist)</h3>
              <p>Sincronizado en tiempo real con tiempos de servicio y cocina (KDS)</p>
            </div>
          </div>
          <div className="rc-wait-right">
            <span className="text-muted text-sm">
              {espera.filter((g) => g.estado === 'esperando').length} mesas en espera / prontas a liberar
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setToast({ tipo: 'ok', texto: 'Alta en lista de espera (demo)' })}
            >
              ＋ Añadir a Lista
            </button>
          </div>
        </div>

        {esperaCargando ? (
          <div className="loading">Cargando lista de espera…</div>
        ) : espera.length === 0 ? (
          <div className="rc-wait-empty">
            <span>✅</span>
            <p>Nadie en espera · todas las mesas liberadas.</p>
          </div>
        ) : (
          <div className="rc-wait-grid">
            {espera.map((g) => (
              <div key={g.id} className="rc-wait-card">
                <div className="rc-wait-card-head">
                  <strong>{g.cliente} ({g.comensales} pax)</strong>
                  <span className={`badge ${g.estado === 'notificada' ? 'badge-ai' : 'badge-success'} no-dot`}>
                    {g.estado === 'notificada' ? '● Notificada' : '● Disponible'}
                  </span>
                </div>
                <div className="rc-wait-meta">
                  <span>⏳ Est. ~{g.tiempo_espera_est_min} min</span>
                  {g.zona && <span>📍 Prefiere {g.zona}</span>}
                  <span>#{g.posicion} en cola</span>
                </div>
                {g.notas && <p className="rc-wait-notas">{g.notas}</p>}
                <div className="rc-wait-actions">
                  <button
                    className="btn btn-primary btn-sm flex-1"
                    disabled={g.estado === 'notificada'}
                    onClick={() => notificarEspera(g)}
                  >
                    📱 {g.estado === 'notificada' ? 'Mesa Notificada' : 'Notificar Mesa Lista via SMS'}
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => setToast({ tipo: 'ok', texto: `Pre-alerta enviada a ${g.cliente}` })}
                  >
                    🔔 Pre-alertar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
