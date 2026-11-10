import { Router } from 'express';
import { pool } from '../db/pool';
import { ah } from './mesas';

export const router = Router();

// GET /api/inventario — insumos con alertas de stock mínimo
router.get(
  '/',
  ah(async (_req, res) => {
    const { rows } = await pool.query(`
      SELECT i.id, i.nombre, i.unidad, i.stock_actual, i.stock_minimo, i.costo_unitario,
             p.nombre AS proveedor,
             CASE WHEN i.stock_actual <= i.stock_minimo THEN 'critico'
                  WHEN i.stock_actual <= i.stock_minimo * 1.3 THEN 'bajo'
                  ELSE 'ok' END AS alerta
        FROM insumos i
        LEFT JOIN proveedores p ON p.id = i.proveedor_id
       WHERE i.activo
       ORDER BY (i.stock_actual - i.stock_minimo) ASC
    `);
    res.json(rows);
  })
);

// GET /api/inventario/stock/:platoId — raciones restantes de un plato
router.get(
  '/stock/:platoId',
  ah(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.id, p.nombre,
              i.nombre AS insumo, i.stock_actual, i.unidad, r.cantidad AS cantidad_por_racion,
              FLOOR(i.stock_actual / NULLIF(r.cantidad,0))::int AS raciones_restantes
         FROM recetas r
         JOIN platos p ON p.id = r.plato_id
         JOIN insumos i ON i.id = r.insumo_id
        WHERE r.plato_id = $1`,
      [req.params.platoId]
    );
    if (!rows.length) { res.status(404).json({ error: 'Plato sin receta asociada' }); return; }
    res.json({
      plato: rows[0].nombre,
      raciones_restantes: Math.min(...rows.map((r) => r.raciones_restantes ?? Infinity)),
      ingredientes: rows,
    });
  })
);

// POST /api/inventario/movimientos — registrar entrada/salida/ajuste/merma
router.post(
  '/movimientos',
  ah(async (req, res) => {
    const { insumo_id, tipo, cantidad, motivo, usuario_id } = req.body;
    if (!insumo_id || !tipo || !cantidad) {
      res.status(400).json({ error: 'insumo_id, tipo y cantidad son obligatorios' });
      return;
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const mov = await c.query(
        `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, motivo, usuario_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [insumo_id, tipo, cantidad, motivo || null, usuario_id || null]
      );
      const signo = tipo === 'entrada' ? 1 : -1;
      await c.query(
        `UPDATE insumos SET stock_actual = GREATEST(0, stock_actual + $1 * $2) WHERE id = $3`,
        [signo, Math.abs(cantidad), insumo_id]
      );
      await c.query('COMMIT');
      res.status(201).json(mov.rows[0]);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  })
);

// GET /api/inventario/ordenes — órdenes de compra (incluye las generadas por IA)
router.get(
  '/ordenes',
  ah(async (_req, res) => {
    const { rows } = await pool.query(`
      SELECT o.id, o.estado, o.total, o.origen_ia, o.creada_en, p.nombre AS proveedor,
             u.nombre AS creada_por,
             COALESCE((SELECT json_agg(json_build_object(
                'insumo', i.nombre, 'cantidad', lo.cantidad, 'costo', lo.costo_unitario))
                FROM lineas_orden_compra lo JOIN insumos i ON i.id = lo.insumo_id
               WHERE lo.orden_id = o.id), '[]') AS lineas
        FROM ordenes_compra o
        JOIN proveedores p ON p.id = o.proveedor_id
        LEFT JOIN usuarios u ON u.id = o.creada_por
       ORDER BY o.creada_en DESC
    `);
    res.json(rows);
  })
);

// POST /api/inventario/ordenes — crear orden (acepta origen_ia)
router.post(
  '/ordenes',
  ah(async (req, res) => {
    const { proveedor_id, lineas, creada_por, origen_ia } = req.body;
    if (!proveedor_id || !lineas?.length) {
      res.status(400).json({ error: 'proveedor_id y al menos una línea son obligatorios' });
      return;
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const total = lineas.reduce(
        (s: number, l: { cantidad: number; costo_unitario: number }) => s + l.cantidad * l.costo_unitario, 0
      );
      const ord = await c.query(
        `INSERT INTO ordenes_compra (proveedor_id, estado, total, origen_ia, creada_por)
         VALUES ($1,'pendiente',$2,$3,$4) RETURNING *`,
        [proveedor_id, Math.round(total * 100) / 100, !!origen_ia, creada_por || null]
      );
      for (const l of lineas) {
        await c.query(
          `INSERT INTO lineas_orden_compra (orden_id, insumo_id, cantidad, costo_unitario)
           VALUES ($1,$2,$3,$4)`,
          [ord.rows[0].id, l.insumo_id, l.cantidad, l.costo_unitario || 0]
        );
      }
      await c.query('COMMIT');
      res.status(201).json(ord.rows[0]);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  })
);
