import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function isPostgresConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
}

export function getPgPool() {
  if (pool) return pool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    if (process.env.NODE_ENV === 'production') {
      console.error('================================================================');
      console.error('[FATAL] DATABASE_URL não configurada em ambiente de produção!');
      console.error('Para prevenir perda de dados em disco efêmero, o PostgreSQL é obrigatório.');
      console.error('================================================================');
      throw new Error('DATABASE_URL ausente em produção.');
    }
    return null;
  }

  // Configura SSL seguro (necessário para Render PostgreSQL / Supabase / Neon)
  const isSslRequired = databaseUrl.includes('render.com') ||
                        databaseUrl.includes('neon.tech') ||
                        databaseUrl.includes('supabase.co') ||
                        process.env.NODE_ENV === 'production';

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: isSslRequired ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.PG_POOL_MAX || '10', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  pool.on('error', (err) => {
    console.error('[PostgreSQL Pool Error]: Erro inesperado em cliente inativo:', err.message);
  });

  return pool;
}

export async function query(text, params = []) {
  const p = getPgPool();
  if (!p) {
    throw new Error('PostgreSQL Pool não inicializado. Verifique DATABASE_URL.');
  }
  const start = Date.now();
  try {
    const res = await p.query(text, params);
    const duration = Date.now() - start;
    if (process.env.DEBUG_SQL) {
      console.log(`[SQL] Executado em ${duration}ms | Linhas: ${res.rowCount}`);
    }
    return res;
  } catch (err) {
    console.error('[SQL Error]:', err.message);
    throw err;
  }
}

export async function withTransaction(callback) {
  const p = getPgPool();
  if (!p) {
    throw new Error('PostgreSQL Pool não inicializado para transação.');
  }

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Transaction Rolled Back]:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function checkConnection() {
  if (!isPostgresConfigured()) {
    return {
      connected: false,
      configured: false,
      driver: 'JsonDB',
      message: 'DATABASE_URL não configurada (operando em modo de compatibilidade/desenvolvimento).'
    };
  }

  try {
    const res = await query('SELECT 1 AS alive, current_database() AS db, version() AS version');
    return {
      connected: true,
      configured: true,
      driver: 'PostgreSQL',
      database: res.rows[0].db,
      version: res.rows[0].version?.split(' ')[0] || 'PostgreSQL'
    };
  } catch (err) {
    return {
      connected: false,
      configured: true,
      driver: 'PostgreSQL',
      error: err.message
    };
  }
}

export async function closePgPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
