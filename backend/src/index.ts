import express from 'express';
import cors from 'cors';
import { pool } from './db/pool';
import { router as mesasRouter } from './routes/mesas';
import { router as pedidosRouter } from './routes/pedidos';
import { router as menuRouter } from './routes/menu';
import { router as reservasRouter } from './routes/reservas';
import { router as clientesRouter } from './routes/clientes';
import { router as cuentasRouter } from './routes/cuentas';
import { router as inventarioRouter } from './routes/inventario';
import { router as analiticasRouter } from './routes/analiticas';
import { router as iaRouter } from './routes/ia';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

// Estado del servicio (para el widget del sidebar)
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ db: 'ok', service: 'ok', time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ db: 'error', service: 'degraded', error: String(e) });
  }
});

app.use('/api/mesas', mesasRouter);
app.use('/api/pedidos', pedidosRouter);
app.use('/api/menu', menuRouter);
app.use('/api/reservas', reservasRouter);
app.use('/api/clientes', clientesRouter);
app.use('/api/cuentas', cuentasRouter);
app.use('/api/inventario', inventarioRouter);
app.use('/api/analiticas', analiticasRouter);
app.use('/api/ia', iaRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error no controlado:', err);
  res.status(500).json({ error: err.message || 'Error interno' });
});

app.listen(PORT, () => {
  console.log(`🍽️  SavorAI API escuchando en http://localhost:${PORT}/api`);
});
