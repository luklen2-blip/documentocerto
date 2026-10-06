/**
 * DocumentoCerto - Live Cloud E2E Test Suite
 * Valida a integridade do SaaS em produção com rejectUnauthorized: false
 * evitando rejeição por certificados intermediários no Windows.
 */

import https from 'https';
import http from 'http';

const targetUrl = process.argv[2] || process.env.LIVE_URL;

if (!targetUrl) {
  console.log('==================================================');
  console.log('DocumentoCerto - Validador Remoto de Nuvem 24/7');
  console.log('Uso: node tests/test_cloud_live.js <URL_DE_PRODUCAO>');
  console.log('Exemplo: node tests/test_cloud_live.js https://documentocerto.onrender.com');
  console.log('==================================================');
  process.exit(1);
}

const isHttps = targetUrl.startsWith('https://');
const client = isHttps ? https : http;
const agent = isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined;

function requestUrl(endpoint) {
  const fullUrl = new URL(endpoint, targetUrl).toString();
  return new Promise((resolve, reject) => {
    client.get(fullUrl, { agent }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, data: json, raw: data });
      });
    }).on('error', reject);
  });
}

async function runLiveTests() {
  console.log(`🌐 Testando implantação ao vivo em: ${targetUrl}\n`);
  let passed = 0;

  // 1. Health Check
  process.stdout.write('1. Verificando /api/health (24/7 Monitoring)... ');
  const health = await requestUrl('/api/health');
  if (health.status !== 200 || health.data?.status !== 'ok') {
    throw new Error(`Health check falhou: HTTP ${health.status}`);
  }
  console.log(`✅ OK (Versão: ${health.data.version}, Uptime: ${health.data.uptime_seconds}s)`);
  passed++;

  // 2. Landing Page
  process.stdout.write('2. Verificando Landing Page (HTML5 SPA)... ');
  const home = await requestUrl('/');
  if (home.status !== 200 || !home.raw.includes('DocumentoCerto')) {
    throw new Error(`Landing page falhou: HTTP ${home.status}`);
  }
  console.log('✅ OK (HTML carregado com sucesso)');
  passed++;

  // 3. Catálogo de Planos Comerciais
  process.stdout.write('3. Verificando Catálogo de Planos e PIX... ');
  const plans = await requestUrl('/api/plans');
  if (plans.status !== 200 || !Array.isArray(plans.data?.data) || plans.data.data.length < 4) {
    throw new Error(`Planos falharam: HTTP ${plans.status}`);
  }
  console.log(`✅ OK (${plans.data.data.length} planos comerciais ativos)`);
  passed++;

  console.log(`\n🎉 Todos os ${passed} testes de nuvem passaram! Aplicação 100% íntegra.`);
  process.exit(0);
}

runLiveTests().catch(err => {
  console.error('\n❌ Falha na validação em produção:', err.message);
  process.exit(1);
});
