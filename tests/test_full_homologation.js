/**
 * DocumentoCerto — Suíte de Homologação Comercial e Integridade de 360°
 * Cobre:
 * 1. Isolamento Multi-Tenant Estrito (Testes Negativos Cross-Tenant)
 * 2. Motor de OCR e Validações Matemáticas (CPF/CNPJ Módulo 11)
 * 3. Controle de Trial de 24h e Bloqueio de Expiração no Backend
 * 4. Webhook Kiwify (Autenticação, Idempotência, Ativação Vitalícia e Reembolso)
 * 5. Integridade do Banco e Monitoramento de Saúde 24/7
 */

import assert from 'assert';
import http from 'http';
import app from '../server.js';
import {
  organizationsDb,
  usersDb,
  checklistsDb,
  processesDb,
  documentsDb,
  auditDb,
  kiwifyTransactionsDb,
  kiwifyWebhookEventsDb
} from '../backend/database/index.js';
import { MathValidatorService } from '../backend/services/math_validator_service.js';
import { NormalizerService } from '../backend/services/normalizer_service.js';

process.env.NODE_ENV = 'test';
process.env.KIWIFY_WEBHOOK_TOKEN = 'token_homologacao_mestre_2026';

let server;
let baseUrl = '';

function request(path, options = {}) {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers };
    let bodyData = options.body;
    if (bodyData && typeof bodyData === 'object' && !Buffer.isBuffer(bodyData)) {
      bodyData = JSON.stringify(bodyData);
      headers['Content-Type'] = 'application/json';
    }

    const req = http.request(url, {
      method: options.method || 'GET',
      headers
    }, (res) => {
      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
          raw
        });
      });
    });

    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

