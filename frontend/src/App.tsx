import { Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import MesasZonas from './pages/MesasZonas';
import GestionPedidos from './pages/GestionPedidos';
import MenuTomaPedidos from './pages/MenuTomaPedidos';
import ReservasClientes from './pages/ReservasClientes';
import AsistenteIA from './pages/AsistenteIA';
import AnaliticasFacturacion from './pages/AnaliticasFacturacion';

export default function App() {
  return (
    <div className="app">
      <Sidebar />
      <div className="app-main">
        <TopBar />
        <Routes>
          <Route path="/" element={<Navigate to="/mesas" replace />} />
          <Route path="/mesas" element={<MesasZonas />} />
          <Route path="/pedidos" element={<GestionPedidos />} />
          <Route path="/menu" element={<MenuTomaPedidos />} />
          <Route path="/reservas" element={<ReservasClientes />} />
          <Route path="/ia" element={<AsistenteIA />} />
          <Route path="/analiticas" element={<AnaliticasFacturacion />} />
          <Route path="*" element={<Navigate to="/mesas" replace />} />
        </Routes>
      </div>
    </div>
  );
}
