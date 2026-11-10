import { Router } from 'express';
import { pool } from '../db/pool';
import { ah } from './mesas';

export const router = Router();

// GET /api/reservas?fecha=YYYY-MM-DD — reservas del día + cronograma
router.get(
  '/',
  ah(async (req, res) => {
    const fecha = (req.query.fecha as string) || new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT r.id, r.fecha, r.hora, r.comensales, r.estado, r.origen, r.confirmada_via,
              r.id_externo, r.notas, r.duracion_est_min,
              cl.id AS cliente_id, cl.nombre AS cliente, cl.telefono, cl.nivel_vip, cl.fidelizado,
              m.codigo AS mesa, m.id AS mesa_id,
              z.nombre_corto AS zona,
              (SELECT COUNT(*)::int FROM preferencias_cliente pc
                WHERE pc.cliente_id = cl.id AND pc.severidad = 'critica') AS alertas_criticas,
              (SELECT json_agg(json_build_object('clave', pc.clave, 'valor', pc.valor, 'severidad', pc.severidad))
                 FROM preferencias_cliente pc WHERE pc.cliente_id = cl.id) AS preferencias
         FROM reservas r
         JOIN clientes cl ON cl.id = r.cliente_id
         LEFT JOIN mesas m ON m.id = r.mesa_id
         LEFT JOIN zonas z ON z.id = m.zona_id
        WHERE r.fecha = $1
        ORDER BY r.hora`,
      [fecha]
    );

    // cronograma: conteo por franja
    const cronograma = await pool.query(
      `SELECT TO_CHAR(hora, 'HH24:MI') AS franja, COUNT(*)::int AS total
         FROM reservas WHERE fecha = $1
        GROUP BY 1 ORDER BY 1`,
      [fecha]
    );
    res.json({ reservas: rows, cronograma: cronograma.rows });
  })
);

// GET /api/reservas/resumen — KPIs de la pantalla de reservas
router.get(
  '/resumen',
  ah(async (_req, res) => {
    const { rows } = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COALESCE(SUM(comensales),0)::int AS pax,
             COUNT(*) FILTER (WHERE estado='confirmada')::int AS confirmadas,
             COUNT(*) FILTER (WHERE estado='en_curso')::int AS en_curso,
             COUNT(*) FILTER (WHERE estado='retrasada')::int AS retrasadas,
             COUNT(*) FILTER (WHERE estado='no_show')::int AS no_show,
             COUNT(*) FILTER (WHERE origen IN ('thefork','google'))::int AS externas
      FROM reservas WHERE fecha = CURRENT_DATE
    `);
    const espera = await pool.query(
      `SELECT COUNT(*)::int AS grupos, COALESCE(SUM(comensales),0)::int AS pax,
              ROUND(AVG(tiempo_espera_est_min))::int AS espera_media
         FROM lista_espera WHERE estado = 'esperando'`
    );
    res.json({ ...rows[0], ...espera.rows[0] });
  })
);

// POST /api/reservas — alta manual
router.post(
  '/',
  ah(async (req, res) => {
    const { cliente_id, hora, comensales, mesa_id, origen, notas, confirmada_via } = req.body;
    if (!cliente_id || !hora || !comensales) {
      res.status(400).json({ error: 'cliente_id, hora y comensales son obligatorios' });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO reservas (locale_id, cliente_id, fecha, hora, comensales, origen, estado, mesa_id, notas, confirmada_via)
       VALUES (1, $1, CURRENT_DATE, $2, $3, COALESCE($4,'manual'), 'confirmada', $5, $6, $7)
       RETURNING *`,
      [cliente_id, hora, comensales, origen || null, mesa_id || null, notas || null, confirmada_via || null]
    );
    res.status(201).json(rows[0]);
  })
);

// PATCH /api/reservas/:id — sentar, reasignar, no-show, retrasar...
router.patch(
  '/:id',
  ah(async (req, res) => {
    const { estado, mesa_id } = req.body;
    const validos = ['pendiente', 'confirmada', 'en_curso', 'atendida', 'retrasada', 'no_show', 'cancelada'];
    if (estado && !validos.includes(estado)) {
      res.status(400).json({ error: `Estado inválido. Usa: ${validos.join(', ')}` });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE reservas SET
              estado = COALESCE($1, estado),
              mesa_id = COALESCE($2, mesa_id),
              sentada_en = CASE WHEN $1 = 'en_curso' THEN NOW() ELSE sentada_en END
        WHERE id = $3 RETURNING *`,
      [estado || null, mesa_id || null, req.params.id]
    );
    if (!rows.length) { res.status(404).json({ error: 'Reserva no encontrada' }); return; }
    res.json(rows[0]);
  })
);

// GET /api/reservas/lista-espera
router.get(
  '/lista-espera',
  ah(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT le.id, le.comensales, le.estado, le.tiempo_espera_est_min, le.posicion, le.notas,
              cl.nombre AS cliente, cl.telefono, z.nombre_corto AS zona
         FROM lista_espera le
         JOIN clientes cl ON cl.id = le.cliente_id
         LEFT JOIN zonas z ON z.id = le.zona_pref_id
        WHERE le.estado IN ('esperando','notificada')
        ORDER BY le.posicion`
    );
    res.json(rows);
  })
);

// POST /api/reservas/lista-espera/:id/notificar — "Notificar Mesa Lista via SMS"
router.post(
  '/lista-espera/:id/notificar',
  ah(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE lista_espera SET estado = 'notificada', notificado_en = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) { res.status(404).json({ error: 'Entrada no encontrada' }); return; }
    await pool.query(
      `INSERT INTO notificaciones (tipo, destino, titulo, contenido)
       SELECT 'sms', cl.telefono, 'SavorAI', $2
         FROM lista_espera le JOIN clientes cl ON cl.id = le.cliente_id
        WHERE le.id = $1`,
      [req.params.id, `Hola ${rows[0].cliente_id || ''}: su mesa está lista. Acuda a recepción.`]
    );
    res.json(rows[0]);
  })
);
