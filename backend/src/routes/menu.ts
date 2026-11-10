import { Router } from 'express';
import { pool } from '../db/pool';
import { ah } from './mesas';

export const router = Router();

// GET /api/menu — categorías con platos, alérgenos, etiquetas y raciones restantes
router.get(
  '/',
  ah(async (_req, res) => {
    const cats = await pool.query(
      `SELECT id, nombre, icono, orden FROM categorias_menu WHERE activa ORDER BY orden`
    );
    const platos = await pool.query(`
      SELECT p.id, p.nombre, p.descripcion, p.precio, p.tiempo_prep_min, p.disponible,
             p.es_vegetariano, p.categoria_id, p.costo,
             COALESCE((SELECT json_agg(a.nombre) FROM plato_alergeno pa
                        JOIN alergenos a ON a.id = pa.alergeno_id
                       WHERE pa.plato_id = p.id), '[]') AS alergenos,
             COALESCE((SELECT json_agg(e.nombre) FROM plato_etiqueta pe
                        JOIN etiquetas e ON e.id = pe.etiqueta_id
                       WHERE pe.plato_id = p.id), '[]') AS etiquetas,
             (SELECT ROUND((i.stock_actual / NULLIF(r.cantidad,0)))::int
                FROM recetas r JOIN insumos i ON i.id = r.insumo_id
               WHERE r.plato_id = p.id LIMIT 1) AS raciones_restantes
        FROM platos p
       ORDER BY p.orden
    `);
    const porCat = cats.rows.map((c) => ({
      ...c,
      platos: platos.rows.filter((p) => p.categoria_id === c.id),
    }));
    res.json(porCat);
  })
);

// GET /api/menu/platos/:id — detalle (para ficha de plato)
router.get(
  '/platos/:id',
  ah(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.*,
              COALESCE((SELECT json_agg(json_build_object('nombre', a.nombre, 'icono', a.icono))
                          FROM plato_alergeno pa JOIN alergenos a ON a.id = pa.alergeno_id
                         WHERE pa.plato_id = p.id), '[]') AS alergenos,
              COALESCE((SELECT json_agg(e.nombre) FROM plato_etiqueta pe
                         JOIN etiquetas e ON e.id = pe.etiqueta_id WHERE pe.plato_id = p.id), '[]') AS etiquetas
         FROM platos p WHERE p.id = $1`,
      [req.params.id]
    );
    if (!rows.length) { res.status(404).json({ error: 'Plato no encontrado' }); return; }
    res.json(rows[0]);
  })
);

// GET /api/menu/alergenos — diccionario
router.get(
  '/alergenos',
  ah(async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM alergenos ORDER BY nombre');
    res.json(rows);
  })
);
