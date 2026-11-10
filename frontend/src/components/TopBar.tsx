export function TopBar() {
  return (
    <header className="topbar">
      <div className="command-search">
        <span>✦</span>
        <input
          placeholder="Consultar al Asistente IA o buscar mesa, comanda o plato..."
          readOnly
          onFocus={(e) => {
            e.currentTarget.placeholder = 'Escribe una consulta para el Asistente IA...';
          }}
        />
        <kbd>⌘K</kbd>
      </div>

      <div className="topbar-right">
        <span className="bell">
          🔔<span className="dot" />
        </span>
        <div className="user-chip">
          <div className="avatar">MR</div>
          <div>
            <div className="u-name">Mateo Rossi</div>
            <div className="u-role">Jefe de Sala</div>
          </div>
        </div>
      </div>
    </header>
  );
}