export async function runFullHomologation() {
  console.log('================================================================');
  console.log('🏛️ SUÍTE DE HOMOLOGAÇÃO COMERCIAL INTEGRADA: DOCUMENTOCERTO');
  console.log('================================================================\n');

  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`🌐 Servidor de testes ativo em: ${baseUrl}\n`);

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

  // -------------------------------------------------------------
  // GRUPO 1: MONITORAMENTO E BANCO
  // -------------------------------------------------------------
  await test('1. Health check /api/health responde HTTP 200 com status estruturado', async () => {
    const res = await request('/api/health');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.status === 'ok' || res.data.status === 'degraded');
    assert.strictEqual(res.data.app, 'DocumentoCerto');
    assert.ok(typeof res.data.uptime_seconds === 'number');
    assert.ok(res.data.database);
  });

  // -------------------------------------------------------------
  // GRUPO 2: AUTENTICAÇÃO E MULTI-TENANCY NEGATIVO
  // -------------------------------------------------------------
  const tenantAData = {
    nome: 'Admin Escritório Alfa',
    email: `alfa_admin_${Date.now()}@alfa.com.br`,
    senha: 'SenhaSeguraAlfa123!',
    nomeEmpresa: 'Alfa Advocacia e Contabilidade'
  };

  const tenantBData = {
    nome: 'Admin Imobiliária Beta',
    email: `beta_admin_${Date.now()}@beta.com.br`,
    senha: 'SenhaSeguraBeta123!',
    nomeEmpresa: 'Beta Imóveis e Locações'
  };

  let tokenA = '';
  let tokenB = '';
  let tenantAId = '';
  let tenantBId = '';
  let processAId = '';

  await test('2. Criação do Tenant A com trial de 24h', async () => {
    const res = await request('/api/auth/register', { method: 'POST', body: tenantAData });
    assert.strictEqual(res.status, 201);
    tokenA = res.data.data.token;
    tenantAId = res.data.data.organization.id;
    assert.strictEqual(res.data.data.organization.plano, 'GRATIS');
    assert.strictEqual(res.data.data.organization.trialAtivo, true);
    assert.strictEqual(res.data.data.organization.trialDias, 1);
  });

  await test('3. Criação do Tenant B com trial de 24h', async () => {
    const res = await request('/api/auth/register', { method: 'POST', body: tenantBData });
    assert.strictEqual(res.status, 201);
    tokenB = res.data.data.token;
    tenantBId = res.data.data.organization.id;
    assert.notStrictEqual(tenantAId, tenantBId);
  });

  await test('4. Tenant A cria processo de admissão funcional', async () => {
    const res = await request('/api/processes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        nome: 'Processo Admissional - Carlos Silva',
        tipo: 'Admissão',
        checklistId: 'chk_admissao_default'
      }
    });
    assert.strictEqual(res.status, 201);
    processAId = res.data.data.id;
    assert.strictEqual(res.data.data.tenantId, tenantAId);
  });

  await test('5. [TESTE NEGATIVO MULTI-TENANT] Tenant B é BLOQUEADO ao tentar ler processo do Tenant A', async () => {
    const res = await request(`/api/processes/${processAId}`, {
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    // Deve retornar 403 Forbidden ou 404 Not Found
    assert.ok(res.status === 403 || res.status === 404);
  });

  await test('6. [TESTE NEGATIVO MULTI-TENANT] Tenant B é BLOQUEADO ao tentar atualizar processo do Tenant A', async () => {
    const res = await request(`/api/processes/${processAId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: { nome: 'Tentativa de Hack' }
    });
    assert.ok(res.status === 403 || res.status === 404);
  });

  // -------------------------------------------------------------
  // GRUPO 3: OCR E VALIDAÇÕES MATEMÁTICAS
  // -------------------------------------------------------------
  await test('7. Validação matemática de CPF real (Módulo 11)', async () => {
    // CPFs válidos conhecidos (algoritmo Módulo 11)
    assert.strictEqual(MathValidatorService.validateCpf('52998224725').isValid, true);
    // CPFs inválidos ou falsificados
    assert.strictEqual(MathValidatorService.validateCpf('11111111111').isValid, false);
    assert.strictEqual(MathValidatorService.validateCpf('12345678900').isValid, false);
  });

  await test('8. Validação matemática de CNPJ real (Módulo 11)', async () => {
    // CNPJ válido real
    assert.strictEqual(MathValidatorService.validateCnpj('11222333000181').isValid, true);
    // CNPJ com dígito verificador incorreto
    assert.strictEqual(MathValidatorService.validateCnpj('11222333000199').isValid, false);
    // CNPJ com todos os dígitos repetidos
    assert.strictEqual(MathValidatorService.validateCnpj('00000000000000').isValid, false);
  });

  await test('9. Normalização de campos documentais (CPF, CNPJ, nomes e datas)', async () => {
    assert.strictEqual(NormalizerService.normalizeCpf(' 529.982.247-25 '), '52998224725');
    assert.strictEqual(NormalizerService.normalizeCnpj(' 11.222.333/0001-81 '), '11222333000181');
    assert.strictEqual(NormalizerService.formatCpf('52998224725'), '529.982.247-25');
    assert.strictEqual(NormalizerService.formatCnpj('11222333000181'), '11.222.333/0001-81');
    assert.strictEqual(NormalizerService.normalizeName('  carlos  eduardo  da silva '), 'CARLOS EDUARDO DA SILVA');
  });

  // -------------------------------------------------------------
  // GRUPO 4: BLOQUEIO DE TRIAL EXPIRADO NO BACKEND
  // -------------------------------------------------------------
  await test('10. Bloqueio estrito de API para conta com trial expirado', async () => {
    // Cria conta com trial expirado propositalmente
    const expiredOrg = organizationsDb.insert({
      nome: 'Empresa com Trial Vencido Ltda',
      plano: 'GRATIS',
      ativo: true,
      trialAtivo: true,
      trialDias: 1,
      trialIniciadoEm: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
      trialExpiraEm: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      limiteProcessosMes: 20,
      processosCriadosMes: 0
    });

    const expiredUser = usersDb.insert({
      tenantId: expiredOrg.id,
      nome: 'Usuario Vencido',
      email: `vencido_${Date.now()}@teste.com`,
      senhaHash: 'fakehash',
      papel: 'ADMIN',
      ativo: true
    });

    // Gera token para este usuário
    const loginRes = await request('/api/auth/register', {
      method: 'POST',
      body: {
        nome: 'Usuario Expira Teste',
        email: `expira_reg_${Date.now()}@teste.com`,
        senha: 'SenhaValida123!',
        nomeEmpresa: 'Empresa Expira'
      }
    });

    const expToken = loginRes.data.data.token;
    const expOrgId = loginRes.data.data.organization.id;

    // Força expiração no banco
    organizationsDb.update(expOrgId, {
      trialExpiraEm: new Date(Date.now() - 3600 * 1000).toISOString()
    });

    // Tenta criar processo com trial vencido
    const blockedRes = await request('/api/processes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${expToken}` },
      body: { nome: 'Tentativa Bloqueada', checklistId: 'chk_admissao_default' }
    });

    assert.strictEqual(blockedRes.status, 403);
    assert.strictEqual(blockedRes.data.error.code, 'TRIAL_EXPIRED');
  });

  // -------------------------------------------------------------
  // GRUPO 5: WEBHOOK KIWIFY E ATIVAÇÃO VITALÍCIA
  // -------------------------------------------------------------
  await test('11. Webhook Kiwify: Rejeição de requisição sem token com HTTP 401', async () => {
    const res = await request('/api/webhooks/kiwify', {
      method: 'POST',
      body: { order_id: 'fake_123', order_status: 'paid' }
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.error.code, 'UNAUTHORIZED_WEBHOOK');
  });

  const buyerEmail = `comprador_vitalicio_${Date.now()}@homologacao.com.br`;
  let buyerToken = '';
  let buyerOrgId = '';

  await test('12. Cadastro de conta consumidora para ativação vitalícia', async () => {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: {
        nome: 'Comprador Vitalício Kiwify',
        email: buyerEmail,
        senha: 'SenhaVitalicia123!',
        nomeEmpresa: 'Comprador Vitalício Ltda'
      }
    });
    assert.strictEqual(res.status, 201);
    buyerToken = res.data.data.token;
    buyerOrgId = res.data.data.organization.id;
    assert.strictEqual(res.data.data.organization.plano, 'GRATIS');
  });

  const orderId = `kw_homolog_${Date.now()}`;

  await test('13. Pagamento aprovado da Kiwify ativa plano VITALÍCIO automaticamente', async () => {
    const res = await request('/api/webhooks/kiwify?token=token_homologacao_mestre_2026', {
      method: 'POST',
      body: {
        order_id: orderId,
        order_status: 'paid',
        Customer: {
          email: buyerEmail,
          full_name: 'Comprador Vitalício Kiwify'
        },
        Subscription: null,
        Commissions: { charge_amount: 1990 }
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.plano, 'VITALICIO');

    // Confirma atualização na organização
    const updatedOrg = organizationsDb.findById(buyerOrgId);
    assert.strictEqual(updatedOrg.plano, 'VITALICIO');
    assert.strictEqual(updatedOrg.trialExpiraEm, null);
  });

  await test('14. Idempotência: Reenvio do mesmo order_id retorna 200 OK sem duplicar ativação', async () => {
    const res = await request('/api/webhooks/kiwify?token=token_homologacao_mestre_2026', {
      method: 'POST',
      body: {
        order_id: orderId,
        order_status: 'paid',
        Customer: { email: buyerEmail }
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.idempotente, true);
  });

  await test('15. Reembolso da Kiwify atualiza transação para REFUNDED com auditoria', async () => {
    const res = await request('/api/webhooks/kiwify?token=token_homologacao_mestre_2026', {
      method: 'POST',
      body: {
        order_id: orderId,
        order_status: 'refunded',
        Customer: { email: buyerEmail }
      }
    });

    assert.strictEqual(res.status, 200);
    const tx = kiwifyTransactionsDb.findOne(t => t.orderId === orderId);
    assert.ok(tx);
    assert.strictEqual(tx.status, 'REFUNDED');
  });

  await test('16. Resgate seguro de compra comprovada Kiwify para e-mail divergente', async () => {
    const unknownEmail = `desconhecido_${Date.now()}@kiwify.com`;
    const unknownOrderId = `kw_unknown_${Date.now()}`;

    // Webhook chega para comprador que ainda não tem conta no SaaS
    const webhookRes = await request('/api/webhooks/kiwify?token=token_homologacao_mestre_2026', {
      method: 'POST',
      body: {
        order_id: unknownOrderId,
        order_status: 'paid',
        Customer: { email: unknownEmail, full_name: 'Cliente Não Cadastrado' },
        Commissions: { charge_amount: 1990 }
      }
    });

    assert.strictEqual(webhookRes.status, 200);
    assert.strictEqual(webhookRes.data.data.status, 'PAID_PENDING_CLAIM');
    assert.ok(webhookRes.data.data.claim_token);
    const claimToken = webhookRes.data.data.claim_token;

    // Novo usuário se cadastra com outro e-mail e resgata a compra
    const regRes = await request('/api/auth/register', {
      method: 'POST',
      body: {
        nome: 'Usuario do Resgate',
        email: `outro_email_${Date.now()}@saas.com.br`,
        senha: 'SenhaResgate123!',
        nomeEmpresa: 'Minha Empresa Nova'
      }
    });

    const userToken = regRes.data.data.token;
    const userOrgId = regRes.data.data.organization.id;

    // Executa resgate via token
    const claimRes = await request('/api/plans/claim-purchase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { claimToken }
    });

    assert.strictEqual(claimRes.status, 200);
    assert.strictEqual(claimRes.data.data.plano, 'VITALICIO');

    // Confirma que a organização foi promovida a Vitalício
    const org = organizationsDb.findById(userOrgId);
    assert.strictEqual(org.plano, 'VITALICIO');
  });

  // -------------------------------------------------------------
  // GRUPO 6: PÁGINAS LEGAIS E CONFORMIDADE
  // -------------------------------------------------------------
  await test('17. Conformidade legal: Rotas /termos e /privacidade operacionais', async () => {
    const termos = await request('/termos');
    assert.strictEqual(termos.status, 200);
    assert.ok(termos.raw.includes('Termos de Uso'));

    const priv = await request('/privacidade');
    assert.strictEqual(priv.status, 200);
    assert.ok(priv.raw.includes('Privacidade'));
  });

  server.close();

  console.log('\n================================================================');
  console.log('📊 RESULTADO DA SUÍTE DE HOMOLOGAÇÃO COMERCIAL:');
  console.log(`   Total Executados: ${passed + failed}`);
  console.log(`   ✅ Aprovados:     ${passed}`);
  console.log(`   ❌ Reprovados:    ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`Falha em ${failed} testes de homologação.`);
  }

  return { passed, failed, total: passed + failed };
}

import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFullHomologation()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
