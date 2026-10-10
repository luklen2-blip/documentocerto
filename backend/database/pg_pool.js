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
      console.warn('[Aviso] DATABASE_URL não configurada em produção. Operando em modo de transição.');
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

export function getMaskedConnectionInfo() {
  const urlStr = process.env.DATABASE_URL;
  if (!urlStr) return null;
  try {
    const parsed = new URL(urlStr);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : '',
      user: parsed.username || 'postgres',
      ssl: parsed.searchParams.get('sslmode') || 'require'
    };
  } catch {
    return { host: 'masked', database: 'masked' };
  }
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
      message: 'DATABASE_URL não configurada no ambiente (aguardando vinculação no Render).'
    };
  }

  const start = Date.now();
  try {
    const res = await query('SELECT 1 AS alive, current_database() AS db, version() AS version, NOW() AS server_time');
    const latency_ms = Date.now() - start;

    let tables = [];
    try {
      const tablesRes = await query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name ASC
      `);
      tables = tablesRes.rows.map(r => r.table_name);
    } catch {
      // Falha não crítica na listagem
    }

    let dataMigration = null;
    try {
      const dmRes = await query('SELECT version, name, records_migrated, applied_at FROM data_migrations WHERE version = 1');
      if (dmRes.rows.length > 0) {
        dataMigration = {
          migrated: true,
          records: dmRes.rows[0].records_migrated,
          applied_at: dmRes.rows[0].applied_at
        };
      }
    } catch {}

    let recordCounts = {};
    try {
      for (const t of ['organizations', 'users', 'processes', 'checklists', 'documents', 'document_blobs']) {
        if (tables.includes(t)) {
          const cRes = await query(`SELECT count(*)::int AS count FROM ${t}`);
          recordCounts[t] = cRes.rows[0].count;
        }
      }
    } catch {}

    return {
      connected: true,
      configured: true,
      driver: 'PostgreSQL',
      database: res.rows[0].db,
      version: res.rows[0].version?.split(' ')[0] || 'PostgreSQL',
      latency_ms,
      total_tables: tables.length,
      tables,
      data_migration: dataMigration,
      record_counts: recordCounts,
      last_check: new Date().toISOString(),
      pool: {
        total_connections: pool?.totalCount || 0,
        idle_connections: pool?.idleCount || 0,
        waiting_clients: pool?.waitingCount || 0
      },
      connection: getMaskedConnectionInfo()
    };
  } catch (err) {
    return {
      connected: false,
      configured: true,
      driver: 'PostgreSQL',
      latency_ms: Date.now() - start,
      error: err.message,
      last_check: new Date().toISOString(),
      connection: getMaskedConnectionInfo()
    };
  }
}

export async function closePgPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
