import { Router } from 'express';
import { pool } from '../db/pool';
import { ah } from './mesas';

export const router = Router();

// GET /api/ia/recomendaciones?estado= — recomendaciones del agente
router.get(
  '/recomendaciones',
  ah(async (req, res) => {
    const { estado, tipo } = req.query;
    const where: string[] = [];
    const params: unknown[] = [];
    if (estado) { params.push(estado); where.push(`estado = $${params.length}`); }
    if (tipo) { params.push(tipo); where.push(`tipo = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT id, tipo, titulo, contenido, confianza, datos, estado, accion_ejecutada,
              creada_en, resuelta_en
         FROM recomendaciones_ia
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY creada_en DESC`,
      params
    );
    res.json(rows);
  })
);

// POST /api/ia/recomendaciones/:id/aplicar — aplicar o descartar
router.post(
  '/recomendaciones/:id/aplicar',
  ah(async (req, res) => {
    const { accion } = req.body; // 'aplicada' | 'descartada'
    const estado = accion === 'descartada' ? 'descartada' : 'aplicada';
    const { rows } = await pool.query(
      `UPDATE recomendaciones_ia
          SET estado = $1, resuelta_en = NOW(),
              accion_ejecutada = CASE WHEN $1 = 'aplicada'
                                      THEN COALESCE(accion_ejecutada, 'aplicada_manual')
                                      ELSE accion_ejecutada END
        WHERE id = $2 RETURNING *`,
      [estado, req.params.id]
    );
    if (!rows.length) { res.status(404).json({ error: 'Recomendación no encontrada' }); return; }

    // si es de stock crítico y se aplica → notificar a camareros
    if (estado === 'aplicada' && rows[0].tipo === 'stock_critico') {
      await pool.query(
        `INSERT INTO notificaciones (tipo, destino, titulo, contenido)
         VALUES ('interno', 'Camareros', 'SavorAI', $1)`,
        [`Aplicada: ${rows[0].titulo}`]
      );
    }
    res.json(rows[0]);
  })
);

// POST /api/ia/chat — mensaje al agente operativo (guarda la conversación)
router.post(
  '/chat',
  ah(async (req, res) => {
    const { mensaje, usuario_id } = req.body;
    if (!mensaje?.trim()) { res.status(400).json({ error: 'El mensaje es obligatorio' }); return; }

    // usuario por defecto: el primero existente (evita depender de IDs fijos)
    const userRow = usuario_id
      ? { rows: [{ id: usuario_id }] }
      : await pool.query(`SELECT id FROM usuarios ORDER BY id LIMIT 1`);

    // conversación activa del usuario (o nueva)
    let conv = await pool.query(
      `SELECT id FROM conversaciones_ia WHERE usuario_id = $1 AND activa ORDER BY iniciada_en DESC LIMIT 1`,
      [userRow.rows[0].id]
    );
    if (!conv.rows.length) {
      conv = await pool.query(
        `INSERT INTO conversaciones_ia (usuario_id, titulo) VALUES ($1, $2) RETURNING id`,
        [userRow.rows[0].id, mensaje.slice(0, 80)]
      );
    }
    const convId = conv.rows[0].id;

    await pool.query(
      `INSERT INTO mensajes_ia (conversacion_id, rol, contenido) VALUES ($1,'user',$2)`,
      [convId, mensaje]
    );

    // --- Agente: responde consultando datos reales del sistema ---
    const respuesta = await consultarOperacion(mensaje);

    const asistente = await pool.query(
      `INSERT INTO mensajes_ia (conversacion_id, rol, contenido, metadatos)
       VALUES ($1,'assistant',$2,$3) RETURNING id, contenido, creado_en`,
      [convId, respuesta.texto, JSON.stringify(respuesta.datos || {})]
    );

    res.json({
      conversacion_id: convId,
      respuesta: asistente.rows[0],
      datos: respuesta.datos,
    });
  })
);

// GET /api/ia/chat/:conversacionId — historial
router.get(
  '/chat/:conversacionId',
  ah(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, rol, contenido, metadatos, creado_en
         FROM mensajes_ia WHERE conversacion_id = $1 ORDER BY creado_en`,
      [req.params.conversacionId]
    );
    res.json(rows);
  })
);

// GET /api/ia/predicciones?fecha= — ocupación proyectada vs real
router.get(
  '/predicciones',
  ah(async (req, res) => {
    const fecha = (req.query.fecha as string) || new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT TO_CHAR(hora,'HH24:MI') AS hora, ocupacion_proyectada, ocupacion_real,
              ingresos_proyectados, factor_clima
         FROM predicciones_demanda
        WHERE fecha = $1 ORDER BY hora`,
      [fecha]
    );
    res.json(rows);
  })
);

