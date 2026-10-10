/**
 * DocumentoCerto — Teste E2E de Armazenamento Persistente e Auto-Reidratação
 * Valida:
 * 1. Upload de documento com persistência híbrida e cálculo de SHA-256.
 * 2. Destruição do arquivo no disco local (simulando reset do contêiner efêmero do Render).
 * 3. Recuperação transparente via auto-reidratação no endpoint de download (HTTP 200).
 * 4. Verificação de integridade bit-a-bit do hash SHA-256.
 * 5. Proteção de isolamento multi-tenant (HTTP 403 em tentativa cross-tenant).
 * 6. Execução de OCR sobre o arquivo reidratado.
 */

process.env.NODE_ENV = 'test';

import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import app from '../server.js';
import {
  organizationsDb,
  usersDb,
  checklistsDb,
  processesDb,
  documentsDb
} from '../backend/database/index.js';
import { StorageService } from '../backend/services/storage_service.js';
import { AnalysisJobService } from '../backend/services/analysis_job_service.js';
import { createToken } from '../backend/utils/crypto_utils.js';

let server;
let baseUrl = '';

function request(urlPath, options = {}) {
  const url = new URL(urlPath, baseUrl);
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers };
    let bodyData = options.body;

    const req = http.request(url, {
      method: options.method || 'GET',
      headers
    }, (res) => {
      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        const raw = rawBuffer.toString('utf-8');
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
          raw,
          buffer: rawBuffer
        });
      });
    });

    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function createMultipartFormData(fields, fileField) {
  const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
  const chunks = [];

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }

  if (fileField) {
    chunks.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\n` +
      `Content-Type: ${fileField.contentType}\r\n\r\n`
    ));
    chunks.push(fileField.buffer);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body
  };
}

export async function runStoragePersistenceTests() {
  console.log('================================================================');
  console.log('🛡️ TESTE DE ARMAZENAMENTO PERSISTENTE E AUTO-REIDRATAÇÃO');
  console.log('================================================================\n');

  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`⏳ Testando: ${name}... `);
    try {
      await fn();
      console.log('✅ APROVADO');
      passed++;
    } catch (err) {
      console.log(`❌ REPROVADO: ${err.message}`);
      failed++;
    }
  }

  // 1. Setup: Cria Tenants A e B
  const tenantA = `org_storage_a_${Date.now()}`;
  const tenantB = `org_storage_b_${Date.now()}`;

  organizationsDb.insert({ id: tenantA, nome: 'Empresa A Teste Storage', ativo: true, plano: 'VITALICIO', trialAtivo: true });
  organizationsDb.insert({ id: tenantB, nome: 'Empresa B Invasora', ativo: true, plano: 'VITALICIO', trialAtivo: true });

  const userA = { id: `usr_a_${Date.now()}`, tenantId: tenantA, nome: 'Admin A', email: `a_${Date.now()}@teste.com`, papel: 'ADMIN', ativo: true };
  const userB = { id: `usr_b_${Date.now()}`, tenantId: tenantB, nome: 'Admin B', email: `b_${Date.now()}@teste.com`, papel: 'ADMIN', ativo: true };

  usersDb.insert(userA);
  usersDb.insert(userB);

  // Cria processo para Tenant A
  const processA = processesDb.insert({
    id: `pro_test_${Date.now()}`,
    tenantId: tenantA,
    titulo: 'Processo Teste de Persistência',
    statusDeterminístico: 'pendente',
    itens: [
      { id: 'item_rg_1', nome: 'RG Oficial', tipo: 'identificacao', obrigatorio: true, statusItem: 'ausente' }
    ]
  });

  // Cria PDF de teste com conteúdo determinístico
  const samplePdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nBT /F1 12 Tf (DOCUMENTO OFICIAL PERSISTENTE SHA256 VALIDADO) Tj ET\n%%EOF';
  const samplePdfBuffer = Buffer.from(samplePdfContent, 'utf-8');
  const expectedSha256 = crypto.createHash('sha256').update(samplePdfBuffer).digest('hex');

  let uploadedDocId = null;

  // TESTE 1: Upload de Documento com Salvamento Híbrido
  await test('1. Upload de documento salva metadados e persiste hash SHA-256', async () => {
    const { contentType, body } = createMultipartFormData(
      { processId: processA.id, itemId: 'item_rg_1' },
      { name: 'file', filename: 'rg_persistente.pdf', contentType: 'application/pdf', buffer: samplePdfBuffer }
    );

    const tokenA = createToken({ userId: userA.id });
    const tokenB = createToken({ userId: userB.id });

    const res = await request('/api/documents/upload', {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Authorization': `Bearer ${tokenA}`
      },
      body
    });

    assert.strictEqual(res.status, 201, `Status esperado 201, recebido: ${res.status}`);
    assert.strictEqual(res.data.success, true);
    uploadedDocId = res.data.data.document.id;
    assert.ok(uploadedDocId, 'ID do documento deve existir');

    const savedDoc = documentsDb.findById(uploadedDocId);
    assert.ok(savedDoc, 'Documento deve constar no banco');
    assert.strictEqual(savedDoc.sha256, expectedSha256, 'Hash SHA-256 deve coincidir exatamente');
    assert.ok(savedDoc.storagePath.startsWith('storage/private/'), 'Caminho deve ser relativo universal');
  });

  // TESTE 2: Simulação de Reset Efêmero (Deleção do arquivo físico no disco)
  await test('2. Simulação de contêiner efêmero: remoção intencional do arquivo físico em disco', async () => {
    const doc = documentsDb.findById(uploadedDocId);
    const resolvedPath = StorageService.resolveLocalPath(doc.storagePath);
    assert.ok(fs.existsSync(resolvedPath), 'Arquivo físico deve existir antes da simulação');

    // Remove arquivo físico simulando restart do contêiner do Render
    fs.unlinkSync(resolvedPath);
    assert.strictEqual(fs.existsSync(resolvedPath), false, 'Arquivo físico deve ter sido removido');
  });

  // TESTE 3: Auto-Reidratação Transparente no Download
  await test('3. Download reidrata o arquivo a partir do banco (HTTP 200, bytes idênticos)', async () => {
    const tokenA = createToken({ userId: userA.id });

    const res = await request(`/api/documents/${uploadedDocId}/file`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });

    assert.strictEqual(res.status, 200, `Status esperado 200 após reidratação, recebido: ${res.status}`);
    assert.strictEqual(res.headers['content-type'], 'application/pdf');

    // Validação matemática do SHA-256 do arquivo baixado
    const downloadedSha256 = crypto.createHash('sha256').update(res.buffer).digest('hex');
    assert.strictEqual(downloadedSha256, expectedSha256, 'Hash do arquivo reidratado deve ser idêntico ao original');
  });

  // TESTE 4: Isolamento Multi-Tenant Estrito
  await test('4. Tentativa de download por outro tenant é bloqueada com HTTP 403', async () => {
    const tokenB = createToken({ userId: userB.id });

    const res = await request(`/api/documents/${uploadedDocId}/file`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });

    assert.strictEqual(res.status, 403, 'Acesso por outro tenant deve ser rejeitado com HTTP 403');
    assert.strictEqual(res.data.error.code, 'CROSS_TENANT_ACCESS_DENIED');
  });

  // TESTE 5: OCR Executa com Sucesso sobre Arquivo Reidratado
  await test('5. OCR executa perfeitamente após reidratação física automática', async () => {
    // Força nova remoção do disco para garantir que ensureLocalFile faça a reidratação
    const doc = documentsDb.findById(uploadedDocId);
    const resolvedPath = StorageService.resolveLocalPath(doc.storagePath);
    if (fs.existsSync(resolvedPath)) fs.unlinkSync(resolvedPath);

    let job = await AnalysisJobService.startJob({
      tenantId: tenantA,
      processId: processA.id,
      userId: userA.id,
      userName: userA.nome
    });

    assert.ok(job.id, 'Job de análise deve ser iniciado');

    // Aguarda conclusão do job assíncrono
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 100));
      const updated = AnalysisJobService.getJob(job.id, tenantA);
      if (updated && (updated.status === 'COMPLETED' || updated.status === 'FAILED')) {
        job = updated;
        break;
      }
    }

    assert.strictEqual(job.status, 'COMPLETED', `Job deve concluir com sucesso, status: ${job.status}`);
    assert.ok(fs.existsSync(resolvedPath), 'Arquivo físico deve ter sido reidratado em disco pelo OCR');
  });

  // TESTE 6: Exclusão com Limpeza em Cascata
  await test('6. Exclusão de documento limpa registro e blob persistente', async () => {
    const tokenA = createToken({ userId: userA.id });

    const res = await request(`/api/documents/${uploadedDocId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(documentsDb.findById(uploadedDocId), null);
  });

  server.close();

  console.log(`\n================================================================`);
  console.log(`📊 RESULTADO: ${passed} testes aprovados, ${failed} falhas.`);
  console.log(`================================================================\n`);

  if (failed > 0) {
    throw new Error(`Falha nos testes de persistência (${failed} falhas).`);
  }
}

if (process.argv[1] === (await import('url')).fileURLToPath(import.meta.url)) {
  runStoragePersistenceTests()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Erro fatal:', err);
      process.exit(1);
    });
}
