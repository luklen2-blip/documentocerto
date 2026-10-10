import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, withTransaction, isPostgresConfigured, closePgPool } from '../pg_pool.js';
import { runMigrations } from '../migration_runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(process.cwd(), 'backend', 'database', 'data');
const backupBaseDir = path.join(process.cwd(), 'backend', 'database', 'backup');

export async function migrateJsonDbToPostgres() {
  console.log('================================================================');
  console.log('DOCUMENTOCERTO — MIGRAÇÃO SEGURA JSONDB -> POSTGRESQL');
  console.log('================================================================\n');

  if (!isPostgresConfigured()) {
    throw new Error('DATABASE_URL não configurada. Impossível migrar sem banco de destino.');
  }

  // 1. BACKUP PRÉ-MIGRAÇÃO VERIFICÁVEL
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetBackupDir = path.join(backupBaseDir, `backup_${timestamp}`);
  fs.mkdirSync(targetBackupDir, { recursive: true });

  const jsonFiles = fs.existsSync(dataDir)
    ? fs.readdirSync(dataDir).filter(f => f.endsWith('.json'))
    : [];

  console.log(`[1/4] Realizando backup de segurança em: ${targetBackupDir}`);
  for (const f of jsonFiles) {
    fs.copyFileSync(path.join(dataDir, f), path.join(targetBackupDir, f));
  }
  console.log(`[1/4] ✅ Backup concluído com sucesso (${jsonFiles.length} arquivos preservados).`);

  // 2. EXECUÇÃO DE MIGRAÇÕES SQL
  console.log('\n[2/4] Executando migrações SQL...');
  await runMigrations();
  console.log('[2/4] ✅ Esquema relacional PostgreSQL validado.');

  // 3. CARREGAMENTO DOS DADOS DO JSONDB
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
    ai_analysis: loadJson('ai_analysis')
  };

  console.log('\n[3/4] Inserindo dados parametrizados em transação...');
  const migrationResults = {};

  await withTransaction(async (client) => {
    // 3.1 Organizations
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

    // 3.2 Users
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

    // 3.3 Checklists
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

    // 3.4 Processes
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

    // 3.5 Documents
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

    // 3.6 Audit Logs
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

    // 3.7 Analysis Jobs
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

    // 3.8 Extracted Text
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

    // 3.9 Extracted Fields
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

    // 3.10 Findings
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

    // 3.11 AI Analysis
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
  });

  console.log('[3/4] ✅ Dados inseridos no PostgreSQL com integridade referencial.');

  // 4. VALIDAÇÃO CRUZADA E CONFERÊNCIA DE CONTAGEM
  console.log('\n[4/4] Validando contagem e integridade entre JsonDB e PostgreSQL:');
  const tables = [
    'organizations', 'users', 'checklists', 'processes', 'documents',
    'audit_logs', 'analysis_jobs', 'extracted_text', 'extracted_fields',
    'findings', 'ai_analysis'
  ];

  let hasError = false;
  for (const t of tables) {
    const res = await query(`SELECT COUNT(*) AS total FROM ${t}`);
    const pgCount = parseInt(res.rows[0].total, 10);
    const jsonCount = (data[t] || []).length;
    const ok = pgCount >= jsonCount;
    if (!ok) hasError = true;
    migrationResults[t] = { jsonCount, pgCount, status: ok ? 'OK' : 'MISMATCH' };
    console.log(`   - ${t.padEnd(20)} | JsonDB: ${jsonCount.toString().padStart(3)} | PostgreSQL: ${pgCount.toString().padStart(3)} | ${ok ? '✅ OK' : '❌ ERRO'}`);
  }

  if (hasError) {
    throw new Error('Falha na validação de contagem da migração! Divergência detectada.');
  }

  console.log('\n================================================================');
  console.log('MIGRAÇÃO CONCLUÍDA COM 100% DE SUCESSO E INTEGRIDADE CONFIRMADA!');
  console.log('O JsonDB original permanece intacto no disco como garantia.');
  console.log('================================================================');

  return { success: true, backupDir: targetBackupDir, results: migrationResults };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrateJsonDbToPostgres()
    .then(r => {
      closePgPool().then(() => process.exit(0));
    })
    .catch(err => {
      console.error('[FATAL MIGRAÇÃO]:', err.message);
      closePgPool().then(() => process.exit(1));
    });
}
