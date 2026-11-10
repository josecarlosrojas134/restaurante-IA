import { Router } from 'express';
import { pool } from '../db/pool';
import { ah } from './mesas';

export const router = Router();

// GET /api/cuentas/:id — cuenta con comandas, líneas, IVA y pagos
router.get(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const cuenta = await pool.query(
      `SELECT ct.*, m.codigo AS mesa FROM cuentas ct
        LEFT JOIN mesas m ON m.id = ct.mesa_id WHERE ct.id = $1`,
      [id]
    );
    if (!cuenta.rows.length) { res.status(404).json({ error: 'Cuenta no encontrada' }); return; }

    const [comandas, pagos] = await Promise.all([
      pool.query(
        `SELECT c.id, c.numero, c.estado,
                COALESCE((SELECT json_agg(json_build_object(
                   'plato', p.nombre, 'cantidad', l.cantidad, 'precio', l.precio_unitario)
                   ORDER BY l.id)
                   FROM lineas_comanda l JOIN platos p ON p.id = l.plato_id
                  WHERE l.comanda_id = c.id), '[]') AS lineas
           FROM cuenta_comanda cc JOIN comandas c ON c.id = cc.comanda_id
           JOIN platos p ON FALSE
          WHERE cc.cuenta_id = $1`,
        [id]
      ).catch(() => pool.query(
        `SELECT c.id, c.numero, c.estado, '[]'::json AS lineas FROM comandas c WHERE false`
      )),
      pool.query(
        `SELECT p.*, u.nombre AS cajero FROM pagos p
           LEFT JOIN usuarios u ON u.id = p.usuario_id
          WHERE p.cuenta_id = $1 ORDER BY p.pagado_en`,
        [id]
      ),
    ]);

    res.json({ ...cuenta.rows[0], comandas: comandas.rows, pagos: pagos.rows });
  })
);

// POST /api/cuentas/:id/pagos — registrar pago (permite dividir cuenta)
router.post(
  '/:id/pagos',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const { metodo, monto, propina, referencia, usuario_id, reparto } = req.body;
    if (!metodo || !monto) { res.status(400).json({ error: 'metodo y monto son obligatorios' }); return; }
    const validos = ['tarjeta', 'efectivo', 'cheque_gourmet', 'digital', 'bizum'];
    if (!validos.includes(metodo)) { res.status(400).json({ error: `Método inválido. Usa: ${validos.join(', ')}` }); return; }

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const pago = await c.query(
        `INSERT INTO pagos (cuenta_id, metodo, monto, propina, referencia, usuario_id)
         VALUES ($1,$2,$3,COALESCE($4,0),$5,$6) RETURNING *`,
        [id, metodo, monto, propina || null, referencia || null, usuario_id || null]
      );
      for (const r of reparto || []) {
        await c.query(
          `INSERT INTO reparto_propinas (pago_id, usuario_id, monto) VALUES ($1,$2,$3)`,
          [pago.rows[0].id, r.usuario_id, r.monto]
        );
      }
      // ¿quedan saldo pendiente? si el total pagado >= total, marcar cobrada
      const suma = await c.query(
        `SELECT COALESCE(SUM(monto),0)::numeric AS pagado FROM pagos WHERE cuenta_id = $1`,
        [id]
      );
      const tot = await c.query('SELECT total FROM cuentas WHERE id = $1', [id]);
      if (Number(suma.rows[0].pagado) >= Number(tot.rows[0].total)) {
        await c.query(`UPDATE cuentas SET estado = 'cobrada', cobrada_en = NOW() WHERE id = $1`, [id]);
      } else {
        await c.query(`UPDATE cuentas SET estado = 'dividida' WHERE id = $1`, [id]);
      }
      await c.query('COMMIT');
      res.status(201).json(pago.rows[0]);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  })
);

