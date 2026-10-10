import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, withTransaction, isPostgresConfigured } from './pg_pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  if (!isPostgresConfigured()) {
    console.log('[Migrations] PostgreSQL não configurado. Pulando execução de migrações.');
    return { applied: [], skipped: true };
  }

  console.log('[Migrations] Iniciando verificação de migrações PostgreSQL...');

  // 1. Garante que a tabela de controle de migração existe
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 2. Consulta migrações já aplicadas
  const appliedRes = await query('SELECT version FROM schema_migrations ORDER BY version ASC');
  const appliedVersions = new Set(appliedRes.rows.map(r => r.version));

  // 3. Lê arquivos da pasta migrations
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('[Migrations] Nenhuma pasta de migrações encontrada.');
    return { applied: [], skipped: false };
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const appliedNow = [];

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match) continue;
    const version = parseInt(match[1], 10);

    if (appliedVersions.has(version)) {
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log(`[Migrations] Executando migração ${file}...`);

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW())',
        [version, file]
      );
    });

    console.log(`[Migrations] ✅ Migração ${file} aplicada com sucesso!`);
    appliedNow.push(file);
  }

  if (appliedNow.length === 0) {
    console.log('[Migrations] Todas as migrações já estão atualizadas.');
  }

  return { applied: appliedNow, skipped: false };
}

// Execução direta via CLI se chamado como script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(res => {
      console.log('[Migrations] Concluído:', res);
      process.exit(0);
    })
    .catch(err => {
      console.error('[Migrations FATAL]:', err);
      process.exit(1);
    });
}
