import { useEffect, useMemo, useState } from 'react';
import { api, type Categoria, type Mesa, type Plato } from '../lib/api';
import { desde, eur } from '../lib/format';
import './MenuTomaPedidos.css';

/** Normaliza acentos y mayúsculas para la búsqueda de platos */
const norm = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const ICONO_CAT: Record<string, string> = {
  utensils: '🍴',
  flame: '🔥',
  fish: '🐟',
  bowl: '🍚',
  cake: '🍰',
  wine: '🍷',
};

const BADGE_ETIQUETA: Record<string, string> = {
  'Recomendado IA': 'badge-ai',
  'Top Ventas': 'badge-success',
  'Especial Chef': 'badge-danger',
  'Postre Insignia': 'badge-danger',
  'Entrante Clásico': 'badge-neutral',
  Vegetariano: 'badge-success',
  Vegano: 'badge-success',
  Estrella: 'badge-warning',
};

/** Gradientes cálidos "Warm Culinary Intelligence" para los placeholders de imagen */
const GRADIENTES: string[] = [
  'linear-gradient(135deg, #a83223 0%, #30312f 100%)',
  'linear-gradient(135deg, #d97706 0%, #58413d 100%)',
  'linear-gradient(135deg, #1b6d24 0%, #1e232a 100%)',
  'linear-gradient(135deg, #c94a38 0%, #8a1c10 100%)',
  'linear-gradient(135deg, #70757d 0%, #1e232a 100%)',
  'linear-gradient(135deg, #4f46e5 0%, #30312f 100%)',
];

const PARTIDA_LABEL: Record<string, string> = {
  entrante: 'Entrante',
  principal: 'Principal',
  postre: 'Postre',
  bebida: 'Bebida',
};

/** Categoría → partida de comanda */
function partidaDe(categoria: string): string {
  if (categoria.startsWith('Entrantes')) return 'entrante';
  if (categoria.startsWith('Postres')) return 'postre';
  if (categoria.startsWith('Bebidas')) return 'bebida';
  return 'principal';
}

interface Linea {
  key: string;
  plato_id: number;
  nombre: string;
  precio: number;
  cantidad: number;
  asiento: number | null;
  partida: string;
  notas: string;
}

type PlatoVista = Plato & { cat: string; icono: string };

interface Toast {
  tipo: 'ok' | 'error';
  texto: string;
}

