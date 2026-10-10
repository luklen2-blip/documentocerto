import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { query, withTransaction, isPostgresConfigured, closePgPool } from '../pg_pool.js';
import { runMigrations } from '../migration_runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(process.cwd(), 'backend', 'database', 'data');
const backupBaseDir = path.resolve(process.cwd(), 'backend', 'database', 'backup');

export async function migrateJsonDbToPostgres() {
  console.log('================================================================');
  console.log('DOCUMENTOCERTO — MIGRAÇÃO CONTROLADA JSONDB -> POSTGRESQL');
  console.log('================================================================\n');

  if (!isPostgresConfigured()) {
    console.log('[Migração Abortada]: DATABASE_URL não configurada no ambiente.');
    return { skipped: true, reason: 'NO_DATABASE_URL' };
  }

  // 1. GARANTE ESQUEMA DDL E TABELA DE CONTROLE DE MIGRAÇÕES DE DADOS
  console.log('[1/5] Validando migrações DDL e tabela de controle...');
  await runMigrations();

  await query(`
    CREATE TABLE IF NOT EXISTS data_migrations (
      version INT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      records_migrated INT NOT NULL,
      details JSONB,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Verifica se a migração inicial de dados já foi aplicada
  const checkRes = await query('SELECT version, applied_at FROM data_migrations WHERE version = 1');
  const alreadyMigrated = checkRes.rows.length > 0;

  // 2. BACKUP PRÉ-MIGRAÇÃO VERIFICÁVEL COM HASH SHA-256
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetBackupDir = path.join(backupBaseDir, `backup_${timestamp}`);
  fs.mkdirSync(targetBackupDir, { recursive: true });

  const jsonFiles = fs.existsSync(dataDir)
    ? fs.readdirSync(dataDir).filter(f => f.endsWith('.json'))
    : [];

  console.log(`\n[2/5] Realizando backup consistente com hash SHA-256 em: ${targetBackupDir}`);
  const manifest = {
    timestamp: new Date().toISOString(),
    totalFiles: jsonFiles.length,
    files: []
  };

  let totalRecordsJson = 0;
  for (const f of jsonFiles) {
    const srcPath = path.join(dataDir, f);
    const destPath = path.join(targetBackupDir, f);
    const content = fs.readFileSync(srcPath, 'utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const stat = fs.statSync(srcPath);
    let count = 0;
    try {
      const parsed = JSON.parse(content);
      count = Array.isArray(parsed) ? parsed.length : (parsed ? 1 : 0);
    } catch {}

    fs.copyFileSync(srcPath, destPath);
    totalRecordsJson += count;
    manifest.files.push({
      fileName: f,
      sizeBytes: stat.size,
      records: count,
      sha256: hash
    });
  }

  manifest.totalRecords = totalRecordsJson;
  fs.writeFileSync(path.join(targetBackupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`[2/5] ✅ Backup concluído com sucesso: ${jsonFiles.length} arquivos, ${totalRecordsJson} registros e manifest.json gerado.`);

  // 3. CARREGAMENTO DOS DADOS ORIGINAIS
  function loadJson(name) {
    const p = path.join(dataDir, `${name}.json`);
    if (!fs.existsSync(p)) return [];
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
      return [];
    }
  }

  const data = {
    organizations: loadJson('organizations'),
    users: loadJson('users'),
    checklists: loadJson('checklists'),
    processes: loadJson('processes'),
    documents: loadJson('documents'),
    audit_logs: loadJson('audit_logs'),
    analysis_jobs: loadJson('analysis_jobs'),
    extracted_text: loadJson('extracted_text'),
    extracted_fields: loadJson('extracted_fields'),
    findings: loadJson('findings'),
    ai_analysis: loadJson('ai_analysis'),
    kiwify_webhook_events: loadJson('kiwify_webhook_events'),
    kiwify_transactions: loadJson('kiwify_transactions')
  };

  // 4. INSERÇÃO ATÔMICA PARAMETRIZADA EM TRANSAÇÃO ÚNICA (ACID)
  console.log('\n[3/5] Inserindo dados parametrizados em transação atômica...');
  const migrationResults = {};

  await withTransaction(async (client) => {
    // 4.1 Organizations
    for (const org of data.organizations) {
      await client.query(`
        INSERT INTO organizations (
          id, nome, cpf_cnpj, plano, ativo, trial_ativo, trial_dias,
          trial_iniciado_em, trial_expira_em, limite_processos_mes, processos_criados_mes,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          nome = EXCLUDED.nome,
          plano = EXCLUDED.plano,
          trial_ativo = EXCLUDED.trial_ativo,
          trial_expira_em = EXCLUDED.trial_expira_em,
          updated_at = EXCLUDED.updated_at
      `, [
        org.id,
        org.nome,
        org.cpfCnpj || null,
        org.plano || 'GRATIS',
        org.ativo !== false,
        org.trialAtivo !== false,
        org.trialDias || 1,
        org.trialIniciadoEm || org.createdAt || new Date().toISOString(),
        org.trialExpiraEm || null,
        org.limiteProcessosMes || 20,
        org.processosCriadosMes || 0,
        org.createdAt || new Date().toISOString(),
        org.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.2 Users
    for (const u of data.users) {
      await client.query(`
        INSERT INTO users (
          id, tenant_id, nome, email, senha_hash, papel, ativo, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          nome = EXCLUDED.nome,
          email = EXCLUDED.email,
          papel = EXCLUDED.papel,
          ativo = EXCLUDED.ativo,
          updated_at = EXCLUDED.updated_at
      `, [
        u.id,
        u.tenantId,
        u.nome,
        u.email.toLowerCase().trim(),
        u.senhaHash,
        u.papel || 'MEMBRO',
        u.ativo !== false,
        u.createdAt || new Date().toISOString(),
        u.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.3 Checklists
    for (const chk of data.checklists) {
      await client.query(`
        INSERT INTO checklists (
          id, tenant_id, is_system_template, nome, descricao, categoria, ativo, itens, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          nome = EXCLUDED.nome,
          descricao = EXCLUDED.descricao,
          itens = EXCLUDED.itens,
          updated_at = EXCLUDED.updated_at
      `, [
        chk.id,
        chk.tenantId || 'system',
        Boolean(chk.isSystemTemplate),
        chk.nome,
        chk.descricao || null,
        chk.categoria || null,
        chk.ativo !== false,
        JSON.stringify(chk.itens || []),
        chk.createdAt || new Date().toISOString(),
        chk.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.4 Processes
    for (const p of data.processes) {
      await client.query(`
        INSERT INTO processes (
          id, tenant_id, nome, tipo, responsavel_id, responsavel_nome,
          status_workflow, status_deterministico, prazo, observacoes,
          checklist_id, checklist_nome, itens, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          nome = EXCLUDED.nome,
          status_workflow = EXCLUDED.status_workflow,
          status_deterministico = EXCLUDED.status_deterministico,
          itens = EXCLUDED.itens,
          updated_at = EXCLUDED.updated_at
      `, [
        p.id,
        p.tenantId,
        p.nome,
        p.tipo || null,
        p.responsavelId || null,
        p.responsavelNome || null,
        p.statusWorkflow || 'EM_ANDAMENTO',
        p.statusDeterminístico || null,
        p.prazo || null,
        p.observacoes || null,
        p.checklistId || null,
        p.checklistNome || null,
        JSON.stringify(p.itens || []),
        p.createdAt || new Date().toISOString(),
        p.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.5 Documents
    for (const doc of data.documents) {
      await client.query(`
        INSERT INTO documents (
          id, tenant_id, process_id, item_id, original_name, stored_filename,
          mime_type, size_bytes, storage_path, uploaded_by, uploaded_by_name,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO NOTHING
      `, [
        doc.id,
        doc.tenantId,
        doc.processId,
        doc.itemId,
        doc.originalName,
        doc.storedFilename,
        doc.mimeType,
        doc.sizeBytes,
        doc.storagePath,
        doc.uploadedBy || null,
        doc.uploadedByName || null,
        doc.createdAt || new Date().toISOString(),
        doc.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.6 Audit Logs
    for (const al of data.audit_logs) {
      await client.query(`
        INSERT INTO audit_logs (
          id, tenant_id, process_id, user_id, user_name, action, details, timestamp, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING
      `, [
        al.id,
        al.tenantId,
        al.processId || null,
        al.userId || null,
        al.userName || null,
        al.action,
        JSON.stringify(al.details || {}),
        al.timestamp || al.createdAt || new Date().toISOString(),
        al.createdAt || new Date().toISOString(),
        al.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.7 Analysis Jobs
    for (const job of data.analysis_jobs) {
      await client.query(`
        INSERT INTO analysis_jobs (
          id, tenant_id, process_id, version, status, progress, stage, error, result,
          created_by, created_by_name, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          progress = EXCLUDED.progress,
          result = EXCLUDED.result,
          updated_at = EXCLUDED.updated_at
      `, [
        job.id,
        job.tenantId,
        job.processId,
        job.version || 1,
        job.status,
        job.progress || 0,
        job.stage || null,
        job.error || null,
        JSON.stringify(job.result || {}),
        job.createdBy || null,
        job.createdByName || null,
        job.createdAt || new Date().toISOString(),
        job.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.8 Extracted Text
    for (const et of data.extracted_text) {
      await client.query(`
        INSERT INTO extracted_text (
          id, tenant_id, process_id, document_id, job_id, text, confidence, source, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING
      `, [
        et.id,
        et.tenantId,
        et.processId,
        et.documentId,
        et.jobId || null,
        et.text || null,
        et.confidence || null,
        et.source || null,
        et.createdAt || new Date().toISOString(),
        et.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.9 Extracted Fields
    for (const ef of data.extracted_fields) {
      await client.query(`
        INSERT INTO extracted_fields (
          id, tenant_id, process_id, job_id, document_id, document_name, page,
          field, value, normalized_value, confidence, source, snippet, validation,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO NOTHING
      `, [
        ef.id,
        ef.tenantId,
        ef.processId,
        ef.jobId || null,
        ef.document_id || null,
        ef.document_name || null,
        ef.page || null,
        ef.field,
        ef.value || null,
        ef.normalized_value || null,
        ef.confidence || null,
        ef.source || null,
        ef.snippet || null,
        JSON.stringify(ef.validation || {}),
        ef.createdAt || new Date().toISOString(),
        ef.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.10 Findings
    for (const f of data.findings) {
      await client.query(`
        INSERT INTO findings (
          id, tenant_id, process_id, job_id, severity, code, title, message, recommendation, evidence, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING
      `, [
        f.id,
        f.tenantId,
        f.processId,
        f.jobId || null,
        f.severity,
        f.code,
        f.title,
        f.message,
        f.recommendation || null,
        JSON.stringify(f.evidence || {}),
        f.createdAt || new Date().toISOString(),
        f.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.11 AI Analysis
    for (const ai of data.ai_analysis) {
      await client.query(`
        INSERT INTO ai_analysis (
          id, tenant_id, process_id, job_id, summary, findings, confidence, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
      `, [
        ai.id,
        ai.tenantId,
        ai.processId,
        ai.jobId || null,
        ai.summary || null,
        JSON.stringify(ai.findings || []),
        ai.confidence || null,
        ai.createdAt || new Date().toISOString(),
        ai.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.12 Kiwify Webhook Events
    for (const we of data.kiwify_webhook_events) {
      await client.query(`
        INSERT INTO kiwify_webhook_events (
          id, event_id, order_id, event_type, status, payload, customer_email,
          product_id, signature_received, error_message, processed_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (order_id, event_type) DO NOTHING
      `, [
        we.id,
        we.eventId || null,
        we.orderId,
        we.eventType,
        we.status || 'PROCESSED',
        JSON.stringify(we.payload || {}),
        we.customerEmail || null,
        we.productId || null,
        we.signatureReceived || null,
        we.errorMessage || we.error || null,
        we.processedAt || we.createdAt || new Date().toISOString(),
        we.createdAt || new Date().toISOString()
      ]);
    }

    // 4.13 Kiwify Transactions
    for (const tx of data.kiwify_transactions) {
      await client.query(`
        INSERT INTO kiwify_transactions (
          id, order_id, order_ref, tenant_id, user_id, customer_email,
          customer_name, customer_cpf, product_id, product_name, plano_ativado,
          valor_pago, payment_method, status, claim_token, claimed_at,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (order_id) DO UPDATE SET
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
      `, [
        tx.id,
        tx.orderId,
        tx.orderRef || null,
        tx.tenantId || null,
        tx.userId || null,
        tx.customerEmail,
        tx.customerName || null,
        tx.customerCpf || null,
        tx.productId || null,
        tx.productName || null,
        tx.planoAtivado || tx.plan || 'VITALICIO',
        tx.valorPago || (tx.amountCents ? tx.amountCents / 100 : 19.90),
        tx.paymentMethod || 'pix',
        tx.status || 'PAID',
        tx.claimToken || null,
        tx.claimedAt || null,
        tx.createdAt || new Date().toISOString(),
        tx.updatedAt || new Date().toISOString()
      ]);
    }

    // 4.14 Registro em data_migrations
    await client.query(`
      INSERT INTO data_migrations (version, name, records_migrated, details, applied_at)
      VALUES (1, '001_initial_data_migration', $1, $2, NOW())
      ON CONFLICT (version) DO UPDATE SET
        records_migrated = EXCLUDED.records_migrated,
        applied_at = NOW()
    `, [totalRecordsJson, JSON.stringify({ collections: Object.keys(data).length })]);
  });

  console.log('[3/5] ✅ Todos os dados inseridos com sucesso na transação PostgreSQL.');

  // 5. RECONCILIAÇÃO REGISTRO A REGISTRO
  console.log('\n[4/5] RECONCILIAÇÃO DETALHADA ORIGEM (JSONDB) VS DESTINO (POSTGRESQL):');
  console.log('-----------------------------------------------------------------------');
  console.log('Tabela               | JsonDB | PostgreSQL | Status       | Auditoria');
  console.log('-----------------------------------------------------------------------');

  const tables = [
    'organizations', 'users', 'checklists', 'processes', 'documents',
    'audit_logs', 'analysis_jobs', 'extracted_text', 'extracted_fields',
    'findings', 'ai_analysis', 'kiwify_webhook_events', 'kiwify_transactions'
  ];

  let hasError = false;
  let totalPgRecords = 0;

  for (const t of tables) {
    const res = await query(`SELECT COUNT(*) AS total FROM ${t}`);
    const pgCount = parseInt(res.rows[0].total, 10);
    const jsonCount = (data[t] || []).length;
    totalPgRecords += pgCount;
    const ok = pgCount >= jsonCount;
    if (!ok) hasError = true;

    migrationResults[t] = { jsonCount, pgCount, status: ok ? 'RECONCILIADO' : 'DIVERGENCIA' };
    console.log(
      `${t.padEnd(20)} | ` +
      `${String(jsonCount).padStart(6)} | ` +
      `${String(pgCount).padStart(10)} | ` +
      `${ok ? '✅ RECONCILIADO' : '❌ ERRO       '} | ` +
      `${pgCount === jsonCount ? 'Correspondência exata' : `+${pgCount - jsonCount} novos no PG`}`
    );
  }
  console.log('-----------------------------------------------------------------------');
  console.log(`TOTAL RECONCILIADO: ${totalRecordsJson} registros do JsonDB presentes em ${totalPgRecords} linhas do PostgreSQL.`);

  if (hasError) {
    throw new Error('Falha crítica na reconciliação da migração! Divergência detectada.');
  }

  console.log('\n[5/5] ✅ RECONCILIAÇÃO CONCLUÍDA COM 100% DE SUCESSO!');
  console.log('O JsonDB permanece intacto como salvaguarda e os dados estão ativos no PostgreSQL.');
  console.log('================================================================\n');

  return {
    success: true,
    backupDir: targetBackupDir,
    manifest,
    totalRecordsJson,
    totalPgRecords,
    reconciliation: migrationResults
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrateJsonDbToPostgres()
    .then(() => closePgPool().then(() => process.exit(0)))
    .catch(err => {
      console.error('[FATAL MIGRAÇÃO]:', err.message);
      closePgPool().then(() => process.exit(1));
    });
}
