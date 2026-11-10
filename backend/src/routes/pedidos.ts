import { Router } from 'express';
import { pool } from '../db/pool';
import { ah } from './mesas';

export const router = Router();

const SELECT_COMANDA = `
  SELECT c.id, c.numero, c.comensales, c.canal, c.estado, c.canal_externo, c.pedido_externo_id,
         c.repartidor, c.abierta_en, c.enviada_cocina_en, c.notas,
         m.codigo AS mesa, m.id AS mesa_id, z.nombre_corto AS zona, z.tipo AS zona_tipo,
         u.nombre AS camarero, u.id AS camarero_id,
         EXTRACT(EPOCH FROM (NOW() - c.abierta_en))::int AS segundos_transcurridos,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', l.id, 'plato', p.nombre, 'cantidad', l.cantidad,
             'precio', l.precio_unitario, 'estado', l.estado, 'partida', l.partida,
             'asiento', l.asiento, 'notas', l.notas, 'alerta_alergeno', l.alerta_alergeno,
             'fuego', l.fuego, 'estacion', e.nombre
           ) ORDER BY l.id)
           FROM lineas_comanda l
           JOIN platos p ON p.id = l.plato_id
           LEFT JOIN estaciones e ON e.id = l.estacion_id
           WHERE l.comanda_id = c.id
         ), '[]'::json) AS lineas
    FROM comandas c
    LEFT JOIN mesas m ON m.id = c.mesa_id
    LEFT JOIN zonas z ON z.id = m.zona_id
    LEFT JOIN usuarios u ON u.id = c.camarero_id
`;

// GET /api/pedidos?estado=&canal=&zona=  — listado KDS
router.get(
  '/',
  ah(async (req, res) => {
    const { estado, canal, zona } = req.query;
    const where: string[] = [];
    const params: unknown[] = [];
    if (estado) { params.push(estado); where.push(`c.estado = $${params.length}`); }
    if (canal) { params.push(canal); where.push(`c.canal = $${params.length}`); }
    if (zona) { params.push(zona); where.push(`z.tipo = $${params.length}`); }
    const { rows } = await pool.query(
      `${SELECT_COMANDA} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY c.abierta_en ASC`,
      params
    );
    res.json(rows);
  })
);

// GET /api/pedidos/resumen — contadores del tablero
router.get(
  '/resumen',
  ah(async (_req, res) => {
    const { rows } = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE estado='pendiente')::int AS pendientes,
             COUNT(*) FILTER (WHERE estado='en_cocina')::int AS en_cocina,
             COUNT(*) FILTER (WHERE estado='lista')::int AS listas,
             COUNT(*) FILTER (WHERE estado='entregada')::int AS entregadas,
             COUNT(*) FILTER (WHERE canal='takeaway')::int AS takeaway,
             COUNT(*) FILTER (WHERE canal='salon')::int AS salon,
             COUNT(*) FILTER (WHERE canal='delivery')::int AS delivery,
             ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(enviada_cocina_en, NOW()) - abierta_en))/60))::int AS tiempo_medio_pase_min
      FROM comandas WHERE estado <> 'cobrada'
    `);
    res.json(rows[0]);
  })
);

// POST /api/pedidos — nueva comanda (toma de pedidos / manual)
router.post(
  '/',
  ah(async (req, res) => {
    const { mesa_id, camarero_id, comensales, canal, canal_externo, lineas, notas } = req.body;
    const cliente = await pool.query(`SELECT id FROM turnos WHERE abierto = TRUE ORDER BY fecha DESC LIMIT 1`);
    const turnoId = cliente.rows[0]?.id;
    if (!turnoId) { res.status(400).json({ error: 'No hay turno abierto' }); return; }

    const num = await pool.query(
      `SELECT COALESCE(MAX(numero::int), 1000) + 1 AS n FROM comandas WHERE turno_id = $1`,
      [turnoId]
    );
    const numero = String(num.rows[0].n);

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const nueva = await c.query(
        `INSERT INTO comandas (numero, locale_id, mesa_id, turno_id, camarero_id, comensales, canal, canal_externo, notas, estado)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, 'pendiente') RETURNING id`,
        [numero, mesa_id || null, turnoId, camarero_id || null, comensales || 1, canal || 'salon', canal_externo || null, notas || null]
      );
      const cid = nueva.rows[0].id;
      for (const l of lineas || []) {
        const precio = await c.query('SELECT precio FROM platos WHERE id = $1', [l.plato_id]);
        if (!precio.rows.length) throw new Error(`Plato ${l.plato_id} no existe`);
        await c.query(
          `INSERT INTO lineas_comanda (comanda_id, plato_id, cantidad, precio_unitario, asiento, partida, notas, estado)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pendiente')`,
          [cid, l.plato_id, l.cantidad || 1, precio.rows[0].precio, l.asiento || null, l.partida || 'principal', l.notas || null]
        );
      }
      await c.query(
        `INSERT INTO historial_estados_comanda (comanda_id, estado) VALUES ($1,'pendiente')`, [cid]
      );
      await c.query('COMMIT');
      const resumen = await pool.query(`${SELECT_COMANDA} WHERE c.id = $1`, [cid]);
      res.status(201).json(resumen.rows[0]);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  })
);

