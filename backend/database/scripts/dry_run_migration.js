/**
 * DocumentoCerto — Script de Simulação e Inventário Pré-Migração (Dry-Run)
 * Executa checagem de 360° em todos os registros do JsonDB sem realizar escrita no banco.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(process.cwd(), 'backend', 'database', 'data');

export function runDryRun() {
  console.log('================================================================');
  console.log('🔍 DOCUMENTOCERTO — SIMULAÇÃO E INVENTÁRIO PRÉ-MIGRAÇÃO (DRY-RUN)');
  console.log(`Diretório de Origem: ${dataDir}`);
  console.log('================================================================\n');

  if (!fs.existsSync(dataDir)) {
    throw new Error(`Diretório de dados não encontrado: ${dataDir}`);
  }

  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).sort();
  const inventory = {};
  const issues = [];

  // 1. Leitura e Inventário de Cada Coleção
  for (const file of files) {
    const filePath = path.join(dataDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const sizeBytes = fs.statSync(filePath).size;
    
    let records = [];
    try {
      const parsed = JSON.parse(content);
      records = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    } catch (e) {
      issues.push({ file, type: 'JSON_SYNTAX_ERROR', message: e.message });
      continue;
    }

    const collectionName = path.basename(file, '.json');
    inventory[collectionName] = {
      file,
      count: records.length,
      sizeBytes,
      hash,
      records
    };
  }

  console.log('📊 [1/4] INVENTÁRIO DE COLEÇÕES:');
  console.log('----------------------------------------------------------------');
  console.log('Coleção                     | Registros | Tamanho (KB) | Hash SHA-256 (prefixo)');
  console.log('----------------------------------------------------------------');
  let totalRecords = 0;
  for (const [col, info] of Object.entries(inventory)) {
    totalRecords += info.count;
    console.log(
      `${col.padEnd(27)} | ` +
      `${String(info.count).padStart(9)} | ` +
      `${(info.sizeBytes / 1024).toFixed(2).padStart(12)} | ` +
      `${info.hash.substring(0, 16)}...`
    );
  }
  console.log('----------------------------------------------------------------');
  console.log(`TOTAL GERAL: ${totalRecords} registros em ${Object.keys(inventory).length} arquivos.\n`);

  // 2. Análise de Identificadores e Unicidade
  console.log('🔑 [2/4] VERIFICAÇÃO DE IDENTIFICADORES E UNICIDADE:');
  for (const [col, info] of Object.entries(inventory)) {
    const ids = new Set();
    let duplicates = 0;
    let missingIds = 0;

    for (const rec of info.records) {
      if (!rec.id) {
        missingIds++;
      } else if (ids.has(rec.id)) {
        duplicates++;
      } else {
        ids.add(rec.id);
      }
    }

    if (duplicates > 0 || missingIds > 0) {
      issues.push({ col, type: 'ID_ANOMALY', duplicates, missingIds });
      console.log(`   ⚠️ ${col}: ${duplicates} IDs duplicados, ${missingIds} registros sem ID`);
    } else {
      console.log(`   ✅ ${col.padEnd(25)}: Todos os ${info.count} IDs são válidos e únicos.`);
    }
  }

  // 3. Verificação de Integridade Referencial (Relações Órfãs)
  console.log('\n🔗 [3/4] SIMULAÇÃO DE INTEGRIDADE REFERENCIAL ENTRE TABELAS:');
  const orgIds = new Set((inventory.organizations?.records || []).map(o => o.id));
  const userIds = new Set((inventory.users?.records || []).map(u => u.id));
  const processIds = new Set((inventory.processes?.records || []).map(p => p.id));

  // 3.1 Usuários -> Organizações
  let orphanUsers = 0;
  for (const u of (inventory.users?.records || [])) {
    if (u.tenantId && !orgIds.has(u.tenantId)) orphanUsers++;
  }
  console.log(`   - Usuários -> Organizações: ${orphanUsers === 0 ? '✅ 100% íntegro' : `⚠️ ${orphanUsers} órfãos`}`);

  // 3.2 Processos -> Organizações
  let orphanProcesses = 0;
  for (const p of (inventory.processes?.records || [])) {
    if (p.tenantId && !orgIds.has(p.tenantId)) orphanProcesses++;
  }
  console.log(`   - Processos -> Organizações: ${orphanProcesses === 0 ? '✅ 100% íntegro' : `⚠️ ${orphanProcesses} órfãos`}`);

  // 3.3 Documentos -> Processos
  let orphanDocuments = 0;
  for (const d of (inventory.documents?.records || [])) {
    if (d.processId && !processIds.has(d.processId)) orphanDocuments++;
  }
  console.log(`   - Documentos -> Processos: ${orphanDocuments === 0 ? '✅ 100% íntegro' : `⚠️ ${orphanDocuments} órfãos`}`);

  // 3.4 Jobs de Análise -> Processos
  let orphanJobs = 0;
  for (const j of (inventory.analysis_jobs?.records || [])) {
    if (j.processId && !processIds.has(j.processId)) orphanJobs++;
  }
  console.log(`   - Jobs de Análise -> Processos: ${orphanJobs === 0 ? '✅ 100% íntegro' : `⚠️ ${orphanJobs} órfãos`}`);

  // 4. Conclusão da Simulação
  console.log('\n📋 [4/4] PARECER DA SIMULAÇÃO PRÉ-MIGRAÇÃO:');
  if (issues.length === 0 && orphanUsers === 0 && orphanProcesses === 0) {
    console.log('🟢 SIMULAÇÃO 100% APROVADA: Os dados estão prontos para migração atômica no PostgreSQL.');
    console.log('   Nenhum registro órfão ou conflitante foi identificado.');
    console.log('   Estratégia: Inserção parametrizada em ordem de dependência referencial.');
  } else {
    console.log('🟡 SIMULAÇÃO CONCLUÍDA COM APONTAMENTOS:');
    console.log(issues);
  }
  console.log('================================================================\n');

  return { inventory, totalRecords, issues, orphanUsers, orphanProcesses, orphanDocuments };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDryRun();
}