export default function MenuTomaPedidos() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fila superior
  const [zonaActiva, setZonaActiva] = useState<'salon' | 'patio'>('patio');

  // Buscador / filtros
  const [query, setQuery] = useState('');
  const [dietas, setDietas] = useState({ gluten: false, vegano: false, lactosa: false });
  const [catActiva, setCatActiva] = useState<number | null>(null);

  // Comanda
  const [cart, setCart] = useState<Linea[]>([]);
  const [asientoSel, setAsientoSel] = useState<number | 'todos'>(1);
  const [editando, setEditando] = useState<string | null>(null);
  const [borradorNotas, setBorradorNotas] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [confirmacion, setConfirmacion] = useState<string | null>(null);
  const [ticket, setTicket] = useState('2041');
  const [toast, setToast] = useState<Toast | null>(null);

  // Tiempo de servicio (arranca hace 14m, como en el diseño)
  const [ahora, setAhora] = useState(() => Date.now());
  const inicioServicio = useMemo(() => Date.now() - 14 * 60 * 1000, []);

  const cargar = () => {
    setCargando(true);
    setError(null);
    Promise.all([api.menu(), api.mesas()])
      .then(([cats, ms]) => {
        setCategorias(cats);
        setMesas(ms);
        if (cats.length) setCatActiva((prev) => prev ?? cats[0].id);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Error al cargar el menú'))
      .finally(() => setCargando(false));
  };

  useEffect(cargar, []);

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!confirmacion) return;
    const t = setTimeout(() => setConfirmacion(null), 6000);
    return () => clearTimeout(t);
  }, [confirmacion]);

  /** Platos aplanados con su categoría */
  const platosTodos: PlatoVista[] = useMemo(
    () => categorias.flatMap((c) => c.platos.map((p) => ({ ...p, cat: c.nombre, icono: c.icono }))),
    [categorias]
  );

  const pasaDietas = (p: Plato): boolean => {
    if (dietas.gluten && p.alergenos.includes('Gluten')) return false;
    if (dietas.lactosa && p.alergenos.includes('Lácteos')) return false;
    if (dietas.vegano && !p.etiquetas.includes('Vegano')) return false;
    return true;
  };

  const coincideQuery = (p: PlatoVista): boolean => {
    if (!query.trim()) return true;
    const q = norm(query);
    return norm(p.nombre).includes(q) || norm(p.descripcion).includes(q);
  };

  /** Grid: con búsqueda se busca en todo el menú; sin ella se muestra la categoría activa */
  const visibles: PlatoVista[] = useMemo(() => {
    const base = query.trim()
      ? platosTodos
      : platosTodos.filter((p) => p.categoria_id === catActiva);
    return base.filter((p) => coincideQuery(p) && pasaDietas(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platosTodos, query, catActiva, dietas]);

  const cuentaCat = (cat: Categoria): number =>
    cat.platos.filter((p) => coincideQuery({ ...p, cat: cat.nombre, icono: cat.icono }) && pasaDietas(p)).length;

  // ---- Sugerencia IA (banner de ritmo de pase) ----
  const brasas = useMemo(
    () => categorias.find((c) => c.nombre.includes('Brasas')) ?? categorias[0],
    [categorias]
  );
  const sugeridos = useMemo(() => {
    if (!brasas) return [];
    return [...brasas.platos].sort((a, b) => a.tiempo_prep_min - b.tiempo_prep_min).slice(0, 2);
  }, [brasas]);

  // ---- Maridaje IA ----
  const copa = useMemo(() => {
    const bebidas = categorias.find((c) => c.nombre.includes('Bebidas'));
    if (!bebidas) return null;
    return bebidas.platos.find((p) => norm(p.nombre).includes('copa')) ?? bebidas.platos[0] ?? null;
  }, [categorias]);

  const mesaChip =
    zonaActiva === 'patio'
      ? { codigo: 'P-04', zona: 'Terraza Jardín' }
      : { codigo: 'M-06', zona: 'Salón Central' };
  const mesaObj = mesas.find((m) => m.codigo === mesaChip.codigo) ?? null;

  // ---- Totales ----
  const subtotal = cart.reduce((s, l) => s + l.precio * l.cantidad, 0);
  const iva = subtotal * 0.1;
  const total = subtotal + iva;
  const articulos = cart.reduce((s, l) => s + l.cantidad, 0);

  // ---- Acciones del carrito ----
  const anadir = (p: PlatoVista) => {
    const asiento = asientoSel === 'todos' ? null : asientoSel;
    const partida = partidaDe(p.cat);
    setConfirmacion(null);
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.plato_id === p.id && l.asiento === asiento);
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + 1 };
        return copia;
      }
      return [
        ...prev,
        {
          key: `${p.id}-${asiento ?? 't'}-${Date.now()}`,
          plato_id: p.id,
          nombre: p.nombre,
          precio: Number(p.precio),
          cantidad: 1,
          asiento,
          partida,
          notas: '',
        },
      ];
    });
    setToast({ tipo: 'ok', texto: `${p.nombre} añadido a la comanda` });
  };

  const cambiarCantidad = (key: string, delta: number) =>
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, cantidad: l.cantidad + delta } : l))
        .filter((l) => l.cantidad > 0)
    );

  const guardarNotas = (key: string) => {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, notas: borradorNotas.trim() } : l)));
    setEditando(null);
    setBorradorNotas('');
  };

  const enviarComanda = async () => {
    if (!cart.length || enviando) return;
    setEnviando(true);
    try {
      const comanda = await api.crearPedido({
        mesa_id: mesaObj?.id,
        comensales: 4,
        canal: 'salon',
        lineas: cart.map((l) => ({
          plato_id: l.plato_id,
          cantidad: l.cantidad,
          asiento: l.asiento ?? undefined,
          partida: l.partida,
          notas: l.notas || undefined,
        })),
      });
      setCart([]);
      setEditando(null);
      setTicket(comanda.numero);
      setConfirmacion(`Comanda #${comanda.numero} enviada a cocina ✓`);
      setToast({ tipo: 'ok', texto: 'Comanda enviada a la estación de cocina' });
    } catch (e: unknown) {
      setToast({ tipo: 'error', texto: e instanceof Error ? e.message : 'Error al enviar la comanda' });
    } finally {
      setEnviando(false);
    }
  };

  const toggleDieta = (k: keyof typeof dietas) => setDietas((d) => ({ ...d, [k]: !d[k] }));

  if (cargando) return <div className="app-content"><div className="loading">Cargando menú…</div></div>;

  if (error)
    return (
      <div className="app-content">
        <div className="mt-error">
          <span>⚠️</span>
          <p>{error}</p>
          <button className="btn btn-outline" onClick={cargar}>Reintentar</button>
        </div>
      </div>
    );

  return (
    <div className="app-content mt-page">
      {toast && <div className={`mt-toast ${toast.tipo}`}>{toast.texto}</div>}

      {/* ============ Fila superior ============ */}
      <div className="mt-topbar">
        <div className="mt-topbar-left">
          <div className="mt-seg" role="tablist" aria-label="Zona del restaurante">
            <button
              className={zonaActiva === 'salon' ? 'on' : ''}
              onClick={() => setZonaActiva('salon')}
            >
              🪑 Salón Interior
            </button>
            <button
              className={zonaActiva === 'patio' ? 'on' : ''}
              onClick={() => setZonaActiva('patio')}
            >
              🌿 Patio / Terraza
            </button>
          </div>
          <div className="mt-mesa-chip">
            <span className="mt-dot" />
            <strong>Mesa {mesaChip.codigo}</strong>
            <span className="mt-mesa-zona">{mesaChip.zona}</span>
          </div>
        </div>
        <div className="mt-topbar-actions">
          <button className="btn btn-outline" onClick={() => setToast({ tipo: 'ok', texto: 'Selector de mesas abierto (demo)' })}>
            ⚡ Cambiar Mesa
          </button>
          <button className="btn btn-outline" onClick={() => setToast({ tipo: 'ok', texto: 'División de cuenta por comensal (demo)' })}>
            ⧉ Dividir Cuenta
          </button>
        </div>
      </div>

      <div className="mt-meta-row">
        <span className="mt-meta-chip">👥 4 Comensales</span>
        <span className="mt-meta-chip">🧑‍🍳 Camarero: Mateo R.</span>
        <span className="badge badge-success no-dot mt-meta-live">
          ● Servicio Abierto · {desde(Math.floor((ahora - inicioServicio) / 1000))}
        </span>
      </div>

      {/* ============ Cuerpo: centro + comanda ============ */}
      <div className="mt-body">
        {/* ---------- Columna central ---------- */}
        <section className="mt-center">
          <div className="mt-search-row">
            <div className="mt-search">
              <span className="mt-search-ico">🔍</span>
              <input
                type="text"
                placeholder="Buscar por plato, ingrediente…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button className="mt-search-clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
                  ✕
                </button>
              )}
            </div>
            <div className="mt-diets">
              <span className="mt-diets-label">DIETAS:</span>
              <button className={`filter-chip${dietas.gluten ? ' active' : ''}`} onClick={() => toggleDieta('gluten')}>
                ✓ Sin Gluten
              </button>
              <button className={`filter-chip${dietas.vegano ? ' active' : ''}`} onClick={() => toggleDieta('vegano')}>
                🌱 Vegano
              </button>
              <button className={`filter-chip${dietas.lactosa ? ' active' : ''}`} onClick={() => toggleDieta('lactosa')}>
                🥛 Sin Lactosa
              </button>
            </div>
          </div>

          <div className="mt-tabs" role="tablist" aria-label="Categorías del menú">
            {categorias.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={catActiva === c.id && !query.trim()}
                className={`mt-tab${catActiva === c.id && !query.trim() ? ' on' : ''}`}
                onClick={() => {
                  setCatActiva(c.id);
                  setQuery('');
                }}
              >
                <span className="mt-tab-ico">{ICONO_CAT[c.icono] ?? '🍽️'}</span>
                {c.nombre}
                <span className="mt-tab-count">{cuentaCat(c)}</span>
              </button>
            ))}
          </div>

          {/* Banner sugerencia IA */}
          {brasas && sugeridos.length > 0 && (
            <div className="mt-banner">
              <div className="mt-banner-ico">✨</div>
              <div className="mt-banner-text">
                <strong>
                  Ritmo Óptimo en Brasas (Horno Josper a {Math.min(...sugeridos.map((s) => s.tiempo_prep_min))}m)
                </strong>
                <p>
                  Sugerir {sugeridos.map((s) => s.nombre).join(' y ')} para agilizar despacho…
                </p>
              </div>
              <span className="mt-banner-tag">Alta Rotación</span>
            </div>
          )}

          {/* Grid de platos */}
          {visibles.length === 0 ? (
            <div className="mt-empty">
              <span>🍽️</span>
              <p>No hay platos que coincidan con la búsqueda o los filtros de dieta.</p>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setQuery('');
                  setDietas({ gluten: false, vegano: false, lactosa: false });
                }}
              >
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div className="mt-grid">
              {visibles.map((p) => {
                const etiqueta = p.etiquetas[0];
                const bajoStock = p.raciones_restantes !== null && p.raciones_restantes <= 3;
                return (
                  <article key={p.id} className={`mt-card${!p.disponible ? ' off' : ''}`}>
                    <div
                      className="mt-card-img"
                      style={{ background: GRADIENTES[p.id % GRADIENTES.length] }}
                    >
                      <span className="mt-card-emoji">{ICONO_CAT[p.icono] ?? '🍽️'}</span>
                      <div className="mt-card-badges">
                        {etiqueta && (
                          <span className={`badge ${BADGE_ETIQUETA[etiqueta] ?? 'badge-neutral'}`}>{etiqueta}</span>
                        )}
                        {p.raciones_restantes !== null && (
                          <span className={`mt-raciones${bajoStock ? ' low' : ''}`}>
                            {p.raciones_restantes} Raciones restantes
                          </span>
                        )}
                      </div>
                      <span className="mt-price">{eur(p.precio)}</span>
                      {!p.disponible && <span className="mt-agotado">Agotado</span>}
                    </div>
                    <div className="mt-card-body">
                      <h3 className="mt-name">{p.nombre}</h3>
                      <p className="mt-desc">{p.descripcion}</p>
                      {p.alergenos.length > 0 && (
                        <div className="mt-tags">
                          {p.alergenos.map((a) => (
                            <span key={a} className="mt-tag">{a}</span>
                          ))}
                        </div>
                      )}
                      <div className="mt-card-foot">
                        <span className="mt-prep">⏱ {p.tiempo_prep_min} min prep</span>
                        <button className="btn btn-primary mt-add" disabled={!p.disponible} onClick={() => anadir(p)}>
                          ＋ Añadir
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* ---------- Columna derecha: comanda ---------- */}
        <aside className="mt-ticket">
          <div className="mt-ticket-head">
            <div>
              <h2>🧾 Comanda Activa</h2>
              <p>Ticket #{ticket} · 4 pax · {zonaActiva === 'patio' ? 'Terraza' : 'Salón'}</p>
            </div>
            <button
              className="mt-trash"
              title="Vaciar comanda"
              onClick={() => {
                setCart([]);
                setEditando(null);
              }}
            >
              🗑
            </button>
          </div>

          <div className="mt-seats">
            <span className="mt-seats-label">Asignación por Asiento:</span>
            <div className="mt-seats-chips">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  className={`mt-seat${asientoSel === n ? ' on' : ''}`}
                  onClick={() => setAsientoSel(n)}
                >
                  {n}
                </button>
              ))}
              <button
                className={`mt-seat wide${asientoSel === 'todos' ? ' on' : ''}`}
                onClick={() => setAsientoSel('todos')}
              >
                Todos
              </button>
            </div>
          </div>

          {confirmacion && <div className="mt-confirm">{confirmacion}</div>}

          <div className="mt-lines">
            {cart.length === 0 ? (
              <div className="mt-lines-empty">
                <span>📝</span>
                <p>Comanda vacía.<br />Añade platos desde el menú para empezar el servicio.</p>
              </div>
            ) : (
              cart.map((l) => (
                <div key={l.key} className="mt-line">
                  <div className="mt-line-top">
                    <strong>{l.nombre}</strong>
                    <span className="mt-line-price">{eur(l.precio * l.cantidad)}</span>
                  </div>
                  <div className="mt-line-sub">
                    {eur(l.precio)} / ud · {l.asiento !== null ? `Pax ${l.asiento}` : 'Todos los pax'}
                  </div>

                  {l.notas && editando !== l.key && <div className="mt-line-nota">“{l.notas}”</div>}

                  {editando === l.key ? (
                    <div className="mt-line-edit">
                      <input
                        autoFocus
                        type="text"
                        placeholder="Notas para cocina (ej. poco hecho…)"
                        value={borradorNotas}
                        onChange={(e) => setBorradorNotas(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') guardarNotas(l.key);
                          if (e.key === 'Escape') setEditando(null);
                        }}
                      />
                      <button className="btn btn-primary btn-sm" onClick={() => guardarNotas(l.key)}>
                        Guardar
                      </button>
                    </div>
                  ) : (
                    <div className="mt-line-controls">
                      <div className="mt-qty">
                        <button onClick={() => cambiarCantidad(l.key, -1)} aria-label="Quitar una ración">−</button>
                        <span>{l.cantidad}</span>
                        <button onClick={() => cambiarCantidad(l.key, 1)} aria-label="Añadir una ración">＋</button>
                      </div>
                      <span className={`mt-partida ${l.partida}`}>{PARTIDA_LABEL[l.partida] ?? l.partida}</span>
                      <button
                        className="mt-modificar"
                        onClick={() => {
                          setEditando(l.key);
                          setBorradorNotas(l.notas);
                        }}
                      >
                        ⚙ Modificar
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Maridaje IA */}
          {copa && (
            <div className="ai-panel mt-maridaje">
              <div className="mt-maridaje-head">
                <span className="mt-maridaje-title">🍷 MARIDAJE INTELIGENTE IA</span>
                <span className="badge badge-ai no-dot">98% Match</span>
              </div>
              <p className="mt-maridaje-txt">
                {cart.length > 0
                  ? `Para acompañar el ${cart[0].nombre}${cart[1] ? ` y el ${cart[1].nombre}` : ''}: sugerir.`
                  : 'Para acompañar tu primera selección: sugerir el vino ideal.'}
              </p>
              <div className="mt-maridaje-item">
                <span className="mt-maridaje-ico">🍷</span>
                <div>
                  <strong>{copa.nombre}</strong>
                  <span>{copa.descripcion.split('.')[0]} · {eur(copa.precio)} / copa</span>
                </div>
                <button
                  className="btn btn-dark btn-sm"
                  onClick={() =>
                    anadir({ ...copa, cat: 'Bebidas & Vinos', icono: 'wine' } as PlatoVista)
                  }
                >
                  ＋ Añadir
                </button>
              </div>
            </div>
          )}

          {/* Totales */}
          <div className="mt-totals">
            <div className="mt-total-row">
              <span>Subtotal ({articulos} artículos)</span>
              <span className="num">{eur(subtotal)}</span>
            </div>
            <div className="mt-total-row">
              <span>IVA (10% Restauración)</span>
              <span className="num">{eur(iva)}</span>
            </div>
            <div className="mt-total-big">
              <span>Total<br />Comanda</span>
              <strong>{eur(total)}</strong>
            </div>
          </div>

          <div className="mt-ticket-actions">
            <button
              className="btn btn-primary btn-lg mt-send"
              disabled={!cart.length || enviando}
              onClick={enviarComanda}
            >
              🚀 {enviando ? 'Enviando…' : `Enviar Comanda a Cocina (Zona ${zonaActiva === 'patio' ? 'Patio' : 'Salón'})`}
            </button>
            <div className="mt-ticket-actions-row">
              <button
                className="btn btn-outline flex-1"
                onClick={() => setToast({ tipo: 'ok', texto: `Pre-cuenta generada: ${eur(total)}` })}
              >
                🖨 Pre-Cuenta
              </button>
              <button
                className="btn btn-success flex-1"
                onClick={() => setToast({ tipo: 'ok', texto: `Cobro rápido de ${eur(total)} · Tarjeta` })}
              >
                💳 Cobro Rápido
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