// PATCH /api/pedidos/:id — cambio de estado de comanda (con historial)
router.patch(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const { estado, usuario_id } = req.body;
    const validos = ['pendiente', 'en_cocina', 'lista', 'entregada', 'cobrada', 'cancelada'];
    if (!validos.includes(estado)) {
      res.status(400).json({ error: `Estado inválido. Usa: ${validos.join(', ')}` });
      return;
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const upd = await c.query(
        `UPDATE comandas SET estado = $1,
                enviada_cocina_en = CASE WHEN $1 = 'en_cocina' THEN NOW() ELSE enviada_cocina_en END,
                lista_en          = CASE WHEN $1 = 'lista'     THEN NOW() ELSE lista_en END,
                entregada_en      = CASE WHEN $1 = 'entregada' THEN NOW() ELSE entregada_en END,
                cerrada_en        = CASE WHEN $1 IN ('cobrada','cancelada') THEN NOW() ELSE cerrada_en END
          WHERE id = $2 RETURNING id`,
        [estado, id]
      );
      if (!upd.rows.length) { await c.query('ROLLBACK'); res.status(404).json({ error: 'Comanda no encontrada' }); return; }
      await c.query(
        `INSERT INTO historial_estados_comanda (comanda_id, estado, usuario_id) VALUES ($1,$2,$3)`,
        [id, estado, usuario_id || null]
      );
      if (estado === 'lista') {
        await c.query(`UPDATE lineas_comanda SET estado = 'lista' WHERE comanda_id = $1 AND estado = 'en_preparacion'`, [id]);
      }
      if (estado === 'entregada') {
        await c.query(`UPDATE lineas_comanda SET estado = 'servida', servida_en = NOW() WHERE comanda_id = $1`, [id]);
      }
      await c.query('COMMIT');
      const out = await pool.query(`${SELECT_COMANDA} WHERE c.id = $1`, [id]);
      res.json(out.rows[0]);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  })
);

// PATCH /api/pedidos/:id/lineas/:lineaId — estado o notas de una línea
router.patch(
  '/:id/lineas/:lineaId',
  ah(async (req, res) => {
    const lineaId = Number(req.params.lineaId);
    const { estado, notas } = req.body;
    const { rows } = await pool.query(
      `UPDATE lineas_comanda SET
              estado = COALESCE($1, estado),
              notas = COALESCE($2, notas),
              preparada_en = CASE WHEN $1 = 'lista' THEN NOW() ELSE preparada_en END,
              servida_en = CASE WHEN $1 = 'servida' THEN NOW() ELSE servida_en END
        WHERE id = $3 RETURNING *`,
      [estado || null, notas || null, lineaId]
    );
    if (!rows.length) { res.status(404).json({ error: 'Línea no encontrada' }); return; }
    res.json(rows[0]);
  })
);
