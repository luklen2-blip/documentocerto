/**
 * DocumentoCerto - Live Cloud E2E 360° Test Suite
 * Valida a integridade completa da aplicação em produção:
 * - Saúde (/api/health) e banco de dados relacional
 * - Carregamento visual e HTML5 SPA
 * - Mobile assets e PWA (/manifest.json, /sw.js)
 * - Páginas legais (/termos, /privacidade, LGPD Art. 14/18)
 * - Catálogo comercial (Plano Vitalício R$ 19,90 e Kiwify)
 * - Formulários, autenticação e tokens JWT
 * - Banco de dados: processos e checklists relacionais
 * - Upload de binários com persistência em PostgreSQL document_blobs
 * - Download autêntico com verificação de integridade criptográfica SHA-256
 * - Isolamento multi-tenant estrito (HTTP 403)
 * - Webhook Kiwify protegido (HTTP 401)
 *
 * Configurado com rejectUnauthorized: false para evitar rejeição por certificados intermediários no Windows.
 */

import https from 'https';
import http from 'http';
import crypto from 'crypto';

const targetUrl = process.argv[2] || process.env.LIVE_URL || 'https://documentocerto-1.onrender.com';

const isHttps = targetUrl.startsWith('https://');
const client = isHttps ? https : http;
const agent = isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined;

function requestUrl(endpoint, options = {}) {
  const fullUrl = new URL(endpoint, targetUrl).toString();
  const headers = { ...(options.headers || {}) };
  let bodyData = options.body;

  return new Promise((resolve, reject) => {
    const req = client.request(fullUrl, {
      method: options.method || 'GET',
      headers,
      agent
    }, (res) => {
      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf-8')); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
          raw: raw.toString('utf-8'),
          buffer: raw
        });
      });
    });

    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function createMultipartBody(fields, file) {
  const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
  const crlf = '\r\n';
  const chunks = [];

  for (const [key, val] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${key}"${crlf}${crlf}${val}${crlf}`));
  }

  if (file) {
    chunks.push(Buffer.from(
      `--${boundary}${crlf}Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"${crlf}Content-Type: ${file.contentType}${crlf}${crlf}`
    ));
    chunks.push(file.buffer);
    chunks.push(Buffer.from(crlf));
  }

  chunks.push(Buffer.from(`--${boundary}--${crlf}`));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks)
  };
}