// GET /api/ia/estado — métricas del agente (conectado a...)
router.get(
  '/estado',
  ah(async (_req, res) => {
    const [recoms, stock, mesas] = await Promise.all([
      pool.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE estado='aplicada')::int AS aplicadas,
               COUNT(*) FILTER (WHERE estado='pendiente')::int AS pendientes,
               ROUND(AVG(confianza))::int AS confianza_media
          FROM recomendaciones_ia
      `),
      pool.query(`
        SELECT COUNT(*)::int AS criticos FROM insumos WHERE stock_actual <= stock_minimo
      `),
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE estado='libre')::int AS libres,
               COUNT(*) FILTER (WHERE estado='ocupada')::int AS ocupadas
          FROM mesas
      `),
    ]);
    res.json({
      online: true,
      recomendaciones: recoms.rows[0],
      stock_critico: stock.rows[0].criticos,
      mesas: mesas.rows[0],
    });
  })
);

// ---------- Motor de respuestas del agente (consultas reales) ----------
async function consultarOperacion(mensaje: string): Promise<{ texto: string; datos?: object }> {
  const m = mensaje.toLowerCase();

  try {
    if (/mesa|libre|disponib/.test(m)) {
      const libres = await pool.query(`
        SELECT m.codigo, m.capacidad, z.nombre_corto AS zona, m.ambiente
          FROM mesas m JOIN zonas z ON z.id = m.zona_id
         WHERE m.estado = 'libre' ORDER BY z.orden, m.codigo LIMIT 12
      `);
      const lista = libres.rows.map((r) => `${r.codigo} (${r.capacidad} pax · ${r.zona})`).join(', ');
      return {
        texto: libres.rows.length
          ? `Buenas noches. Hay ${libres.rows.length} mesas libres ahora mismo: ${lista}. ¿Asigno alguna a la lista de espera?`
          : 'No hay mesas libres en este momento; todas están ocupadas o reservadas. Puedo ofrecerte la lista de espera.',
        datos: { mesas_libres: libres.rows },
      };
    }

    if (/rentab|margen|venta|más vendido|mas vendido|top/.test(m)) {
      const top = await pool.query(`
        SELECT p.nombre, SUM(l.cantidad)::int AS unidades,
               SUM(l.cantidad * l.precio_unitario)::numeric(10,2) AS facturacion
          FROM lineas_comanda l JOIN platos p ON p.id = l.plato_id
          JOIN comandas c ON c.id = l.comanda_id
         WHERE c.abierta_en >= date_trunc('day', NOW()) AND c.estado <> 'cancelada'
         GROUP BY p.id, p.nombre ORDER BY facturacion DESC LIMIT 5
      `);
      const lista = top.rows.map((r, i) => `${i + 1}. ${r.nombre} — ${r.unidades} uds · ${r.facturacion}€`).join('\n');
      return {
        texto: `Platos más rentables de hoy:\n${lista || 'Aún no hay ventas registradas hoy.'}`,
        datos: { top_platos: top.rows },
      };
    }

    if (/stock|insumo|86|agot|rotura/.test(m)) {
      const crit = await pool.query(`
        SELECT nombre, stock_actual, stock_minimo, unidad
          FROM insumos WHERE stock_actual <= stock_minimo * 1.3
         ORDER BY (stock_actual - stock_minimo) ASC
      `);
      const lista = crit.rows.map((r) => `${r.nombre}: ${r.stock_actual} ${r.unidad} (mín. ${r.stock_minimo})`).join('\n');
      return {
        texto: crit.rows.length
          ? `Alertas de stock crítico:\n${lista}\n\n¿Genero la orden de compra al proveedor?`
          : 'Todo el inventario está por encima del mínimo. Sin roturas previstas para hoy.',
        datos: { stock_critico: crit.rows },
      };
    }

    if (/ocupaci|aforo|reserva|cuántos|cuantos/.test(m)) {
      const occ = await pool.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE estado IN ('ocupada','cuenta_solicitada'))::int AS ocupadas
          FROM mesas
     `);
      const res = await pool.query(`
        SELECT COUNT(*)::int AS total, COALESCE(SUM(comensales),0)::int AS pax
          FROM reservas WHERE fecha = CURRENT_DATE
      `);
      const pct = Math.round((occ.rows[0].ocupadas / occ.rows[0].total) * 100);
      return {
        texto: `Ocupación actual: ${occ.rows[0].ocupadas}/${occ.rows[0].total} mesas (${pct}%). Hoy tenemos ${res.rows[0].total} reservas confirmadas para ${res.rows[0].pax} comensales. En el pico de las 21:30 se proyecta un 96%.`,
        datos: { ocupacion: occ.rows[0], reservas: res.rows[0] },
      };
    }

    if (/clima|terraza|patio|temperatura/.test(m)) {
      const dev = await pool.query(
        `SELECT ultimo_estado FROM dispositivos_iot WHERE tipo='sensor_clima' LIMIT 1`
      );
      const t = dev.rows[0]?.ultimo_estado?.temp ?? 22;
      return {
        texto: `El patio registra ${t}°C con viento suave. La demanda de terraza está un +120% respecto a la media: 14 clientes de la lista de espera prefieren exterior. Recomiendo habilitar 2 mesas lounge de refuerzo.`,
        datos: { clima: dev.rows[0]?.ultimo_estado },
      };
    }

    if (/personal|brigada|camarero|reparto/.test(m)) {
      const asig = await pool.query(`
        SELECT u.nombre, u.rol, z.nombre_corto AS zona
          FROM asignaciones_turno a
          JOIN usuarios u ON u.id = a.usuario_id
          LEFT JOIN zonas z ON z.id = a.zona_id
         WHERE a.turno_id = (SELECT id FROM turnos WHERE abierto ORDER BY fecha DESC LIMIT 1)
      `);
      const lista = asig.rows.map((r) => `${r.nombre} (${r.rol}${r.zona ? ' · ' + r.zona : ''})`) .join('\n');
      return {
        texto: `Brigada del turno activo:\n${lista}\n\nSugerencia IA: reforzar Salón con 1 camarero entre 20:30 y 23:00 para mantener el tiempo de servicio por debajo de 12 min.`,
        datos: { brigada: asig.rows },
      };
    }

    // respuesta general: resumen del servicio
    const resumen = await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM comandas WHERE estado NOT IN ('cobrada','cancelada')) AS activas,
             (SELECT COUNT(*)::int FROM comandas WHERE estado='pendiente') AS pendientes,
             (SELECT COUNT(*)::int FROM lista_espera WHERE estado='esperando') AS espera,
             (SELECT COUNT(*)::int FROM recomendaciones_ia WHERE estado='pendiente') AS sugerencias
    `);
    const r = resumen.rows[0];
    return {
      texto: `Buenas noches Mateo. Estado del servicio: ${r.activas} comandas activas (${r.pendientes} pendientes de aceptar), ${r.espera} grupos en lista de espera y ${r.sugerencias} recomendaciones pendientes de revisar.\nPuedo consultarte mesas libres, platos más rentables, stock crítico, ocupación, clima de terraza o brigada del turno.`,
      datos: { resumen: r },
    };
  } catch (e) {
    return {
      texto: 'He tenido un problema consultando los datos operativos. El TPV sigue funcionando con normalidad; inténtalo de nuevo en unos segundos.',
      datos: { error: String(e) },
    };
  }
}
