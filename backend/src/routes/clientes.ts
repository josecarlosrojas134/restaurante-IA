import { Router } from 'express';
import { pool } from '../db/pool';
import { ah } from './mesas';

export const router = Router();

// GET /api/clientes?buscar= — lista CRM (búsqueda por nombre/teléfono)
router.get(
  '/',
  ah(async (req, res) => {
    const { buscar } = req.query;
    const params: unknown[] = [];
    let where = '';
    if (buscar) {
      params.push(`%${buscar}%`);
      where = `WHERE nombre ILIKE $1 OR telefono ILIKE $1`;
    }
    const { rows } = await pool.query(
      `SELECT id, nombre, telefono, email, sector, nivel_vip, fidelizado, miembro_desde,
              visitas_total, gasto_total, ticket_medio, ultima_visita, notas, fecha_nacimiento
         FROM clientes ${where}
        ORDER BY gasto_total DESC LIMIT 100`,
      params
    );
    res.json(rows);
  })
);

// GET /api/clientes/:id — ficha completa
router.get(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const cli = await pool.query('SELECT * FROM clientes WHERE id = $1', [id]);
    if (!cli.rows.length) { res.status(404).json({ error: 'Cliente no encontrado' }); return; }

    const [prefs, resenas, reservas, visitas] = await Promise.all([
      pool.query(
        `SELECT tipo, clave, valor, severidad FROM preferencias_cliente WHERE cliente_id = $1 ORDER BY severidad DESC`,
        [id]
      ),
      pool.query(
        `SELECT r.puntuacion, r.fecha, r.comentario, c.numero AS comanda
           FROM resenas r LEFT JOIN comandas c ON c.id = r.comanda_id
          WHERE r.cliente_id = $1 ORDER BY r.fecha DESC`,
        [id]
      ),
      pool.query(
        `SELECT r.fecha, r.hora, r.comensales, r.estado, r.origen, m.codigo AS mesa
           FROM reservas r LEFT JOIN mesas m ON m.id = r.mesa_id
          WHERE r.cliente_id = $1 ORDER BY r.fecha DESC, r.hora DESC LIMIT 10`,
        [id]
      ),
      pool.query(
        `SELECT c.numero, c.abierta_en, m.codigo AS mesa,
                (SELECT COALESCE(SUM(l.cantidad*l.precio_unitario),0)
                   FROM lineas_comanda l WHERE l.comanda_id = c.id) AS total
           FROM comandas c LEFT JOIN mesas m ON m.id = c.mesa_id
          WHERE c.cliente_id = $1 ORDER BY c.abierta_en DESC LIMIT 10`,
        [id]
      ),
    ]);

    res.json({
      ...cli.rows[0],
      preferencias: prefs.rows,
      resenas: resenas.rows,
      reservas: reservas.rows,
      visitas: visitas.rows,
    });
  })
);

// POST /api/clientes — alta rápida (para reserva manual)
router.post(
  '/',
  ah(async (req, res) => {
    const { nombre, telefono, email, sector, notas } = req.body;
    if (!nombre) { res.status(400).json({ error: 'El nombre es obligatorio' }); return; }
    const { rows } = await pool.query(
      `INSERT INTO clientes (locale_id, nombre, telefono, email, sector, notas)
       VALUES (1, $1, $2, $3, $4, $5) RETURNING *`,
      [nombre, telefono || null, email || null, sector || null, notas || null]
    );
    res.status(201).json(rows[0]);
  })
);

// POST /api/clientes/:id/preferencias — guardar preferencia/alergia
router.post(
  '/:id/preferencias',
  ah(async (req, res) => {
    const { tipo, clave, valor, severidad } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO preferencias_cliente (cliente_id, tipo, clave, valor, severidad)
       VALUES ($1, COALESCE($2,'preferencia'), $3, $4, COALESCE($5,'normal'))
       ON CONFLICT (cliente_id, clave) DO UPDATE SET valor = EXCLUDED.valor, severidad = EXCLUDED.severidad
       RETURNING *`,
      [req.params.id, tipo || null, clave, valor || null, severidad || null]
    );
    res.status(201).json(rows[0]);
  })
);
