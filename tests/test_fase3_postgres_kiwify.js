/**
 * DocumentoCerto - Suíte de Testes da Fase 3
 * PostgreSQL, Migrações, Webhook Kiwify, Idempotência e Ativação Automática
 */

import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import app from '../server.js';
import {
  organizationsDb,
  usersDb,
  auditDb,
  kiwifyTransactionsDb,
  kiwifyWebhookEventsDb,
  checkConnection,
  isPostgresConfigured
} from '../backend/database/index.js';

console.log('================================================================');
console.log('🧪 TESTES AUTOMATIZADOS FASE 3: POSTGRESQL & KIWIFY WEBHOOK');
console.log('================================================================\n');

process.env.NODE_ENV = 'test';
process.env.KIWIFY_WEBHOOK_TOKEN = 'token_secreto_teste_kiwify_2026';

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

async function runFase3Tests() {
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`🌐 Servidor de testes da Fase 3 ativo em: ${baseUrl}\n`);

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

  // 1. Health check e status de conectividade do banco
  await test('1. Health check /api/health retorna status e informações de banco', async () => {
    const res = await request('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'ok');
    assert.ok(res.data.database);
    assert.ok(res.data.database.driver);
  });

  // 2. Criação de nova conta em Trial de 24h para teste de pagamento
  const testEmail = `comprador_kiwify_${Date.now()}@documentocerto.com.br`;
  let userToken = null;
  let userOrgId = null;

  await test('2. Cadastro de nova conta recebe trial ativo de 24 horas', async () => {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: {
        nome: 'Comprador Oficial Kiwify',
        email: testEmail,
        senha: 'SenhaFase3Segura123!',
        nomeEmpresa: 'Empresa Teste Webhook Ltda'
      }
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.data.token);
    userToken = res.data.data.token;
    userOrgId = res.data.data.organization.id;

    assert.strictEqual(res.data.data.organization.plano, 'GRATIS');
    assert.strictEqual(res.data.data.organization.trialAtivo, true);
    assert.strictEqual(res.data.data.organization.statusComercial, 'TRIAL_ATIVO');
  });

  // 3. Webhook Kiwify: Rejeição de notificação sem autenticação
  await test('3. Webhook Kiwify rejeita com HTTP 401 requisições sem token válido', async () => {
    const res = await request('/api/webhooks/kiwify', {
      method: 'POST',
      body: { order_id: 'fake_123', order_status: 'paid' }
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.error.code, 'UNAUTHORIZED_WEBHOOK');
  });

  // 4. Webhook Kiwify: Rejeição de payload com dados obrigatórios ausentes
  await test('4. Webhook Kiwify rejeita com HTTP 400 quando faltam campos obrigatórios', async () => {
    const res = await request('/api/webhooks/kiwify?token=token_secreto_teste_kiwify_2026', {
      method: 'POST',
      body: { order_status: 'paid' } // Sem order_id e sem Customer.email
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.error.code, 'INVALID_PAYLOAD');
  });

  // 5. Webhook Kiwify: Pagamento aprovado legítimo ativa Plano Vitalício automaticamente
  const uniqueOrderId = `kw_ord_${Date.now()}_abc123`;

  await test('5. Pagamento aprovado da Kiwify ativa plano VITALICIO automaticamente', async () => {
    const webhookPayload = {
      order_id: uniqueOrderId,
      order_ref: 'REF-DOC-2026',
      order_status: 'paid',
      payment_method: 'pix',
      charge_amount: '19.90',
      Product: {
        product_id: 'prod_vitalicio_documentocerto',
        product_name: 'DocumentoCerto Plano Vitalício'
      },
      Customer: {
        full_name: 'Comprador Oficial Kiwify',
        email: testEmail,
        CPF: '12345678909'
      }
    };

    const res = await request('/api/webhooks/kiwify?token=token_secreto_teste_kiwify_2026', {
      method: 'POST',
      body: webhookPayload
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.plano, 'VITALICIO');

    // Confirmação no banco de dados da organização
    const updatedOrg = organizationsDb.findById(userOrgId);
    assert.strictEqual(updatedOrg.plano, 'VITALICIO');
    assert.strictEqual(updatedOrg.trialAtivo, false);
    assert.strictEqual(updatedOrg.trialExpiraEm, null);

    // Confirmação na sessão do usuário (/api/auth/me)
    const meRes = await request('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.data.organization.plano, 'VITALICIO');
    assert.strictEqual(meRes.data.data.organization.statusComercial, 'ATIVO');

    // Confirmação na tabela de transações comerciais
    const tx = kiwifyTransactionsDb.findOne(t => t.orderId === uniqueOrderId);
    assert.ok(tx);
    assert.strictEqual(tx.status, 'PAID');
    assert.strictEqual(tx.customerEmail, testEmail);

    // Confirmação de log de auditoria
    const auditLogs = auditDb.findAll(a => a.tenantId === userOrgId && a.action === 'KIWIFY_ORDER_APPROVED');
    assert.strictEqual(auditLogs.length, 1);
  });

  // 6. Idempotência: Reenvio do mesmo webhook não duplica ativação nem corrompe estado
  await test('6. Idempotência: Reenvio do mesmo order_id retorna 200 OK sem duplicar', async () => {
    const res = await request('/api/webhooks/kiwify?token=token_secreto_teste_kiwify_2026', {
      method: 'POST',
      body: {
        order_id: uniqueOrderId,
        order_status: 'paid',
        Customer: { email: testEmail }
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.idempotente, true);

    // Garante que não foram criadas duas transações comerciais
    const transactions = kiwifyTransactionsDb.findAll(t => t.orderId === uniqueOrderId);
    assert.strictEqual(transactions.length, 1);

    // Garante que o plano continua intacto
    const org = organizationsDb.findById(userOrgId);
    assert.strictEqual(org.plano, 'VITALICIO');
  });

  // 7. Concorrência: Requisições simultâneas com o mesmo order_id
  await test('7. Concorrência: Requisições simultâneas com mesmo order_id processadas com segurança', async () => {
    const concurrentOrderId = `kw_conc_${Date.now()}`;
    const payload = {
      order_id: concurrentOrderId,
      order_status: 'paid',
      Customer: { email: testEmail }
    };

    const results = await Promise.all([
      request('/api/webhooks/kiwify?token=token_secreto_teste_kiwify_2026', { method: 'POST', body: payload }),
      request('/api/webhooks/kiwify?token=token_secreto_teste_kiwify_2026', { method: 'POST', body: payload })
    ]);

    assert.strictEqual(results[0].status, 200);
    assert.strictEqual(results[1].status, 200);

    const txs = kiwifyTransactionsDb.findAll(t => t.orderId === concurrentOrderId);
    assert.strictEqual(txs.length, 1);
  });

  // 8. Evento informativo (Boleto gerado / Pix aguardando) é registrado sem alterar plano
  await test('8. Evento não-aprovado (waiting_payment) é arquivado sem ativar plano', async () => {
    const waitingOrderId = `kw_wait_${Date.now()}`;
    const res = await request('/api/webhooks/kiwify?token=token_secreto_teste_kiwify_2026', {
      method: 'POST',
      body: {
        order_id: waitingOrderId,
        order_status: 'waiting_payment',
        Customer: { email: 'outro_cliente@teste.com' }
      }
    });

    assert.strictEqual(res.status, 200);
    const event = kiwifyWebhookEventsDb.findOne(e => e.orderId === waitingOrderId);
    assert.ok(event);
    assert.strictEqual(event.status, 'IGNORED');
  });

  // 9. Evento de Reembolso / Chargeback é registrado na auditoria
  await test('9. Reembolso da Kiwify atualiza transação e gera alerta de auditoria', async () => {
    const res = await request('/api/webhooks/kiwify?token=token_secreto_teste_kiwify_2026', {
      method: 'POST',
      body: {
        order_id: uniqueOrderId,
        order_status: 'refunded',
        Customer: { email: testEmail }
      }
    });

    assert.strictEqual(res.status, 200);
    const tx = kiwifyTransactionsDb.findOne(t => t.orderId === uniqueOrderId);
    assert.strictEqual(tx.status, 'REFUNDED');

    const warningLog = auditDb.findOne(a => a.action === 'KIWIFY_ORDER_REFUNDED_WARNING');
    assert.ok(warningLog);
    assert.strictEqual(warningLog.details.alerta, 'REQUIRES_ADMIN_REVIEW');
  });

  // 10. Resgate Seguro de Compra (Claim Purchase) por outro e-mail
  await test('10. Resgate seguro de compra (/api/plans/claim-purchase) vincula pagamento a conta', async () => {
    // 10.1 Cria compra sem usuário cadastrado
    const unclaimedOrderId = `kw_unclaimed_${Date.now()}`;
    const webhookRes = await request('/api/webhooks/kiwify?token=token_secreto_teste_kiwify_2026', {
      method: 'POST',
      body: {
        order_id: unclaimedOrderId,
        order_status: 'paid',
        Customer: { email: 'email_desconhecido@teste.com' }
      }
    });
    assert.strictEqual(webhookRes.status, 200);
    const claimToken = webhookRes.data.data.claim_token;
    assert.ok(claimToken);

    // 10.2 Cria um novo usuário em trial
    const newUserRes = await request('/api/auth/register', {
      method: 'POST',
      body: {
        nome: 'Usuario Resgate',
        email: `resgate_${Date.now()}@teste.com`,
        senha: 'SenhaSegura123!',
        nomeEmpresa: 'Empresa Resgate Ltda'
      }
    });
    const newToken = newUserRes.data.data.token;
    const newOrgId = newUserRes.data.data.organization.id;

    // 10.3 Envia resgate de compra autenticado
    const claimRes = await request('/api/plans/claim-purchase', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${newToken}` },
      body: { claimToken }
    });

    assert.strictEqual(claimRes.status, 200);
    assert.strictEqual(claimRes.data.success, true);
    assert.strictEqual(claimRes.data.data.plano, 'VITALICIO');

    const claimedOrg = organizationsDb.findById(newOrgId);
    assert.strictEqual(claimedOrg.plano, 'VITALICIO');

    // 10.4 Tentativa de resgatar novamente o mesmo token: REJEITADA com HTTP 409
    const secondClaimRes = await request('/api/plans/claim-purchase', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userToken}` },
      body: { claimToken }
    });
    assert.strictEqual(secondClaimRes.status, 409);
    assert.strictEqual(secondClaimRes.data.error.code, 'PURCHASE_ALREADY_CLAIMED');
  });

  server.close();

  console.log('\n================================================================');
  console.log(`📊 RESULTADO DOS TESTES DA FASE 3:`);
  console.log(`   Total executados: ${passed + failed}`);
  console.log(`   ✅ Aprovados:     ${passed}`);
  console.log(`   ❌ Reprovados:    ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runFase3Tests().catch(err => {
  console.error('Falha crítica na suíte da Fase 3:', err);
  if (server) server.close();
  process.exit(1);
});
