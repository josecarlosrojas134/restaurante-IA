import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';

/** Envuelve handlers async para propagar errores al middleware de error. */
export function ah(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export const router = Router();

// GET /api/mesas?zona=interior|exterior&estado=libre
router.get(
  '/',
  ah(async (req, res) => {
    const { zona, estado } = req.query;
    const where: string[] = [];
    const params: unknown[] = [];
    if (estado) {
      params.push(estado);
      where.push(`m.estado = $${params.length}`);
    }
    if (zona) {
      params.push(zona);
      where.push(`z.tipo = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT m.id, m.codigo, m.capacidad, m.estado, m.ambiente, m.posx, m.posy,
              z.nombre AS zona, z.nombre_corto AS zona_corto, z.tipo AS zona_tipo,
              c.numero AS comanda_numero, c.comensales, c.abierta_en,
              u.nombre AS camarero,
              (SELECT COALESCE(SUM(l.cantidad * l.precio_unitario), 0)
                 FROM comandas cc
                 JOIN lineas_comanda l ON l.comanda_id = cc.id
                WHERE cc.mesa_id = m.id AND cc.estado NOT IN ('cobrada','cancelada')) AS importe_comanda
         FROM mesas m
         JOIN zonas z ON z.id = m.zona_id
         LEFT JOIN LATERAL (
            SELECT * FROM comandas c2
            WHERE c2.mesa_id = m.id AND c2.estado IN ('pendiente','en_cocina','lista','entregada')
            ORDER BY c2.abierta_en DESC LIMIT 1
         ) c ON TRUE
         LEFT JOIN usuarios u ON u.id = c.camarero_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY z.orden, m.posx, m.posy`,
      params
    );
    res.json(rows);
  })
);

// GET /api/mesas/resumen — KPIs del mapa de mesas
router.get(
  '/resumen',
  ah(async (_req, res) => {
    const { rows } = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE estado='libre')::int AS libres,
             COUNT(*) FILTER (WHERE estado='ocupada')::int AS ocupadas,
             COUNT(*) FILTER (WHERE estado='reservada')::int AS reservadas,
             COUNT(*) FILTER (WHERE estado='cuenta_solicitada')::int AS cuentas,
             COALESCE(SUM(CASE WHEN estado IN ('ocupada','cuenta_solicitada')
                 THEN (SELECT COALESCE(SUM(l.cantidad*l.precio_unitario),0)
                         FROM comandas c JOIN lineas_comanda l ON l.comanda_id=c.id
                        WHERE c.mesa_id = mesas.id AND c.estado NOT IN ('cobrada','cancelada'))
                 ELSE 0 END), 0)::numeric(12,2) AS venta_activa
      FROM mesas
    `);
    res.json(rows[0]);
  })
);

// PATCH /api/mesas/:id — cambiar estado (liberar, ocupar, transferir, cuenta solicitada)
router.patch(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const { estado, ambiente } = req.body;
    const validos = ['libre', 'ocupada', 'reservada', 'cuenta_solicitada', 'limpieza', 'mantenimiento'];
    if (estado && !validos.includes(estado)) {
      res.status(400).json({ error: `Estado inválido. Usa: ${validos.join(', ')}` });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE mesas SET estado = COALESCE($1, estado), ambiente = COALESCE($2, ambiente)
       WHERE id = $3 RETURNING *`,
      [estado || null, ambiente || null, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Mesa no encontrada' });
      return;
    }
    res.json(rows[0]);
  })
);
