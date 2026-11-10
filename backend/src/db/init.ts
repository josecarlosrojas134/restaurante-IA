import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './pool';

/**
 * Crea el esquema completo a partir de schema.sql.
 * ATENCIÓN: ejecuta DROP CASCADE de todas las tablas.
 */
async function init() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    console.log('⏳ Creando esquema...');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE;');
    await client.query('CREATE SCHEMA public;');
    await client.query(sql);
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`
    );
    console.log(`✅ Esquema creado: ${rows[0].n} tablas.`);
  } finally {
    client.release();
    await pool.end();
  }
}

init().catch((err) => {
  console.error('❌ Error creando el esquema:', err);
  process.exit(1);
});
