import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Fila compacta de métrica en vivo (esquinas de las pantallas) */
export function LiveStat({
  icon,
  label,
  valor,
  sub,
  color,
}: {
  icon: string;
  label: string;
  valor: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="card-flat" style={{ padding: '10px 14px', minWidth: 150 }}>
      <div className="row" style={{ gap: 8 }}>
        <span style={{ fontSize: 15, color: color || 'var(--primary)' }}>{icon}</span>
        <div>
          <div className="text-xs text-muted" style={{ fontWeight: 600 }}>
            {label}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
            {valor}
            {sub && <span className="text-xs text-muted" style={{ fontWeight: 500 }}> {sub}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Salud de la conexión con la API + BD */
export function useHealth() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .health()
      .then((h) => setOk(h.db === 'ok'))
      .catch(() => setOk(false));
    const t = setInterval(() => {
      api
        .health()
        .then((h) => setOk(h.db === 'ok'))
        .catch(() => setOk(false));
    }, 15000);
    return () => clearInterval(t);
  }, []);
  return ok;
}