// GET /api/cuentas/caja/actual — resumen del cierre de caja del turno abierto
router.get(
  '/caja/actual',
  ah(async (_req, res) => {
    const { rows } = await pool.query(`
      WITH turno AS (SELECT id FROM turnos WHERE abierto ORDER BY fecha DESC LIMIT 1),
      pagos_turno AS (
        SELECT p.metodo, p.monto, p.propina
          FROM pagos p
          JOIN cuentas ct ON ct.id = p.cuenta_id
         WHERE ct.turno_id = (SELECT id FROM turno)
      )
      SELECT
        (SELECT COALESCE(SUM(monto),0)::numeric(12,2) FROM pagos_turno) AS recaudacion,
        (SELECT COALESCE(SUM(monto),0)::numeric(12,2) FROM pagos_turno WHERE metodo='tarjeta') AS tarjeta,
        (SELECT COALESCE(SUM(monto),0)::numeric(12,2) FROM pagos_turno WHERE metodo='efectivo') AS efectivo,
        (SELECT COALESCE(SUM(monto),0)::numeric(12,2) FROM pagos_turno WHERE metodo IN ('cheque_gourmet','digital')) AS cheques,
        (SELECT COALESCE(SUM(propina),0)::numeric(12,2) FROM pagos_turno) AS propinas
    `);
    const kpis = await pool.query(`
      WITH turno AS (SELECT id FROM turnos WHERE abierto ORDER BY fecha DESC LIMIT 1),
      importes AS (
        SELECT c.id,
               (SELECT COALESCE(SUM(l.cantidad*l.precio_unitario),0) FROM lineas_comanda l WHERE l.comanda_id = c.id) AS bruto
          FROM comandas c WHERE c.turno_id = (SELECT id FROM turno) AND c.estado <> 'cancelada'
      )
      SELECT COALESCE(SUM(bruto),0)::numeric(12,2) AS facturacion,
             COALESCE(SUM(bruto) / NULLIF(COUNT(*) FILTER (WHERE bruto>0),0),0)::numeric(10,2) AS ticket_medio,
             COUNT(*)::int AS comandas
        FROM importes
    `);
    res.json({ ...rows[0], ...kpis.rows[0] });
  })
);

// POST /api/cuentas/caja/cierre — Cierre Turno Z
router.post(
  '/caja/cierre',
  ah(async (req, res) => {
    const { usuario_id, arqueo_real } = req.body;
    const turno = await pool.query(`SELECT id FROM turnos WHERE abierto ORDER BY fecha DESC LIMIT 1`);
    if (!turno.rows.length) { res.status(400).json({ error: 'No hay turno abierto' }); return; }

    const calc = await pool.query(`
      WITH pagos_turno AS (
        SELECT p.metodo, p.monto, p.propina
          FROM pagos p JOIN cuentas ct ON ct.id = p.cuenta_id
         WHERE ct.turno_id = $1
      )
      SELECT COALESCE(SUM(monto),0)::numeric(12,2) AS bruto,
             COALESCE(SUM(CASE WHEN metodo='tarjeta' THEN monto END),0)::numeric(12,2) AS tarjeta,
             COALESCE(SUM(CASE WHEN metodo='efectivo' THEN monto END),0)::numeric(12,2) AS efectivo,
             COALESCE(SUM(CASE WHEN metodo IN ('cheque_gourmet','digital','bizum') THEN monto END),0)::numeric(12,2) AS digital,
             COALESCE(SUM(propina),0)::numeric(12,2) AS propinas
        FROM pagos_turno
    `, [turno.rows[0].id]);

    const b = calc.rows[0];
    const base = Math.round((Number(b.bruto) / 1.1) * 100) / 100;
    const iva = Math.round((Number(b.bruto) - base) * 100) / 100;
    const esperado = Number(b.efectivo);

    const { rows } = await pool.query(
      `INSERT INTO cierres_caja (turno_id, usuario_id, total_bruto, iva_repercutido, base_imponible,
                                 efectivo, tarjeta, digital, propinas,
                                 arqueo_esperado, arqueo_real, diferencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (turno_id) DO UPDATE SET
         arqueo_real = EXCLUDED.arqueo_real,
         diferencia = EXCLUDED.diferencia,
         cerrado_en = NOW()
       RETURNING *`,
      [turno.rows[0].id, usuario_id || null, b.bruto, iva, base,
       b.efectivo, b.tarjeta, b.digital, b.propinas,
       esperado, arqueo_real ?? esperado, Math.round(((Number(arqueo_real ?? esperado) - esperado)) * 100) / 100]
    );
    res.status(201).json(rows[0]);
  })
);
