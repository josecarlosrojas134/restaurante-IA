import { Router } from 'express';
import { pool } from '../db/pool';
import { ah } from './mesas';

export const router = Router();

// GET /api/analiticas — KPIs del turno + series para gráficos
router.get(
  '/',
  ah(async (_req, res) => {
    const [kpis, porZona, matrizBCG, pagos] = await Promise.all([
      // KPIs principales
      pool.query(`
        WITH importes AS (
          SELECT c.id, c.mesa_id, c.abierta_en,
                 (SELECT COALESCE(SUM(l.cantidad*l.precio_unitario),0)
                    FROM lineas_comanda l WHERE l.comanda_id = c.id) AS bruto
            FROM comandas c
           WHERE c.estado <> 'cancelada'
             AND c.abierta_en >= date_trunc('day', NOW())
        )
        SELECT COALESCE(SUM(bruto),0)::numeric(12,2) AS facturacion,
               COALESCE(SUM(bruto) / NULLIF(COUNT(*) FILTER (WHERE bruto>0),0),0)::numeric(10,2) AS ticket_medio,
               COUNT(*)::int AS comandas,
               COUNT(DISTINCT mesa_id)::int AS mesas_usadas,
               (SELECT COUNT(*)::int FROM mesas) AS mesas_total
          FROM importes
      `),
      // Rendimiento por zona (facturación)
      pool.query(`
        SELECT z.nombre_corto AS zona, z.tipo,
               COALESCE(SUM((SELECT COALESCE(SUM(l.cantidad*l.precio_unitario),0)
                               FROM lineas_comanda l WHERE l.comanda_id = c.id)),0)::numeric(12,2) AS facturacion,
               COUNT(DISTINCT c.id)::int AS comandas
          FROM zonas z
          LEFT JOIN mesas m ON m.zona_id = z.id
          LEFT JOIN comandas c ON c.mesa_id = m.id AND c.estado <> 'cancelada'
               AND c.abierta_en >= date_trunc('day', NOW())
         WHERE z.padre_id IS NULL OR z.tipo IN ('interior','exterior')
         GROUP BY z.id, z.nombre_corto, z.tipo, z.orden
         ORDER BY z.orden
      `),
      // Matriz BCG gastronómico: unidades, margen, facturación por plato
      pool.query(`
        SELECT p.nombre, p.precio, p.costo,
               COALESCE(SUM(l.cantidad),0)::int AS unidades,
               COALESCE(SUM(l.cantidad * l.precio_unitario),0)::numeric(12,2) AS facturacion,
               ROUND((AVG(p.precio - p.costo) / NULLIF(AVG(p.precio),0)) * 100)::int AS margen_pct,
               ROUND(AVG(p.precio - p.costo),2)::numeric(10,2) AS margen_unidad,
               c2.nombre AS categoria
          FROM platos p
          JOIN categorias_menu c2 ON c2.id = p.categoria_id
          LEFT JOIN lineas_comanda l ON l.plato_id = p.id
          LEFT JOIN comandas c ON c.id = l.comanda_id AND c.estado <> 'cancelada'
               AND c.abierta_en >= date_trunc('day', NOW())
         GROUP BY p.id, p.nombre, p.precio, p.costo, c2.nombre
         HAVING COALESCE(SUM(l.cantidad),0) > 0
         ORDER BY facturacion DESC
      `),
      // Desglose de pagos del día (cierre de caja)
      pool.query(`
        SELECT p.metodo, COALESCE(SUM(p.monto),0)::numeric(12,2) AS total, COUNT(*)::int AS operaciones
          FROM pagos p JOIN cuentas ct ON ct.id = p.cuenta_id
         WHERE p.pagado_en >= date_trunc('day', NOW())
         GROUP BY p.metodo ORDER BY total DESC
      `),
    ]);

    // serie horaria de facturación (para gráfico de barras)
    const serie = await pool.query(`
      SELECT TO_CHAR(date_trunc('hour', c.abierta_en), 'HH24:MI') AS hora,
             COALESCE(SUM((SELECT COALESCE(SUM(l.cantidad*l.precio_unitario),0)
                             FROM lineas_comanda l WHERE l.comanda_id = c.id)),0)::numeric(12,2) AS facturacion,
             COUNT(*)::int AS comandas
        FROM comandas c
       WHERE c.abierta_en >= date_trunc('day', NOW()) AND c.estado <> 'cancelada'
       GROUP BY 1 ORDER BY 1
    `);

    res.json({
      kpis: kpis.rows[0],
      porZona: porZona.rows,
      matrizBCG: matrizBCG.rows,
      pagos: pagos.rows,
      serie: serie.rows,
    });
  })
);
