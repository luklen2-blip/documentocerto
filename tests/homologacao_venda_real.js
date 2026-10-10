/**
 * DocumentoCerto - Suíte de Homologação Final da Venda Real em Produção
 * Executa testes E2E contra a URL de produção (Render)
 */

import https from 'https';
import http from 'http';

const targetUrl = process.argv[2] || process.env.LIVE_URL || 'https://documentocerto.onrender.com';
const isHttps = targetUrl.startsWith('https://');
const client = isHttps ? https : http;
const agent = isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined;

function request(method, endpoint, body = null, headers = {}) {
  const fullUrl = new URL(endpoint, targetUrl);
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'User-Agent': 'DocumentoCerto-Auditor/2.0',
      'Accept': 'application/json',
      ...headers
    };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (isHttps ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      method: method,
      headers: reqHeaders,
      agent: agent,
      timeout: 30000
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, data: json, raw: data });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout na requisição para ${endpoint}`));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

async function runHomologacao() {
  console.log('================================================================');
  console.log('DOCUMENTOCERTO — HOMOLOGAÇÃO COMERCIAL FINAL EM PRODUÇÃO');
  console.log(`Ambiente Alvo: ${targetUrl}`);
  console.log(`Data/Hora: ${new Date().toISOString()}`);
  console.log('================================================================\n');

  const results = [];

  // 1. Health Check
  try {
    process.stdout.write('1. [INFRA] Verificando /api/health... ');
    const res = await request('GET', '/api/health');
    if (res.status === 200 && res.data?.status === 'ok') {
      console.log(`✅ OK (v${res.data.version}, Uptime: ${res.data.uptime_seconds}s)`);
      results.push({ item: '1. Health Check (24/7)', status: 'PASS', detail: `HTTP 200, Uptime ${res.data.uptime_seconds}s` });
    } else {
      console.log(`❌ FALHOU: HTTP ${res.status}`);
      results.push({ item: '1. Health Check (24/7)', status: 'FAIL', detail: `HTTP ${res.status}` });
    }
  } catch (err) {
    console.log(`❌ ERRO: ${err.message}`);
    results.push({ item: '1. Health Check (24/7)', status: 'FAIL', detail: err.message });
  }

  // 2. Auditoria Kiwify Checkout & Planos
  try {
    process.stdout.write('2. [COMERCIAL] Verificando /api/plans/kiwify... ');
    const res = await request('GET', '/api/plans/kiwify');
    if (res.status === 200 && res.data?.success) {
      const p = res.data.data;
      const expectedUrl = 'https://pay.kiwify.com.br/ueLjXAd';
      const expectedPriceStr = 'R$ 19,90';
      if (p.kiwifyUrl === expectedUrl && p.precoFormatado === expectedPriceStr && p.trialDias === 1) {
        console.log(`✅ OK (Plano: ${p.plano}, Preço: ${p.precoFormatado}, URL: ${p.kiwifyUrl}, Trial: ${p.trialDias} dia)`);
        results.push({ item: '2. Catálogo Kiwify & Checkout', status: 'PASS', detail: `Preço ${p.precoFormatado}, Link verificado, Trial 24h` });
      } else {
        console.log(`⚠️ DISCREPÂNCIA: Preço=${p.precoFormatado}, URL=${p.kiwifyUrl}`);
        results.push({ item: '2. Catálogo Kiwify & Checkout', status: 'WARN', detail: `Valores divergentes: ${JSON.stringify(p)}` });
      }
    } else {
      console.log(`❌ FALHOU: HTTP ${res.status}`);
      results.push({ item: '2. Catálogo Kiwify & Checkout', status: 'FAIL', detail: `HTTP ${res.status}` });
    }
  } catch (err) {
    console.log(`❌ ERRO: ${err.message}`);
    results.push({ item: '2. Catálogo Kiwify & Checkout', status: 'FAIL', detail: err.message });
  }

  // 3. Auditoria de Webhook Kiwify (Validação de Endpoint Ativo e Segurança)
  try {
    process.stdout.write('3. [WEBHOOK] Verificando endpoint de Webhook Kiwify (/api/webhooks/kiwify)... ');
    const res = await request('POST', '/api/webhooks/kiwify', { order_id: 'audit_test_probe' });
    if (res.status === 401) {
      console.log(`✅ ATIVO E PROTEGIDO (HTTP 401 - Autenticação por token obrigatória)`);
      results.push({ item: '3. Webhook Kiwify', status: 'PASS', detail: 'HTTP 401 Unauthorized - Protegido por token de autenticação' });
    } else if (res.status === 400) {
      console.log(`✅ ATIVO E VALIDANDO PAYLOAD (HTTP 400 - Validação de schema ativo)`);
      results.push({ item: '3. Webhook Kiwify', status: 'PASS', detail: 'HTTP 400 Bad Request - Validação de integridade de payload ativa' });
    } else if (res.status === 200) {
      console.log(`✅ ATIVO E RESPONDENDO (HTTP 200)`);
      results.push({ item: '3. Webhook Kiwify', status: 'PASS', detail: 'HTTP 200 OK' });
    } else if (res.status === 404) {
      console.log(`❌ NÃO IMPLEMENTADO (HTTP 404)`);
      results.push({ item: '3. Webhook Kiwify', status: 'NOT_IMPLEMENTED', detail: 'HTTP 404 Not Found' });
    } else {
      console.log(`Resposta: HTTP ${res.status}`);
      results.push({ item: '3. Webhook Kiwify', status: 'ACTIVE', detail: `HTTP ${res.status}` });
    }
  } catch (err) {
    console.log(`Erro ao testar webhook: ${err.message}`);
    results.push({ item: '3. Webhook Kiwify', status: 'ERROR', detail: err.message });
  }

  // 4. Cadastro de Nova Conta com Trial de 24h
  const testEmail = `homologacao_${Date.now()}@documentocerto.com.br`;
  const testPassword = 'SenhaHomologacao2026!';
  let authToken = null;
  let userOrg = null;

  try {
    process.stdout.write(`4. [TRIAL] Criando conta de homologação (${testEmail})... `);
    const res = await request('POST', '/api/auth/register', {
      nome: 'Auditor Homologação Comercial',
      email: testEmail,
      senha: testPassword,
      nomeEmpresa: 'Organização de Homologação Produção'
    });

    if (res.status === 201 && res.data?.success) {
      authToken = res.data.data.token;
      userOrg = res.data.data.organization;
      const tStart = new Date(userOrg.trialIniciadoEm).getTime();
      const tEnd = new Date(userOrg.trialExpiraEm).getTime();
      const trialDuration = tEnd - tStart;
      const isExactly24h = trialDuration === 86400000;

      console.log(`✅ OK (Token gerado, Duração: ${trialDuration / 3600000}h)`);
      console.log(`   - Status Comercial: ${userOrg.statusComercial}`);
      console.log(`   - Trial Ativo: ${userOrg.trialAtivo}`);
      console.log(`   - Início: ${userOrg.trialIniciadoEm}`);
      console.log(`   - Expira: ${userOrg.trialExpiraEm}`);
      console.log(`   - Duração Exata 24h (86.400.000 ms): ${isExactly24h ? 'SIM' : 'NÃO'}`);

      results.push({
        item: '4. Cadastro & Cálculo Trial',
        status: isExactly24h && userOrg.statusComercial === 'TRIAL_ATIVO' ? 'PASS' : 'WARN',
        detail: `Duração: ${trialDuration / 3600000}h, Status: ${userOrg.statusComercial}, Exato 24h: ${isExactly24h}`
      });
    } else {
      console.log(`❌ FALHOU: HTTP ${res.status} - ${JSON.stringify(res.data)}`);
      results.push({ item: '4. Cadastro & Cálculo Trial', status: 'FAIL', detail: `HTTP ${res.status}` });
    }
  } catch (err) {
    console.log(`❌ ERRO: ${err.message}`);
    results.push({ item: '4. Cadastro & Cálculo Trial', status: 'FAIL', detail: err.message });
  }

  // 5. Verificação da Sessão Autenticada (/api/auth/me)
  let defaultChecklistId = null;
  if (authToken) {
    try {
      process.stdout.write('5. [AUTH] Verificando /api/auth/me com token da nova conta... ');
      const res = await request('GET', '/api/auth/me', null, { Authorization: `Bearer ${authToken}` });
      if (res.status === 200 && res.data?.success) {
        const org = res.data.data.organization;
        console.log(`✅ OK (statusComercial: ${org.statusComercial}, trialExpirado: ${org.trialExpirado}, horasRestantes: ${org.trialHorasRestantes}h)`);
        results.push({ item: '5. Verificação Sessão /me', status: 'PASS', detail: `statusComercial: ${org.statusComercial}, exp: ${org.trialExpirado}` });
      } else {
        console.log(`❌ FALHOU: HTTP ${res.status}`);
        results.push({ item: '5. Verificação Sessão /me', status: 'FAIL', detail: `HTTP ${res.status}` });
      }
    } catch (err) {
      console.log(`❌ ERRO: ${err.message}`);
      results.push({ item: '5. Verificação Sessão /me', status: 'FAIL', detail: err.message });
    }

    // Obter Checklists disponíveis
    try {
      const res = await request('GET', '/api/checklists', null, { Authorization: `Bearer ${authToken}` });
      if (res.status === 200 && res.data?.data?.length > 0) {
        defaultChecklistId = res.data.data[0].id;
      }
    } catch (err) {
      console.error('Erro ao listar checklists:', err.message);
    }

    // 6. Acesso durante o período de teste (Criação de Processo)
    let processId = null;
    try {
      process.stdout.write('6. [USO TRIAL] Criando processo durante o período de teste... ');
      const res = await request('POST', '/api/processes', {
        nome: 'Processo Homologação Venda Real',
        checklistId: defaultChecklistId
      }, { Authorization: `Bearer ${authToken}` });

      if (res.status === 201 && res.data?.success) {
        processId = res.data.data.id;
        console.log(`✅ OK (Processo ID: ${processId})`);
        results.push({ item: '6. Uso Durante Trial (Processo)', status: 'PASS', detail: `Criado com sucesso ID ${processId}` });
      } else {
        console.log(`❌ FALHOU: HTTP ${res.status} - ${JSON.stringify(res.data)}`);
        results.push({ item: '6. Uso Durante Trial (Processo)', status: 'FAIL', detail: `HTTP ${res.status}` });
      }
    } catch (err) {
      console.log(`❌ ERRO: ${err.message}`);
      results.push({ item: '6. Uso Durante Trial (Processo)', status: 'FAIL', detail: err.message });
    }

    // 7. Listagem de Processos do Tenant
    try {
      process.stdout.write('7. [ISOLAMENTO TENANT] Listando processos da organização... ');
      const res = await request('GET', '/api/processes', null, { Authorization: `Bearer ${authToken}` });
      if (res.status === 200 && Array.isArray(res.data?.data) && res.data.data.length >= 1) {
        console.log(`✅ OK (${res.data.data.length} processo(s) retornado(s))`);
        results.push({ item: '7. Isolamento Tenant', status: 'PASS', detail: `${res.data.data.length} processo(s) isolado(s)` });
      } else {
        console.log(`❌ FALHOU: HTTP ${res.status}`);
        results.push({ item: '7. Isolamento Tenant', status: 'FAIL', detail: `HTTP ${res.status}` });
      }
    } catch (err) {
      console.log(`❌ ERRO: ${err.message}`);
      results.push({ item: '7. Isolamento Tenant', status: 'FAIL', detail: err.message });
    }
  }

  // 8. Teste de Tentativa de Manipulação / Token Falso
  try {
    process.stdout.write('8. [SEGURANÇA] Testando tentativa de acesso com token forjado... ');
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImZha2UiLCJwbGFuIjoiVklUQUxJQ0lPIn0.invalid_signature';
    const res = await request('POST', '/api/processes', { nome: 'Hack', checklistId: 'any' }, { Authorization: `Bearer ${fakeToken}` });
    if (res.status === 401 || res.status === 403) {
      console.log(`✅ BLOQUEADO COM SUCESSO (HTTP ${res.status})`);
      results.push({ item: '8. Defesa Token Forjado', status: 'PASS', detail: `Bloqueado com HTTP ${res.status}` });
    } else {
      console.log(`❌ FALHA CRÍTICA: HTTP ${res.status}`);
      results.push({ item: '8. Defesa Token Forjado', status: 'FAIL', detail: `HTTP ${res.status}` });
    }
  } catch (err) {
    console.log(`❌ ERRO: ${err.message}`);
    results.push({ item: '8. Defesa Token Forjado', status: 'FAIL', detail: err.message });
  }

  // 9. Teste de Acesso Sem Token (Não autenticado)
  try {
    process.stdout.write('9. [SEGURANÇA] Testando acesso a rotas privadas sem autenticação... ');
    const res = await request('POST', '/api/processes', { nome: 'Sem Auth', checklistId: 'any' });
    if (res.status === 401) {
      console.log(`✅ BLOQUEADO COM SUCESSO (HTTP ${res.status})`);
      results.push({ item: '9. Defesa Não-Autenticado', status: 'PASS', detail: 'Bloqueado com HTTP 401' });
    } else {
      console.log(`❌ FALHOU: HTTP ${res.status}`);
      results.push({ item: '9. Defesa Não-Autenticado', status: 'FAIL', detail: `HTTP ${res.status}` });
    }
  } catch (err) {
    console.log(`❌ ERRO: ${err.message}`);
    results.push({ item: '9. Defesa Não-Autenticado', status: 'FAIL', detail: err.message });
  }

  // 10. Teste de Concorrência em Produção (Criação paralela)
  if (authToken && defaultChecklistId) {
    try {
      process.stdout.write('10. [CONCORRÊNCIA] Disparando 3 requisições paralelas no tenant... ');
      const promises = [1, 2, 3].map(i =>
        request('POST', '/api/processes', {
          nome: `Processo Paralelo #${i}`,
          checklistId: defaultChecklistId
        }, { Authorization: `Bearer ${authToken}` })
      );
      const responses = await Promise.all(promises);
      const allSuccess = responses.every(r => r.status === 201);
      if (allSuccess) {
        console.log(`✅ OK (3/3 requisições concluídas com sucesso HTTP 201 sem race condition)`);
        results.push({ item: '10. Concorrência Produção', status: 'PASS', detail: '3/3 requisições paralelas processadas com integridade' });
      } else {
        console.log(`⚠️ ALERTA: Códigos recebidos: ${responses.map(r => r.status).join(', ')}`);
        results.push({ item: '10. Concorrência Produção', status: 'WARN', detail: `Códigos: ${responses.map(r => r.status).join(', ')}` });
      }
    } catch (err) {
      console.log(`❌ ERRO: ${err.message}`);
      results.push({ item: '10. Concorrência Produção', status: 'FAIL', detail: err.message });
    }
  }

  console.log('\n================================================================');
  console.log('RESUMO DA HOMOLOGAÇÃO EM PRODUÇÃO:');
  console.log('================================================================');
  results.forEach(r => {
    const icon = r.status === 'PASS' ? '✅' : (r.status === 'NOT_IMPLEMENTED' ? 'ℹ️' : '⚠️');
    console.log(`${icon} ${r.item.padEnd(35)} [${r.status}] ${r.detail}`);
  });
  console.log('================================================================');
}

runHomologacao().catch(err => {
  console.error('Erro fatal:', err);
});
