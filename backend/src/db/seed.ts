import { pool } from './pool';

/**
 * Seed de datos realistas basados en las pantallas del diseño Stitch.
 * Idempotente: solo inserta si la tabla está vacía.
 */
async function seed() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    const { rowCount } = await c.query('SELECT 1 FROM locales LIMIT 1');
    if (rowCount) {
      console.log('ℹ️  La base ya tiene datos. Ejecuta `npm run db:init` antes de seed.');
      await c.query('ROLLBACK');
      return;
    }

    // ---------- LOCAL ----------
    const locale = await c.query(
      `INSERT INTO locales (nombre, direccion, telefono, tpv_id)
       VALUES ('Bistró Central', 'Calle Mayor 12', '+34 910 234 567', '#84-BISTRO')
       RETURNING id`
    );
    const L = locale.rows[0].id as number;

    // ---------- ZONAS (2 pasadas: primero insertar, luego vincular padres por nombre) ----------
    const zonas: Record<string, number> = {};
    const zonasData: [string, string, string, string | null, number, object | null][] = [
      ['Salón Interior', 'Salón', 'interior', null, 0, { climatizacion: 21 }],
      ['Barra & Zona Ventanal', 'Barra', 'barra', 'Salón Interior', 1, null],
      ['Salón Central & Reservados VIP', 'Salón VIP', 'vip', 'Salón Interior', 2, null],
      ['Patio / Terraza', 'Patio', 'exterior', null, 3, { calefaccion: true, temp: 24 }],
      ['Pérgola Climatizada & Jardín Central', 'Pérgola', 'exterior', 'Patio / Terraza', 4, { calefaccion: true }],
    ];
    for (const [nombre, corto, tipo, _padre, orden, clima] of zonasData) {
      const r = await c.query(
        `INSERT INTO zonas (locale_id, nombre, nombre_corto, tipo, orden, clima_config, capacidad_max)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [L, nombre, corto, tipo, orden, clima ? JSON.stringify(clima) : null, orden === 0 ? 74 : 48]
      );
      zonas[nombre] = r.rows[0].id;
    }
    for (const [nombre, , , padre] of zonasData) {
      if (padre) {
        await c.query(`UPDATE zonas SET padre_id = $1 WHERE id = $2`, [zonas[padre], zonas[nombre]]);
      }
    }

    // ---------- USUARIOS ----------
    const usuariosData: [string, string, string, string][] = [
      ['Mateo Rossi', 'mateo@savorai.io', 'jefe_sala', 'MR'],
      ['Lucía Vega', 'lucia@savorai.io', 'camarero', 'LV'],
      ['Sofía García', 'sofia@savorai.io', 'camarero', 'SG'],
      ['Javier Ruiz', 'javier@savorai.io', 'camarero', 'JR'],
      ['Carlos Peña', 'carlos@savorai.io', 'cocina', 'CP'],
      ['Ana Torres', 'ana@savorai.io', 'caja', 'AT'],
      ['Admin SavorAI', 'admin@savorai.io', 'admin', 'AD'],
    ];
    const users: Record<string, number> = {};
    for (const [nombre, email, rol, ini] of usuariosData) {
      const r = await c.query(
        `INSERT INTO usuarios (locale_id, nombre, email, password_hash, rol, iniciales)
         VALUES ($1,$2,$3,'$2b$10$seedhashnoop',$4,$5) RETURNING id`,
        [L, nombre, email, rol, ini]
      );
      users[nombre] = r.rows[0].id;
    }

    // ---------- TURNO ----------
    const turno = await c.query(
      `INSERT INTO turnos (locale_id, nombre, fecha, hora_apertura)
       VALUES ($1,'Turno Noche', CURRENT_DATE, '20:00') RETURNING id`,
      [L]
    );
    const T = turno.rows[0].id as number;

    for (const [u, z] of [
      ['Mateo Rossi', 'Salón Interior'],
      ['Lucía Vega', 'Salón Interior'],
      ['Sofía García', 'Patio / Terraza'],
      ['Javier Ruiz', 'Patio / Terraza'],
      ['Carlos Peña', null],
      ['Ana Torres', null],
    ] as [string, string | null][]) {
      await c.query(
        `INSERT INTO asignaciones_turno (turno_id, usuario_id, zona_id) VALUES ($1,$2,$3)`,
        [T, users[u], z ? zonas[z] : null]
      );
    }

    // ---------- ESTACIONES ----------
    const estacionesData: [string, string][] = [
      ['Fuego 4', 'parrilla'],
      ['Horno B', 'horno'],
      ['Bandeja 1', 'montaje'],
      ['Pase Expo', 'pase'],
      ['Despacho Frío', 'frío'],
      ['Frigobar', 'bebidas'],
    ];
    const estaciones: Record<string, number> = {};
    for (const [nombre, tipo] of estacionesData) {
      const r = await c.query(
        `INSERT INTO estaciones (nombre, tipo) VALUES ($1,$2) RETURNING id`,
        [nombre, tipo]
      );
      estaciones[nombre] = r.rows[0].id;
    }

    // ---------- ALÉRGENOS Y ETIQUETAS ----------
    const alergenosData: [string, string][] = [
      ['Gluten', 'wheat'],
      ['Lácteos', 'milk'],
      ['Frutos Secos', 'nut'],
      ['Moluscos', 'shell'],
      ['Crustáceos', 'shrimp'],
      ['Huevos', 'egg'],
      ['Soja', 'soy'],
      ['Pescado', 'fish'],
    ];
    const alergenos: Record<string, number> = {};
    for (const [nombre, icono] of alergenosData) {
      const r = await c.query(`INSERT INTO alergenos (nombre, icono) VALUES ($1,$2) RETURNING id`, [nombre, icono]);
      alergenos[nombre] = r.rows[0].id;
    }

    const etiquetasData: [string, string][] = [
      ['Top Ventas', 'success'],
      ['Especial Chef', 'primary'],
      ['Recomendado IA', 'ai'],
      ['Vegetariano', 'success'],
      ['Postre Insignia', 'primary'],
      ['Entrante Clásico', 'neutral'],
      ['Estrella', 'success'],
      ['Vegano', 'success'],
    ];
    const etiquetas: Record<string, number> = {};
    for (const [nombre, color] of etiquetasData) {
      const r = await c.query(`INSERT INTO etiquetas (nombre, color) VALUES ($1,$2) RETURNING id`, [nombre, color]);
      etiquetas[nombre] = r.rows[0].id;
    }

    // ---------- CATEGORÍAS ----------
    const catsData: [string, string, number][] = [
      ['Entrantes & Tapas', 'utensils', 1],
      ['Carnes & Brasas', 'flame', 2],
      ['Pescados & Mariscos', 'fish', 3],
      ['Arroces & Pasta', 'bowl', 4],
      ['Postres', 'cake', 5],
      ['Bebidas & Vinos', 'wine', 6],
    ];
    const cats: Record<string, number> = {};
    for (const [nombre, icono, orden] of catsData) {
      const r = await c.query(
        `INSERT INTO categorias_menu (locale_id, nombre, icono, orden) VALUES ($1,$2,$3,$4) RETURNING id`,
        [L, nombre, icono, orden]
      );
      cats[nombre] = r.rows[0].id;
    }

    // ---------- PROVEEDORES E INSUMOS ----------
    const provsData: [string, string, number][] = [
      ['Cárnicos del Sur SL', 'Antonio Barea', 1],
      ['Pescados Ría Verde', 'Marta Nogueira', 1],
      ['Huerta Ecológica La Vega', 'Luis Prado', 1],
      ['Bodega Ribera Duero', 'Carmen Ruiz', 3],
      ['Lácteos Idiazábal Echea', 'Pablo Echea', 2],
    ];
    const provs: Record<string, number> = {};
    for (const [nombre, contacto, plazo] of provsData) {
      const r = await c.query(
        `INSERT INTO proveedores (nombre, contacto, telefono, plazo_entrega_dias)
         VALUES ($1,$2,'+34 600 000 000',$3) RETURNING id`,
        [nombre, contacto, plazo]
      );
      provs[nombre] = r.rows[0].id;
    }

    const insumosData: [string, string, string, number, number, number][] = [
      ['Solomillo de vaca madurada', 'Cárnicos del Sur SL', 'kg', 18, 10, 24.5],
      ['Lubina salvaje', 'Pescados Ría Verde', 'kg', 3.2, 6, 18.0],
      ['Corvina fresca', 'Pescados Ría Verde', 'kg', 9, 5, 12.4],
      ['Pulpo gallego', 'Pescados Ría Verde', 'kg', 7.5, 4, 21.0],
      ['Arroz bomba', 'Huerta Ecológica La Vega', 'kg', 25, 10, 3.2],
      ['Queso Idiazábal', 'Lácteos Idiazábal Echea', 'kg', 8, 4, 16.9],
      ['Jamón ibérico de bellota', 'Cárnicos del Sur SL', 'kg', 5.5, 3, 42.0],
      ['Malbec Reserva', 'Bodega Ribera Duero', 'bot', 24, 12, 8.4],
      ['Vainilla bourbon', 'Huerta Ecológica La Vega', 'ud', 30, 10, 1.2],
      ['Patata trufada', 'Huerta Ecológica La Vega', 'kg', 14, 8, 4.8],
    ];
    const insumos: Record<string, number> = {};
    for (const [nombre, prov, unidad, stock, minimo, costo] of insumosData) {
      const r = await c.query(
        `INSERT INTO insumos (proveedor_id, nombre, unidad, stock_actual, stock_minimo, costo_unitario)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [provs[prov], nombre, unidad, stock, minimo, costo]
      );
      insumos[nombre] = r.rows[0].id;
    }

    // ---------- PLATOS ----------
    interface PlatoSeed {
      cat: string;
      nombre: string;
      desc: string;
      precio: number;
      costo: number;
      prep: number;
      alergenos?: string[];
      etiquetas?: string[];
      veg?: boolean;
      alergenosTexto?: string;
    }
    const platosData: PlatoSeed[] = [
      { cat: 'Carnes & Brasas', nombre: 'Solomillo de Vaca Madurada', desc: 'Corte premium 280g madurado 45 días al carbón de encina, puré de tupinambo y jugo de tinta.', precio: 28.5, costo: 9.8, prep: 12, alergenos: ['Lácteos'], etiquetas: ['Recomendado IA', 'Estrella'] },
      { cat: 'Pescados & Mariscos', nombre: 'Pulpo a la Brasa & Azafrán', desc: 'Pata de pulpo gallego braseada, parmentier sedosa al azafrán de La Mancha y yacete de pimientos.', precio: 24.0, costo: 8.1, prep: 9, alergenos: ['Moluscos', 'Lácteos'], etiquetas: ['Top Ventas'] },
      { cat: 'Entrantes & Tapas', nombre: 'Croquetas de Jamón Ibérico', desc: 'Bechamel cremosa infusionada con huesos de jamón 100% ibérico y velo crujiente de panko.', precio: 14.5, costo: 4.9, prep: 6, alergenos: ['Gluten', 'Lácteos', 'Huevos'], etiquetas: ['Entrante Clásico'] },
      { cat: 'Arroces & Pasta', nombre: 'Arroz Meloso con Bogavante', desc: 'Arroz bomba del Delta del Ebro cocinado al instante con fumet de roca y bogavante azul.', precio: 32.0, costo: 12.6, prep: 18, alergenos: ['Crustáceos', 'Pescado'], etiquetas: ['Especial Chef'] },
      { cat: 'Entrantes & Tapas', nombre: 'Burrata Pugliese con Tartufata', desc: 'Corazón de queso hilado fresco, carpaccio de tomates reliquia confitados, pesto genovés y trufa.', precio: 16.5, costo: 5.7, prep: 4, alergenos: ['Lácteos', 'Frutos Secos'], etiquetas: ['Vegetariano'] },
      { cat: 'Postres', nombre: 'Tarta Fluida de Queso Idiazábal', desc: 'Receta fluida del horno a leña con queso de oveja ahumado del Valle del Goierri y helado de leche.', precio: 8.5, costo: 2.4, prep: 3, alergenos: ['Huevos', 'Lácteos'], etiquetas: ['Postre Insignia'] },
      { cat: 'Carnes & Brasas', nombre: 'Entrecot Black Angus a la Brasa', desc: 'Corte Black Angus 400g madurado 30 días, guarnición de verduras de temporada y jus de carne.', precio: 28.5, costo: 10.2, prep: 14, alergenos: [], etiquetas: ['Top Ventas', 'Estrella'] },
      { cat: 'Arroces & Pasta', nombre: 'Risotto de Boletus y Trufa Melanosporum', desc: 'Arroz carnaroli, boletus frescos de temporada y virutas de trufa negra de Teruel.', precio: 22.0, costo: 6.8, prep: 16, alergenos: ['Lácteos'], etiquetas: ['Vegetariano', 'Estrella'] },
      { cat: 'Pescados & Mariscos', nombre: 'Lubina Salvaje al Horno con Hinojo', desc: 'Lubina salvaje al horno de sal con hinojo confitado y cítricos de Valencia.', precio: 26.0, costo: 9.4, prep: 15, alergenos: ['Pescado'], etiquetas: ['Especial Chef'] },
      { cat: 'Pescados & Mariscos', nombre: 'Corvina Rostizada al Limón', desc: 'Lomo de corvina rostizado a baja temperatura con beurre blanc de limón y eneldo.', precio: 24.5, costo: 7.9, prep: 13, alergenos: ['Pescado', 'Lácteos'], etiquetas: [] },
      { cat: 'Entrantes & Tapas', nombre: 'Tartar de Atún Rojo', desc: 'Atún rojo de almadraba cortado a cuchillo, sésamo tostado, yema curada y galleta de miso.', precio: 19.0, costo: 7.2, prep: 8, alergenos: ['Pescado', 'Soja', 'Huevos'], etiquetas: ['Especial Chef'], alergenosTexto: 'Sin emulsión de sésamo ni pistacho' },
      { cat: 'Entrantes & Tapas', nombre: 'Bao de Panceta Confitada', desc: 'Pan bao al vapor, panceta confitada 6 horas, encurtidos caseros y salsa hoisin.', precio: 12.5, costo: 3.8, prep: 7, alergenos: ['Gluten', 'Soja'], etiquetas: [] },
      { cat: 'Entrantes & Tapas', nombre: 'PadThai Silvestre', desc: 'Fideos de arroz salteados al wok, tofu, brotes de soja, cacahuete y lima. Sin picante por defecto.', precio: 13.5, costo: 3.6, prep: 9, alergenos: ['Soja', 'Frutos Secos', 'Gluten'], etiquetas: ['Vegano'], alergenosTexto: 'Sin picante' },
      { cat: 'Carnes & Brasas', nombre: 'Ribeye Wagyu A5', desc: 'Corte Wagyu A5 220g sellado a la parrilla, sal de escamas y mostaza japonesa.', precio: 64.0, costo: 32.0, prep: 10, alergenos: [], etiquetas: ['Especial Chef'] },
      { cat: 'Arroces & Pasta', nombre: 'Ravioli Trufa Negra y Yema', desc: 'Pasta fresca rellena de ricotta y trufa negra, mantequilla avellanada y parmesano 24 meses.', precio: 21.0, costo: 6.4, prep: 12, alergenos: ['Gluten', 'Lácteos', 'Huevos'], etiquetas: ['Vegetariano'] },
      { cat: 'Pescados & Mariscos', nombre: 'Ceviche Clásico Corvina', desc: 'Corvina curada en leche de tigre, cebolla morada, camote y maíz tostado.', precio: 17.5, costo: 5.9, prep: 8, alergenos: ['Pescado'], etiquetas: [] },
      { cat: 'Pescados & Mariscos', nombre: 'Ostras Gillardeau Nº2', desc: 'Ostra Gillardeau Nº2 con granizado de manzana verde y mignonette de chalota.', precio: 22.0, costo: 11.0, prep: 5, alergenos: ['Moluscos'], etiquetas: [] },
      { cat: 'Postres', nombre: 'Coulant de Chocolate & Helado Vainilla', desc: 'Coulant de chocolate 70% con centro fundido, helado de vainilla bourbon y croquant.', precio: 9.5, costo: 2.6, prep: 3, alergenos: ['Huevos', 'Lácteos', 'Gluten'], etiquetas: ['Postre Insignia'] },
      { cat: 'Postres', nombre: 'Tarta de Queso al Horno de Leña', desc: 'Tarta de queso cremosa con corte caramelizado y compota de frutos rojos.', precio: 7.5, costo: 2.1, prep: 3, alergenos: ['Huevos', 'Lácteos', 'Gluten'], etiquetas: ['Top Ventas'] },
      { cat: 'Bebidas & Vinos', nombre: 'Copa Pago de Carraovés Tinto Crianza', desc: 'Tinto crianza Ribera del Duero 14 meses en barrica. Copa 150ml.', precio: 6.5, costo: 1.8, prep: 1, alergenos: [], etiquetas: [] },
      { cat: 'Bebidas & Vinos', nombre: 'Malbec Reserva', desc: 'Malbec de Cuyo argentina, notas de ciruela y vainilla. Botella 75cl.', precio: 32.0, costo: 8.4, prep: 1, alergenos: [], etiquetas: [] },
    ];

    const platos: Record<string, number> = {};
    for (let i = 0; i < platosData.length; i++) {
      const p = platosData[i];
      const r = await c.query(
        `INSERT INTO platos (categoria_id, nombre, descripcion, precio, costo, tiempo_prep_min, es_vegetariano, orden)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [cats[p.cat], p.nombre, p.desc, p.precio, p.costo, p.prep, !!p.veg, i]
      );
      platos[p.nombre] = r.rows[0].id;
      for (const a of p.alergenos || []) {
        await c.query(`INSERT INTO plato_alergeno (plato_id, alergeno_id) VALUES ($1,$2)`, [r.rows[0].id, alergenos[a]]);
      }
      for (const e of p.etiquetas || []) {
        await c.query(`INSERT INTO plato_etiqueta (plato_id, etiqueta_id) VALUES ($1,$2)`, [r.rows[0].id, etiquetas[e]]);
      }
    }

    // ---------- RECETAS (para raciones restantes) ----------
    const recetasData: [string, string, number][] = [
      ['Solomillo de Vaca Madurada', 'Solomillo de vaca madurada', 0.28],
      ['Lubina Salvaje al Horno con Hinojo', 'Lubina salvaje', 0.35],
      ['Corvina Rostizada al Limón', 'Corvina fresca', 0.3],
      ['Pulpo a la Brasa & Azafrán', 'Pulpo gallego', 0.25],
      ['Arroz Meloso con Bogavante', 'Arroz bomba', 0.12],
      ['Tarta Fluida de Queso Idiazábal', 'Queso Idiazábal', 0.12],
      ['Croquetas de Jamón Ibérico', 'Jamón ibérico de bellota', 0.05],
      ['Risotto de Boletus y Trufa Melanosporum', 'Arroz bomba', 0.09],
      ['Copa Pago de Carraovés Tinto Crianza', 'Malbec Reserva', 0.15],
    ];
    for (const [plato, insumo, cant] of recetasData) {
      await c.query(`INSERT INTO recetas (plato_id, insumo_id, cantidad) VALUES ($1,$2,$3)`, [
        platos[plato], insumos[insumo], cant,
      ]);
    }

    // ---------- MESAS ----------
    interface MesaSeed { cod: string; zona: string; cap: number; estado: string; amb?: string; x: number; y: number }
    const mesasData: MesaSeed[] = [
      // Salón interior (18)
      { cod: 'M-01', zona: 'Barra & Zona Ventanal', cap: 2, estado: 'libre', amb: 'Ventanal', x: 0, y: 0 },
      { cod: 'M-02', zona: 'Barra & Zona Ventanal', cap: 2, estado: 'ocupada', amb: 'Ventanal', x: 1, y: 0 },
      { cod: 'M-03', zona: 'Barra & Zona Ventanal', cap: 4, estado: 'reservada', amb: 'Barra Alta', x: 2, y: 0 },
      { cod: 'M-04', zona: 'Barra & Zona Ventanal', cap: 4, estado: 'ocupada', amb: 'Ventanal', x: 3, y: 0 },
      { cod: 'M-05', zona: 'Salón Central & Reservados VIP', cap: 6, estado: 'cuenta_solicitada', amb: 'VIP', x: 0, y: 1 },
      { cod: 'M-06', zona: 'Salón Central & Reservados VIP', cap: 4, estado: 'ocupada', amb: 'Salón C.', x: 1, y: 1 },
      { cod: 'M-07', zona: 'Salón Central & Reservados VIP', cap: 4, estado: 'ocupada', amb: 'Salón C.', x: 2, y: 1 },
      { cod: 'M-08', zona: 'Salón Central & Reservados VIP', cap: 4, estado: 'libre', amb: 'Salón C.', x: 3, y: 1 },
      { cod: 'M-09', zona: 'Salón Central & Reservados VIP', cap: 4, estado: 'ocupada', amb: 'VIP', x: 4, y: 1 },
      { cod: 'M-10', zona: 'Salón Interior', cap: 4, estado: 'libre', x: 0, y: 2 },
      { cod: 'M-11', zona: 'Salón Interior', cap: 4, estado: 'reservada', x: 1, y: 2 },
      { cod: 'M-12', zona: 'Salón Interior', cap: 4, estado: 'ocupada', x: 2, y: 2 },
      { cod: 'M-13', zona: 'Salón Interior', cap: 2, estado: 'libre', x: 3, y: 2 },
      { cod: 'M-14', zona: 'Salón Interior', cap: 6, estado: 'ocupada', x: 0, y: 3 },
      { cod: 'M-15', zona: 'Salón Interior', cap: 6, estado: 'cuenta_solicitada', x: 1, y: 3 },
      { cod: 'M-16', zona: 'Salón Interior', cap: 2, estado: 'reservada', x: 2, y: 3 },
      { cod: 'M-17', zona: 'Salón Interior', cap: 2, estado: 'libre', amb: 'Limpieza lista', x: 3, y: 3 },
      { cod: 'M-18', zona: 'Salón Interior', cap: 8, estado: 'ocupada', x: 4, y: 3 },
      // Patio/Terraza (12)
      { cod: 'P-01', zona: 'Patio / Terraza', cap: 4, estado: 'libre', amb: 'Jardín Central', x: 0, y: 4 },
      { cod: 'P-02', zona: 'Patio / Terraza', cap: 4, estado: 'libre', amb: 'Jardín Central', x: 1, y: 4 },
      { cod: 'P-03', zona: 'Patio / Terraza', cap: 6, estado: 'reservada', amb: 'Patio Central', x: 2, y: 4 },
      { cod: 'P-04', zona: 'Patio / Terraza', cap: 4, estado: 'ocupada', amb: 'Pérgola', x: 3, y: 4 },
      { cod: 'P-05', zona: 'Patio / Terraza', cap: 4, estado: 'libre', amb: 'Terraza Jardín', x: 4, y: 4 },
      { cod: 'P-06', zona: 'Patio / Terraza', cap: 2, estado: 'ocupada', x: 0, y: 5 },
      { cod: 'P-07', zona: 'Pérgola Climatizada & Jardín Central', cap: 4, estado: 'ocupada', amb: 'Pérgola', x: 1, y: 5 },
      { cod: 'P-08', zona: 'Pérgola Climatizada & Jardín Central', cap: 4, estado: 'ocupada', amb: 'Jardín Central', x: 2, y: 5 },
      { cod: 'P-09', zona: 'Pérgola Climatizada & Jardín Central', cap: 4, estado: 'libre', amb: 'Jardín Central', x: 3, y: 5 },
      { cod: 'P-10', zona: 'Pérgola Climatizada & Jardín Central', cap: 6, estado: 'ocupada', amb: 'Pérgola', x: 4, y: 5 },
      { cod: 'P-11', zona: 'Patio / Terraza', cap: 2, estado: 'ocupada', x: 0, y: 6 },
      { cod: 'P-12', zona: 'Patio / Terraza', cap: 8, estado: 'cuenta_solicitada', x: 1, y: 6 },
    ];
    const mesas: Record<string, number> = {};
    for (const m of mesasData) {
      const r = await c.query(
        `INSERT INTO mesas (locale_id, zona_id, codigo, capacidad, estado, ambiente, posX, posY)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [L, zonas[m.zona], m.cod, m.cap, m.estado, m.amb || null, m.x, m.y]
      );
      mesas[m.cod] = r.rows[0].id;
    }

    // ---------- CLIENTES ----------
    interface ClienteSeed {
      nombre: string; tel: string; sector?: string; vip?: string; fidel?: boolean;
      desde?: string; visitas?: number; gasto?: number; ticket?: number; ult?: string; notas?: string; nac?: string;
    }
    const clientesData: ClienteSeed[] = [
      { nombre: 'Elena Romero', tel: '+34 612 890 234', sector: 'Sector Audiovisual', vip: 'platino', fidel: true, desde: '2021-11-01', visitas: 14, gasto: 1840, ticket: 58.5, ult: '2024-10-12', nac: '1986-10-24', notas: 'Socia Gourmet. Prefiere sentarse en Patio/Pérgola cerca de fuentes de calefacción. Siempre agua con gas a temperatura ambiente. Valora ritmo ágil entre primer plato y fondos.' },
      { nombre: 'Dr. Carlos Mendonca', tel: '+34 689 312 009', sector: 'Sector Médico', vip: 'oro', fidel: true, desde: '2022-03-15', visitas: 22, gasto: 2410, ticket: 46.2, ult: '2024-10-18', notas: 'Frecuente. Sin gluten estricto. Reuniones tranquilas en Salón Ventanal.' },
      { nombre: 'Sofía Alarcón', tel: '+34 600 114 782', vip: 'ninguno', desde: '2024-10-24', visitas: 1, gasto: 96, ticket: 96, ult: '2024-10-24', notas: 'Primera visita vía TheFork. Prefiere terraza.' },
      { nombre: 'Ignacio Garrido', tel: '+34 622 450 118', sector: 'Consultoría', vip: 'oro', fidel: true, desde: '2021-06-10', visitas: 31, gasto: 4820, ticket: 82.4, ult: '2024-10-11', notas: 'Cena corporativa anual. Menú degustación reservado.' },
      { nombre: 'Familia Baroja', tel: '+34 655 908 331', visitas: 6, gasto: 640, ticket: 71.1, ult: '2024-09-28' },
      { nombre: 'Hugo Valdés', tel: '+34 677 221 905', visitas: 3, gasto: 210, ticket: 42, ult: '2024-10-05' },
      { nombre: 'Marta Beltrán', tel: '+34 699 404 771', visitas: 9, gasto: 980, ticket: 61.3, ult: '2024-10-19' },
      { nombre: 'Carlos Vidal', tel: '+34 610 332 148', vip: 'platino', fidel: true, desde: '2020-09-02', visitas: 45, gasto: 6210, ticket: 74.2, ult: '2024-10-21' },
      { nombre: 'Lucía Gómez', tel: '+34 644 118 002', visitas: 5, gasto: 430, ticket: 53.7, ult: '2024-10-14' },
      { nombre: 'Laura Prieto', tel: '+34 688 550 913', visitas: 8, gasto: 720, ticket: 48, ult: '2024-10-20' },
    ];
    const clientes: Record<string, number> = {};
    for (const cl of clientesData) {
      const r = await c.query(
        `INSERT INTO clientes (locale_id, nombre, telefono, sector, nivel_vip, fidelizado, miembro_desde,
                               visitas_total, gasto_total, ticket_medio, ultima_visita, notas, fecha_nacimiento)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,$9,$10,$11::date,$12::text,$13::date) RETURNING id`,
        [L, cl.nombre, cl.tel, cl.sector || null, cl.vip || 'ninguno', !!cl.fidel, cl.desde || null,
         cl.visitas || 0, cl.gasto || 0, cl.ticket || 0, cl.ult || null, cl.notas || null, cl.nac || null]
      );
      clientes[cl.nombre] = r.rows[0].id;
    }

    // Preferencias / alergias críticas
    const prefsData: [string, string, string, string, string][] = [
      ['Elena Romero', 'alergia', 'Frutos Secos', 'Crítica — notificar al Jefe de Cocina', 'critica'],
      ['Elena Romero', 'preferencia', 'Prefiere Patio / Pérgola', 'Cerca de fuentes de calefacción', 'normal'],
      ['Elena Romero', 'preferencia', 'Agua con gas a temperatura ambiente', 'Siempre al llegar', 'normal'],
      ['Elena Romero', 'preferencia', 'Ritmo ágil entre platos', 'Primer plato a fondos sin pausa larga', 'normal'],
      ['Dr. Carlos Mendonca', 'alergia', 'Gluten Estricto', 'Celiaquía — emplatado aislado', 'critica'],
      ['Dr. Carlos Mendonca', 'preferencia', 'Salón Ventanal', 'Reuniones tranquilas', 'normal'],
      ['Sofía Alarcón', 'preferencia', 'Terraza', 'Primera visita por TheFork', 'normal'],
      ['Ignacio Garrido', 'preferencia', 'Menú Degustación Reservado', 'Cena corporativa', 'normal'],
    ];
    for (const [cli, tipo, clave, valor, sev] of prefsData) {
      await c.query(
        `INSERT INTO preferencias_cliente (cliente_id, tipo, clave, valor, severidad) VALUES ($1,$2,$3,$4,$5)`,
        [clientes[cli], tipo, clave, valor, sev]
      );
    }

    // Reseñas
    const resenasData: [string, number, string, string][] = [
      ['Elena Romero', 5, '2024-10-12', 'Solomillo, Malbec, Tarta de Queso (172€ · 3 pax)'],
      ['Elena Romero', 5, '2024-09-28', 'Carpaccio de Buey, Lubina (118€ · 2 pax)'],
      ['Dr. Carlos Mendonca', 5, '2024-10-18', 'Risotto impecable y servicio atento a la alergia.'],
      ['Ignacio Garrido', 4, '2024-10-11', 'Gran cena corporativa, algo de espera en postres.'],
    ];
    for (const [cli, punt, fecha, com] of resenasData) {
      await c.query(`INSERT INTO resenas (cliente_id, puntuacion, fecha, comentario) VALUES ($1,$2,$3::date,$4)`, [
        clientes[cli], punt, fecha, com,
      ]);
    }

    // ---------- RESERVAS (cronograma: 20:00(6) 20:30(12) 21:00(10) 21:30(8) 22:00(4) = 40 + 2 manuales) ----------
    interface ReservaSeed {
      cli: string; hora: string; pax: number; estado: string; origen: string;
      mesa?: string; conf?: string; notas?: string; idExt?: string; retraso?: boolean;
    }
    const reservasData: ReservaSeed[] = [
      { cli: 'Elena Romero', hora: '20:30', pax: 4, estado: 'confirmada', origen: 'thefork', mesa: 'P-07', conf: 'sms', idExt: 'TF-88213', notas: 'Alergia severa: frutos secos. Maridaje Malbec Reserva. Mesa espaciosa.' },
      { cli: 'Dr. Carlos Mendonca', hora: '20:30', pax: 2, estado: 'en_curso', origen: 'telefono', mesa: 'M-02', conf: 'email', notas: 'Sin gluten estricto. Reunión médica tranquila.' },
      { cli: 'Sofía Alarcón', hora: '20:30', pax: 6, estado: 'retrasada', origen: 'thefork', mesa: 'P-03', conf: 'sms', idExt: 'TF-88240', notas: 'Retrasada 12m — alerta activa hasta 20:45.' },
      { cli: 'Ignacio Garrido', hora: '21:00', pax: 8, estado: 'confirmada', origen: 'manual', mesa: 'M-18', conf: 'sms', notas: 'Cena corporativa. Menú degustación reservado.' },
      { cli: 'Familia Baroja', hora: '20:00', pax: 4, estado: 'en_curso', origen: 'web', mesa: 'M-05', conf: 'email' },
      { cli: 'Hugo Valdés', hora: '22:00', pax: 2, estado: 'confirmada', origen: 'google', mesa: 'M-13', conf: 'sms', idExt: 'GG-4471' },
      { cli: 'Marta Beltrán', hora: '20:00', pax: 3, estado: 'atendida', origen: 'telefono', mesa: 'M-10', conf: 'email' },
      { cli: 'Carlos Vidal', hora: '20:30', pax: 4, estado: 'confirmada', origen: 'ia', mesa: 'M-09', conf: 'sms', notas: 'Habitual — suele pedir Vino Malbec Reserva tras la entrada.' },
      { cli: 'Lucía Gómez', hora: '21:30', pax: 2, estado: 'confirmada', origen: 'web', mesa: 'M-16', conf: 'email' },
      { cli: 'Laura Prieto', hora: '21:00', pax: 4, estado: 'confirmada', origen: 'google', mesa: 'M-11', conf: 'sms', idExt: 'GG-4489' },
      { cli: 'Familia Baroja', hora: '21:30', pax: 4, estado: 'confirmada', origen: 'manual', mesa: 'P-01', conf: 'email' },
      { cli: 'Hugo Valdés', hora: '22:00', pax: 2, estado: 'pendiente', origen: 'web', mesa: 'M-17' },
    ];
    // Completar conteos del cronograma con reservas ligeras
    const extras: [string, number][] = [['20:00', 4], ['20:30', 8], ['21:00', 8], ['21:30', 6], ['22:00', 2]];
    let extraN = 1;
    for (const [hora, n] of extras) {
      for (let i = 0; i < n; i++) {
        const r = await c.query(
          `INSERT INTO clientes (locale_id, nombre, telefono, visitas_total) VALUES ($1,$2,$3,0) RETURNING id`,
          [L, `Comensal Reserva ${extraN}`, `+34 600 100 ${String(extraN).padStart(3, '0')}`]
        );
        await c.query(
          `INSERT INTO reservas (locale_id, cliente_id, turno_id, fecha, hora, comensales, origen, estado)
           VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,'manual','confirmada')`,
          [L, r.rows[0].id, T, hora, 2 + (i % 4)]
        );
        extraN++;
      }
    }
    for (const rv of reservasData) {
      await c.query(
        `INSERT INTO reservas (locale_id, cliente_id, turno_id, fecha, hora, comensales, origen, estado,
                               mesa_id, confirmada_via, id_externo, notas, duracion_est_min)
         VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,$6,$7,$8,$9,$10,$11,105)`,
        [L, clientes[rv.cli], T, rv.hora, rv.pax, rv.origen, rv.estado,
         rv.mesa ? mesas[rv.mesa] : null, rv.conf || null, rv.idExt || null, rv.notas || null]
      );
    }

    // ---------- LISTA DE ESPERA ----------
    const waitData: [string, number, string, number, string, string][] = [
      ['Familia Baroja', 4, 'esperando', 16, 'Salón Interior', 'En barra tomando aperitivo. Espera actual: 16 min'],
      ['Hugo Valdés', 2, 'esperando', 8, 'Salón Interior', 'Prefiere Salón Interior · Mesa M-05 en cobro de cuenta'],
      ['Marta Beltrán', 6, 'esperando', 20, 'Patio / Terraza', 'Sin mesa asignada · Prefiere terraza climatizada'],
    ];
    let pos = 1;
    for (const [cli, pax, est, espera, zona, notas] of waitData) {
      await c.query(
        `INSERT INTO lista_espera (locale_id, cliente_id, turno_id, comensales, estado, zona_pref_id, tiempo_espera_est_min, posicion, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [L, clientes[cli], T, pax, est, zonas[zona], espera, pos++, notas]
      );
    }

    // ---------- MOVIMIENTOS DE INVENTARIO ----------
    await c.query(
      `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, motivo)
       VALUES ($1,'entrada',20,'Pedido semanal'), ($2,'salida',2.8,'Consumo del turno'), ($3,'ajuste',-0.5,'Merma registrada')`,
      [insumos['Malbec Reserva'], insumos['Lubina salvaje'], insumos['Corvina fresca']]
    );

    // Orden de compra generada por IA
    const orden = await c.query(
      `INSERT INTO ordenes_compra (proveedor_id, estado, total, origen_ia, creada_por, creada_en)
       VALUES ($1,'pendiente', 612.00, true, $2, NOW() - interval '40 minutes') RETURNING id`,
      [provs['Pescados Ría Verde'], users['Admin SavorAI']]
    );
    await c.query(
      `INSERT INTO lineas_orden_compra (orden_id, insumo_id, cantidad, costo_unitario) VALUES ($1,$2,15,18.00), ($1,$3,10,12.40)`,
      [orden.rows[0].id, insumos['Lubina salvaje'], insumos['Corvina fresca']]
    );

    // ---------- COMANDAS (KDS) ----------
    interface LineaSeed {
      plato: string; cant: number; asiento?: number; partida?: string; estado?: string;
      estacion?: string; fuego?: string; notas?: string; alerta?: string;
    }
    interface ComandaSeed {
      numero: string; mesa?: string; camarero: string; comensales: number; canal?: string;
      canalExt?: string; pedidoExt?: string; repartidor?: string; estado: string;
      minutos: number; lineas: LineaSeed[]; notas?: string;
    }
    const comandasData: ComandaSeed[] = [
      { numero: '1042', mesa: 'M-11', camarero: 'Mateo Rossi', comensales: 4, estado: 'pendiente', minutos: 2,
        lineas: [
          { plato: 'Tartar de Atún Rojo', cant: 2, partida: 'entrante', estado: 'pendiente', notas: 'Sin emulsión de sésamo ni pistacho', alerta: 'Alergia severa: Frutos secos (Comensal 2)' },
          { plato: 'Croquetas de Jamón Ibérico', cant: 1, partida: 'entrante', estado: 'pendiente', notas: 'Pase directo como entrante' },
          { plato: 'Solomillo de Vaca Madurada', cant: 1, partida: 'principal', estado: 'pendiente', notas: 'Punto de carne: Poco Hecho / Bleu' },
        ] },
      { numero: '1045', camarero: 'Mateo Rossi', comensales: 2, canal: 'takeaway', canalExt: 'glovo', estado: 'pendiente', minutos: 1,
        lineas: [
          { plato: 'Bao de Panceta Confitada', cant: 2, partida: 'entrante', estado: 'pendiente', notas: 'Salsa aparte' },
          { plato: 'PadThai Silvestre', cant: 1, partida: 'principal', estado: 'pendiente', notas: 'Sin picante' },
        ] },
      { numero: '1046', camarero: 'Sofía García', comensales: 2, canal: 'barra', estado: 'pendiente', minutos: 1,
        lineas: [{ plato: 'Ostras Gillardeau Nº2', cant: 6, partida: 'entrante', estado: 'pendiente', notas: 'Pasar a despacho frío' }] },
      { numero: '1036', mesa: 'P-05', camarero: 'Lucía Vega', comensales: 4, estado: 'en_cocina', minutos: 28,
        lineas: [
          { plato: 'Pulpo a la Brasa & Azafrán', cant: 1, partida: 'entrante', estado: 'lista' },
          { plato: 'Arroz Meloso con Bogavante', cant: 2, partida: 'principal', estado: 'en_preparacion', estacion: 'Fuego 4', fuego: 'Fuego 4', notas: 'Reposando en pase caliente' },
          { plato: 'Corvina Rostizada al Limón', cant: 1, partida: 'principal', estado: 'en_preparacion', estacion: 'Horno B', fuego: 'Horno B', alerta: 'SIN GLUTEN (Emplatado aislado)' },
        ] },
      { numero: '1039', mesa: 'M-08', camarero: 'Mateo Rossi', comensales: 2, estado: 'en_cocina', minutos: 19,
        lineas: [
          { plato: 'Ribeye Wagyu A5', cant: 1, partida: 'principal', estado: 'en_preparacion', notas: 'Punto: Medio / Medium-Rare' },
          { plato: 'Ravioli Trufa Negra y Yema', cant: 1, partida: 'principal', estado: 'pendiente' },
        ] },
      { numero: '1041', mesa: 'P-03', camarero: 'Lucía Vega', comensales: 2, estado: 'en_cocina', minutos: 10,
        lineas: [{ plato: 'Ceviche Clásico Corvina', cant: 2, partida: 'entrante', estado: 'en_preparacion' }] },
      { numero: '1035', mesa: 'P-02', camarero: 'Sofía García', comensales: 2, estado: 'lista', minutos: 12,
        lineas: [
          { plato: 'Risotto de Boletus y Trufa Melanosporum', cant: 2, partida: 'principal', estado: 'lista', estacion: 'Bandeja 1' },
          { plato: 'Tarta de Queso al Horno de Leña', cant: 1, partida: 'postre', estado: 'lista', estacion: 'Bandeja 1' },
        ] },
      { numero: '1038', camarero: 'Sofía García', comensales: 1, canal: 'takeaway', canalExt: 'ubereats', pedidoExt: '284', repartidor: 'UberEats', estado: 'lista', minutos: 9,
        lineas: [{ plato: 'Entrecot Black Angus a la Brasa', cant: 1, partida: 'principal', estado: 'lista', notas: 'Bolsa empacada en Estante 03' }] },
      { numero: '1031', mesa: 'M-14', camarero: 'Mateo Rossi', comensales: 2, estado: 'lista', minutos: 6,
        lineas: [{ plato: 'Coulant de Chocolate & Helado Vainilla', cant: 2, partida: 'postre', estado: 'lista' }] },
      { numero: '1030', mesa: 'M-06', camarero: 'Mateo Rossi', comensales: 4, estado: 'entregada', minutos: 21,
        lineas: [
          { plato: 'Solomillo de Vaca Madurada', cant: 2, partida: 'principal', estado: 'servida' },
          { plato: 'Pulpo a la Brasa & Azafrán', cant: 1, partida: 'entrante', estado: 'servida' },
          { plato: 'Tarta Fluida de Queso Idiazábal', cant: 1, partida: 'postre', estado: 'servida' },
        ] },
      { numero: '1028', mesa: 'P-01', camarero: 'Lucía Vega', comensales: 2, estado: 'entregada', minutos: 24,
        lineas: [
          { plato: 'Croquetas de Jamón Ibérico', cant: 1, partida: 'entrante', estado: 'servida' },
          { plato: 'Burrata Pugliese con Tartufata', cant: 1, partida: 'entrante', estado: 'servida' },
        ] },
      { numero: '1025', mesa: 'M-09', camarero: 'Sofía García', comensales: 2, estado: 'entregada', minutos: 26,
        lineas: [
          { plato: 'Malbec Reserva', cant: 1, partida: 'bebida', estado: 'servida' },
          { plato: 'Lubina Salvaje al Horno con Hinojo', cant: 1, partida: 'principal', estado: 'servida' },
        ] },
      // extras para llegar a 18
      { numero: '1043', mesa: 'M-12', camarero: 'Javier Ruiz', comensales: 3, estado: 'pendiente', minutos: 3,
        lineas: [{ plato: 'Burrata Pugliese con Tartufata', cant: 1, partida: 'entrante', estado: 'pendiente' }] },
      { numero: '1044', mesa: 'P-06', camarero: 'Javier Ruiz', comensales: 2, estado: 'pendiente', minutos: 2,
        lineas: [{ plato: 'Ceviche Clásico Corvina', cant: 1, partida: 'entrante', estado: 'pendiente' }] },
      { numero: '1040', mesa: 'M-18', camarero: 'Javier Ruiz', comensales: 6, estado: 'en_cocina', minutos: 15,
        lineas: [
          { plato: 'Entrecot Black Angus a la Brasa', cant: 3, partida: 'principal', estado: 'en_preparacion', estacion: 'Fuego 4' },
          { plato: 'Arroz Meloso con Bogavante', cant: 2, partida: 'principal', estado: 'en_preparacion', estacion: 'Fuego 4' },
        ] },
      { numero: '1037', mesa: 'M-04', camarero: 'Sofía García', comensales: 4, estado: 'en_cocina', minutos: 22,
        lineas: [{ plato: 'Ravioli Trufa Negra y Yema', cant: 3, partida: 'principal', estado: 'en_preparacion', estacion: 'Bandeja 1' }] },
      { numero: '1034', mesa: 'P-10', camarero: 'Lucía Vega', comensales: 5, estado: 'lista', minutos: 13,
        lineas: [{ plato: 'Corvina Rostizada al Limón', cant: 2, partida: 'principal', estado: 'lista', estacion: 'Pase Expo' }] },
      { numero: '1029', mesa: 'M-02', camarero: 'Mateo Rossi', comensales: 2, estado: 'entregada', minutos: 28,
        lineas: [{ plato: 'Tartar de Atún Rojo', cant: 1, partida: 'entrante', estado: 'servida' }] },
    ];

    for (const cm of comandasData) {
      const abierta = new Date(Date.now() - cm.minutos * 60000);
      const r = await c.query(
        `INSERT INTO comandas (numero, locale_id, mesa_id, turno_id, camarero_id, comensales, canal, estado,
                               canal_externo, pedido_externo_id, repartidor, abierta_en, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [cm.numero, L, cm.mesa ? mesas[cm.mesa] : null, T, users[cm.camarero], cm.comensales,
         cm.canal || 'salon', cm.estado, cm.canalExt || null, cm.pedidoExt || null, cm.repartidor || null,
         abierta, cm.notas || null]
      );
      const cid = r.rows[0].id as number;

      // historial de estados
      const flujo: string[] = ['pendiente'];
      if (['en_cocina', 'lista', 'entregada'].includes(cm.estado)) flujo.push('en_cocina');
      if (['lista', 'entregada'].includes(cm.estado)) flujo.push('lista');
      if (cm.estado === 'entregada') flujo.push('entregada');
      for (let i = 0; i < flujo.length; i++) {
        await c.query(
          `INSERT INTO historial_estados_comanda (comanda_id, estado, cambiado_en, usuario_id)
           VALUES ($1,$2,$3,$4)`,
          [cid, flujo[i], new Date(abierta.getTime() + i * 7 * 60000), users[cm.camarero]]
        );
      }

      for (const ln of cm.lineas) {
        await c.query(
          `INSERT INTO lineas_comanda (comanda_id, plato_id, cantidad, precio_unitario, asiento, partida,
                                       estado, estacion_id, notas, alerta_alergeno, fuego)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [cid, platos[ln.plato], ln.cant,
           (await c.query('SELECT precio FROM platos WHERE id=$1', [platos[ln.plato]])).rows[0].precio,
           ln.asiento || null, ln.partida || 'principal', ln.estado,
           ln.estacion ? estaciones[ln.estacion] : null, ln.notas || null, ln.alerta || null, ln.fuego || null]
        );
      }
    }

    // ---------- CUENTAS Y PAGOS ----------
    // Cuenta abierta de M-05 (cuenta solicitada) y de M-15; cuenta cobrada de M-06
    const cuentasSeed: [string, string, string, string, number][] = [
      ['C-1042', 'M-05', 'cuenta_solicitada', 'abierta', 480.0],
      ['C-1043', 'M-15', 'cuenta_solicitada', 'abierta', 340.0],
      ['C-1039', 'M-06', 'cobrada', 'cobrada', 148.5],
      ['C-1040', 'P-12', 'cuenta_solicitada', 'abierta', 215.0],
    ];
    for (const [num, mesa, _cs, est, total] of cuentasSeed) {
      const sub = Math.round((total / 1.1) * 100) / 100;
      const r = await c.query(
        `INSERT INTO cuentas (locale_id, mesa_id, turno_id, numero, estado, subtotal, iva_monto, total, cobrada_en)
         VALUES ($1,$2,$3,$4,$5::estado_cuenta,$6,$7,$8, CASE WHEN $9::text='cobrada' THEN NOW() - interval '25 minutes' ELSE NULL END)
         RETURNING id`,
        [L, mesas[mesa], T, num, est, sub, Math.round((total - sub) * 100) / 100, total, est]
      );
      if (est === 'cobrada') {
        await c.query(`INSERT INTO pagos (cuenta_id, metodo, monto, propina, usuario_id) VALUES ($1,'tarjeta',$2,$3,$4)`, [
          r.rows[0].id, total, 8.5, users['Ana Torres'],
        ]);
      }
    }

    // ---------- RECOMENDACIONES IA ----------
    const recosData: [string, string, string, number, object, string, string | null][] = [
      ['stock_critico', 'Lubina Salvaje al Horno: 4 raciones', 'Se proyectan 12 pedidos adicionales antes de las 22:30. El inventario se agotará en aprox. 18 minutos. Alternativa rentable: sugerir Corvina Rostizada (+72% margen).', 94, { insumo: 'Lubina salvaje', stock: 3.2, sugerencia: 'Corvina Rostizada al Limón' }, 'pendiente', null],
      ['demora', 'Desviación +6m en Partida Calientes', 'Demora acumulada en Partida Calientes (Platos principales superan en +6 min el promedio). Sugerido adelantar preparación de arroces.', 88, { desviacion: 6, partida: 'Calientes' }, 'pendiente', null],
      ['ocupacion', 'Disponibilidad IA: 3 mesas x 4 pax en Patio', '3 mesas libres de 4 pax en Patio con calefacción activa. Se puede liberar presión del salón asignando la lista de espera.', 91, { mesas: ['P-01', 'P-02', 'P-09'] }, 'aplicada', 'notificacion_enviada'],
      ['upsell', 'Maridaje Malbec Reserva para Mesa P-07', 'Cliente habitual Elena Romero suele pedir Vino Malbec Reserva tras la entrada. Confianza 94%.', 94, { mesa: 'P-07', cliente: 'Elena Romero', producto: 'Malbec Reserva' }, 'aplicada', 'sugerencia_enviada'],
      ['personal', 'Refuerzo de brigada Salón 20:30–23:00', 'Reforzar Salón con 1 camarero adicional para mantener tiempo de servicio por debajo de los 12 min con mesas al 100%.', 86, { zona: 'Salón Interior', horas: '20:30-23:00' }, 'pendiente', null],
      ['stock_critico', 'Aprovisionamiento crítico antes de 11:00', 'Solicitar 15 kg extra de Solomillo y 8 botellas de Malbec Reserva para evitar rotura de stock durante el segundo pase del sábado.', 92, { orden_generada: true }, 'aplicada', 'orden_creada'],
      ['clima', 'Optimización de terraza: demanda +120%', 'Noche templada (22°C sin viento). 14 clientes en lista de espera solicitan exterior. Habilitar 2 mesas lounge de refuerzo.', 89, { demanda: 120, mesas_sugeridas: 2 }, 'pendiente', null],
      ['personalizacion', 'Insight cliente: cumpleaños de Elena Romero', 'Hoy es su cumpleaños. Recibir con copa de bienvenida de Cava Gran Reserva. Alta afinidad con Solomillo y Malbec. En caso de rotura de stock en carne, sugerir Lubina Salvaje al Horno.', 97, { cliente: 'Elena Romero', accion: 'copa_bienvenida' }, 'aplicada', 'notificacion_enviada'],
    ];
    for (const [tipo, titulo, contenido, conf, datos, estado, accion] of recosData) {
      await c.query(
        `INSERT INTO recomendaciones_ia (locale_id, turno_id, tipo, titulo, contenido, confianza, datos, estado, accion_ejecutada, creada_en, resuelta_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::varchar,$9, NOW() - interval '20 minutes', CASE WHEN $8::text='aplicada' THEN NOW() - interval '5 minutes' ELSE NULL END)`,
        [L, T, tipo, titulo, contenido, conf, JSON.stringify(datos), estado, accion]
      );
    }

    // ---------- PREDICCIONES ----------
    for (const [hora, proj] of [
      ['19:30', 62], ['20:00', 71], ['20:45', 84], ['21:00', 90], ['21:30', 96], ['22:00', 93], ['22:30', 80],
    ] as [string, number][]) {
      await c.query(
        `INSERT INTO predicciones_demanda (locale_id, zona_id, fecha, hora, ocupacion_proyectada, factor_clima)
         VALUES ($1,$2,CURRENT_DATE,$3,$4,$5)`,
        [L, zonas['Patio / Terraza'], hora, proj, JSON.stringify({ temp: 22, lluvia: false, viento: 'suave' })]
      );
    }

    // ---------- NOTIFICACIONES ----------
    const notifs: [number | null, string, string, string][] = [
      [users['Sofía García'], 'interno', users['Sofía García'] ? 'Sofía García' : '', 'Mesa P-02 lista — Coulant de chocolate enviado al pase.'],
      [users['Mateo Rossi'], 'sms', '+34 612 890 234', 'Elena: mesa P-07 lista para sentar (confirmada vía SMS).'],
      [users['Carlos Peña'], 'interno', 'Cocina', '86 de Lubina Salvaje: quedan 4 raciones — notificar a camareros.'],
    ];
    for (const [uid, tipo, destino, contenido] of notifs) {
      await c.query(
        `INSERT INTO notificaciones (usuario_id, tipo, destino, titulo, contenido) VALUES ($1,$2,$3,$4,$5)`,
        [uid, tipo, destino, 'SavorAI', contenido]
      );
    }

    // ---------- DISPOSITIVOS IoT ----------
    const iots: [string, string, string][] = [
      ['camara', 'Cámara Salón Principal', 'Salón Interior'],
      ['camara', 'Cámara Pérgola', 'Pérgola Climatizada & Jardín Central'],
      ['sensor_clima', 'Sensor Clima Patio', 'Patio / Terraza'],
    ];
    for (const [tipo, nombre, zona] of iots) {
      await c.query(
        `INSERT INTO dispositivos_iot (locale_id, tipo, nombre, zona_id, ultimo_estado, ultima_lectura)
         VALUES ($1,$2,$3,$4,$5,NOW())`,
        [L, tipo, nombre, zonas[zona], JSON.stringify(tipo === 'sensor_clima' ? { temp: 22, humedad: 48 } : { online: true, mesas_visibles: 18 })]
      );
    }

    await c.query('COMMIT');

    const conteo = await c.query(`
      SELECT (SELECT COUNT(*) FROM mesas) AS mesas,
             (SELECT COUNT(*) FROM platos) AS platos,
             (SELECT COUNT(*) FROM comandas) AS comandas,
             (SELECT COUNT(*) FROM reservas) AS reservas,
             (SELECT COUNT(*) FROM clientes) AS clientes,
             (SELECT COUNT(*) FROM recomendaciones_ia) AS recomendaciones
    `);
    console.log('✅ Seed completado:', conteo.rows[0]);
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('❌ Error en seed:', err);
  process.exit(1);
});
