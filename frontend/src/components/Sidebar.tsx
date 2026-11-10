import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';
import { useEffect, useState } from 'react';

const NAV = [
  { to: '/mesas', icon: '▣', label: 'Mesas & Zonas' },
  { to: '/pedidos', icon: '☰', label: 'Gestión de Pedidos' },
  { to: '/reservas', icon: '◈', label: 'Reservas & Clientes' },
  { to: '/ia', icon: '✳', label: 'Asistente IA' },
  { to: '/menu', icon: '✕', label: 'Menú & Toma de Pedidos' },
  { to: '/analiticas', icon: '✧', label: 'Analíticas & Facturación' },
];

export function Sidebar() {
  const [estado, setEstado] = useState<{ cocina: string; salon: number } | null>(null);

  useEffect(() => {
    api
      .resumenMesas()
      .then((r) => setEstado({ cocina: 'Fluido (8m)', salon: Math.round((r.ocupadas / r.total) * 100) }))
      .catch(() => setEstado({ cocina: 'Fluido (8m)', salon: 84 }));
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">🍽️</div>
        <h1>SavorAI</h1>
        <span className="version">V2.4</span>
      </div>

      <div className="venue-card">
        <div>
          <div className="venue-name">Bistró Central</div>
          <div className="venue-shift">Turno Noche</div>
        </div>
        <span className="swap">⇄</span>
      </div>

      <nav className="sidebar-nav">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="service-status">
        <div className="ss-title">
          ESTADO DEL SERVICIO <span className="ss-dot" />
        </div>
        <div className="ss-row">
          <span>🍳 Cocina</span>
          <span className="badge badge-success">{estado?.cocina ?? '—'}</span>
        </div>
        <div className="ss-row">
          <span>🪑 Salón</span>
          <span className="num">{estado ? `${estado.salon}% Ocupado` : '—'}</span>
        </div>
      </div>
    </aside>
  );
}