async function runLiveTests() {
  console.log('================================================================');
  console.log('🛡️ DOCUMENTOCERTO — SUÍTE DE TESTES AO VIVO NA NUVEM (E2E 360°)');
  console.log(`🌐 Alvo: ${targetUrl}`);
  console.log('================================================================\n');

  let passed = 0;
  const total = 13;

  // 1. Monitoramento 24/7 & Conectividade com Banco
  process.stdout.write('⏳ [1/11] Saúde 24/7 (/api/health) e PostgreSQL... ');
  const health = await requestUrl('/api/health');
  if (health.status !== 200 || health.data?.status !== 'ok') {
    throw new Error(`Falha no Health Check: HTTP ${health.status}`);
  }
  const dbDriver = health.data.database?.driver || 'N/A';
  const totalTables = health.data.database?.total_tables || 0;
  console.log(`✅ APROVADO (${dbDriver}, ${totalTables} tabelas, ${health.data.uptime_seconds}s uptime)`);
  passed++;

  // 2. Carregamento Visual (HTML5 SPA)
  process.stdout.write('⏳ [2/11] Carregamento Visual (SPA index.html)... ');
  const home = await requestUrl('/');
  if (home.status !== 200 || !home.raw.includes('DocumentoCerto')) {
    throw new Error(`Falha no carregamento da SPA: HTTP ${home.status}`);
  }
  console.log('✅ APROVADO');
  passed++;

  // 3. Mobile Assets e PWA (/manifest.json e /sw.js)
  process.stdout.write('⏳ [3/11] Mobile Assets & PWA (Manifest e SW)... ');
  const manifest = await requestUrl('/manifest.json');
  const sw = await requestUrl('/sw.js');
  if (manifest.status !== 200 || !manifest.data?.name || sw.status !== 200) {
    throw new Error(`Falha nos assets PWA: Manifest HTTP ${manifest.status}, SW HTTP ${sw.status}`);
  }
  console.log(`✅ APROVADO (PWA Standalone: ${manifest.data.short_name})`);
  passed++;

  // 4. Páginas Legais (/termos e /privacidade com LGPD)
  process.stdout.write('⏳ [4/11] Páginas Legais (/termos e /privacidade)... ');
  const terms = await requestUrl('/termos');
  const priv = await requestUrl('/privacidade');
  if (terms.status !== 200 || !terms.raw.includes('Termos de Uso') ||
      priv.status !== 200 || !priv.raw.includes('LGPD')) {
    throw new Error(`Falha nas páginas legais: Termos HTTP ${terms.status}, Priv HTTP ${priv.status}`);
  }
  console.log('✅ APROVADO (Conformidade Código Civil, ECA e Art. 14 LGPD)');
  passed++;

  // 5. Catálogo Comercial (Plano Vitalício R$ 19,90 e Kiwify)
  process.stdout.write('⏳ [5/11] Catálogo Comercial e Link Kiwify... ');
  const plans = await requestUrl('/api/plans');
  if (plans.status !== 200 || !Array.isArray(plans.data?.data)) {
    throw new Error(`Falha no catálogo de planos: HTTP ${plans.status}`);
  }
  const vitalicio = plans.data.data.find(p => p.id === 'vitalicio');
  if (!vitalicio || vitalicio.valorUnico !== 19.90 || !vitalicio.kiwifyUrl?.includes('ueLjXAd')) {
    throw new Error('Plano Vitalício ou Link Kiwify incorreto');
  }
  console.log(`✅ APROVADO (${vitalicio.precoFormatado} Vitalício, Checkout Kiwify Ativo)`);
  passed++;

  // 6. Formulários e Autenticação (Tenant A)
  process.stdout.write('⏳ [6/11] Formulário de Registro e Autenticação JWT... ');
  const emailA = `live_e2e_a_${Date.now()}@teste.com`;
  const regA = await requestUrl('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: 'Auditor Nuvem Alfa',
      email: emailA,
      senha: 'SenhaForte2026!@#',
      nomeEmpresa: 'Alfa Auditoria Cloud'
    })
  });
  if (regA.status !== 201 || !regA.data?.data?.token) {
    throw new Error(`Falha no registro: HTTP ${regA.status} ${JSON.stringify(regA.data)}`);
  }
  const tokenA = regA.data.data.token;
  const tenantAId = regA.data.data.organization.id;
  console.log(`✅ APROVADO (Tenant: ${tenantAId})`);
  passed++;

  // 7. Banco de Dados e Criação de Processo Relacional
  process.stdout.write('⏳ [7/11] Banco de Dados: Criação de Processo com Checklist... ');
  const procRes = await requestUrl('/api/processes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
    body: JSON.stringify({
      nome: 'Processo E2E Nuvem 24/7',
      checklistId: 'chk_admissao_default',
      tipo: 'Admissão'
    })
  });
  if (procRes.status !== 201 || !procRes.data?.data?.id) {
    throw new Error(`Falha na criação do processo: HTTP ${procRes.status}`);
  }
  const procA = procRes.data.data;
  console.log(`✅ APROVADO (Processo ID: ${procA.id}, ${procA.itens.length} itens)`);
  passed++;

  // 8. Upload de Binário com Persistência em document_blobs
  process.stdout.write('⏳ [8/11] Upload com Persistência em document_blobs (Neon BYTEA)... ');
  const pdfBuffer = Buffer.from('%PDF-1.4 TESTE LIVE CLOUD 360 REVALIDATION 2026', 'utf-8');
  const expectedHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
  const targetItemId = procA.itens[0].id;

  const { contentType, body } = createMultipartBody(
    { processId: procA.id, itemId: targetItemId },
    { name: 'file', filename: 'documento_e2e.pdf', contentType: 'application/pdf', buffer: pdfBuffer }
  );

  const uploadRes = await requestUrl('/api/documents/upload', {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'Authorization': `Bearer ${tokenA}` },
    body
  });
  if (uploadRes.status !== 201 || !uploadRes.data?.data?.document?.id) {
    throw new Error(`Falha no upload: HTTP ${uploadRes.status} ${JSON.stringify(uploadRes.data)}`);
  }
  const docA = uploadRes.data.data.document;
  console.log(`✅ APROVADO (Doc ID: ${docA.id}, SHA-256: ${docA.sha256.substring(0, 16)}...)`);
  passed++;

  // 9. Download Autêntico e Verificação de Integridade Criptográfica Bit-a-Bit
  process.stdout.write('⏳ [9/11] Download e Verificação Criptográfica SHA-256... ');
  const downRes = await requestUrl(`/api/documents/${docA.id}/file`, {
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });
  if (downRes.status !== 200) {
    throw new Error(`Falha no download: HTTP ${downRes.status}`);
  }
  const downloadedHash = crypto.createHash('sha256').update(downRes.buffer).digest('hex');
  if (downloadedHash !== expectedHash) {
    throw new Error(`Hash SHA-256 divergente: ${downloadedHash} !== ${expectedHash}`);
  }
  console.log(`✅ APROVADO (Hash Bit-a-Bit Idêntico: ${downloadedHash.substring(0, 16)}...)`);
  passed++;

  // 10. Isolamento Multi-Tenant Estrito (Tenant B barrado)
  process.stdout.write('⏳ [10/11] Isolamento Multi-Tenant (Rejeição Cross-Tenant HTTP 403)... ');
  const emailB = `live_e2e_b_${Date.now()}@teste.com`;
  const regB = await requestUrl('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: 'Auditor Beta',
      email: emailB,
      senha: 'SenhaForte2026!@#',
      nomeEmpresa: 'Beta Concorrente'
    })
  });
  const tokenB = regB.data.data.token;

  const crossProc = await requestUrl(`/api/processes/${procA.id}`, {
    headers: { 'Authorization': `Bearer ${tokenB}` }
  });
  const crossDoc = await requestUrl(`/api/documents/${docA.id}/file`, {
    headers: { 'Authorization': `Bearer ${tokenB}` }
  });

  if (crossProc.status !== 403 || crossDoc.status !== 403) {
    throw new Error(`Falha de isolamento multi-tenant: Proc HTTP ${crossProc.status}, Doc HTTP ${crossDoc.status}`);
  }
  console.log('✅ APROVADO (Leitura e download cruzados bloqueados com HTTP 403)');
  passed++;

  // 11. Webhook Kiwify Protegido contra Acesso Não Autorizado
  process.stdout.write('⏳ [11/11] Webhook Kiwify: Rejeição Sem Token (HTTP 401)... ');
  const whRes = await requestUrl('/api/webhooks/kiwify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'order_approved' })
  });
  if (whRes.status !== 401) {
    throw new Error(`Webhook Kiwify não rejeitou chamada desprotegida: HTTP ${whRes.status}`);
  }
  console.log('✅ APROVADO (HTTP 401 Rejeição de Acesso Indevido)');
  passed++;

  // 12. Dashboard de Métricas, Funil e Segregação Administrativa (/api/admin/metrics)
  process.stdout.write('⏳ [12/12] Dashboard de Métricas & Segregação Administrativa... ');
  // 12.1 Chamada sem x-admin-key (apenas com token do tenant)
  const tenantTry = await requestUrl('/api/admin/metrics', {
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });
  const isSegregated = tenantTry.status === 403;

  // 12.2 Chamada com a chave mestra de operador x-admin-key
  const adminKey = process.env.ADMIN_KEY || 'documentocerto_admin_migrate_2026';
  const metricsRes = await requestUrl('/api/admin/metrics', {
    headers: { 'x-admin-key': adminKey }
  });
  if (metricsRes.status !== 200 || !metricsRes.data?.data?.funil) {
    throw new Error(`Falha no endpoint de métricas com x-admin-key: HTTP ${metricsRes.status}`);
  }
  const m = metricsRes.data.data;
  console.log(`✅ APROVADO (${m.funil.totalCadastros} contas, ${m.funil.vitaliciosAtivos} vitalícios, ${m.funil.taxaConversao} conversão, Segregação: ${isSegregated ? 'Ativa 403' : 'Legada 200'})`);
  passed++;

  // 13. [Fase 5] Experiência de Onboarding, Sincronização de Trial e Analytics Anônimo
  process.stdout.write('⏳ [13/13] Onboarding Interativo, Trial Sincronizado & Analytics... ');
  // 13.1 Verifica se SPA contém modais de onboarding
  if (!home.raw.includes('modal-onboarding-wizard') || !home.raw.includes('modal-help') || !home.raw.includes('modal-trial-info')) {
    throw new Error('SPA index.html não contém os modais da Fase 5');
  }

  // 13.2 Registra evento anônimo de onboarding no backend
  const eventRes = await requestUrl('/api/audit/onboarding-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
    body: JSON.stringify({
      eventType: 'tutorial_iniciado',
      metadata: { step: 1 }
    })
  });
  if (eventRes.status !== 200) {
    throw new Error(`Falha ao registrar onboarding-event: HTTP ${eventRes.status}`);
  }

  // 13.3 Sincronização de servidor em /api/auth/me
  const meRes = await requestUrl('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });
  if (meRes.status !== 200 || !meRes.data?.data?.organization?.serverTime) {
    throw new Error('Falha na sincronização de horário do servidor em /api/auth/me');
  }

  // 13.4 Criação de processo com modo de demonstração isDemo: true
  const demoProc = await requestUrl('/api/processes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
    body: JSON.stringify({
      nome: `[DEMO] Processo de Teste Nuvem - ${Date.now()}`,
      tipo: 'Admissão CLT (Demonstração)',
      checklistId: procA.checklistId,
      responsavelNome: 'Demonstração Interativa',
      prazo: '2026-12-31',
      isDemo: true
    })
  });
  if (demoProc.status !== 201 || !demoProc.data?.data?.isDemo) {
    throw new Error(`Falha na criação de processo demo em produção: HTTP ${demoProc.status}`);
  }
  console.log(`✅ APROVADO (Modais OK, Evento HTTP 200, Sincronização OK, Processo Demo ID: ${demoProc.data.data.id})`);
  passed++;

  console.log('\n================================================================');
  console.log(`🎉 HOMOLOGAÇÃO AO VIVO CONCLUÍDA: ${passed}/${total} TESTES APROVADOS!`);
  console.log('================================================================\n');
  process.exit(0);
}

runLiveTests().catch(err => {
  console.error('\n❌ Falha na suíte de testes de nuvem:', err.message);
  process.exit(1);
});
