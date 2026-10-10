/**
 * DocumentoCerto - Teste de Validação da Conexão PostgreSQL em Produção (Fase 3.1)
 * Executa checagem de 360° no endpoint /api/health na nuvem
 */

import https from 'https';

const PROD_URL = process.argv[2] || 'https://documentocerto.onrender.com';

console.log('================================================================');
console.log('🔍 HOMOLOGAÇÃO FASE 3.1: VALIDAÇÃO POSTGRESQL AO VIVO NA NUVEM');
console.log(`URL Alvo: ${PROD_URL}`);
console.log('================================================================\n');

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'User-Agent': 'DocumentoCerto-Auditor-Fase3.1' },
      rejectUnauthorized: false
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Timeout na conexão'));
    });
    req.end();
  });
}

async function runAudit() {
  try {
    const res = await fetchJson(`${PROD_URL}/api/health`);
    console.log(`Status HTTP: ${res.status}`);
    console.log('Payload Retornado:');
    console.log(JSON.stringify(res.data, null, 2));

    console.log('\n--- DIAGNÓSTICO DA FASE 3.1 ---');
    if (res.data?.database?.connected) {
      console.log('🟢 POSTGRESQL CONECTADO COM SUCESSO!');
      console.log(`   Database: ${res.data.database.database}`);
      console.log(`   Driver: ${res.data.database.driver} (${res.data.database.version})`);
      console.log(`   Latência de Query: ${res.data.database.latency_ms}ms`);
      console.log(`   Tabelas no Schema: ${res.data.database.total_tables}`);
      if (res.data.database.tables) {
        console.log(`   Lista de Tabelas: ${res.data.database.tables.join(', ')}`);
      }
      if (res.data.database.connection) {
        console.log('   Dados de Conexão Mascarados (Seguro):', res.data.database.connection);
      }
    } else if (res.data?.database?.configured) {
      console.log('🟡 POSTGRESQL CONFIGURADO MAS COM ERRO DE CONEXÃO:');
      console.log(`   Erro: ${res.data.database.error}`);
    } else {
      console.log('⚪ POSTGRESQL PENDENTE DE CRIAÇÃO/VINCULAÇÃO:');
      console.log('   O backend está ativo e seguro em modo de transição (JsonDB).');
      console.log('   Aguardando criação do banco documentocerto-db e injeção da DATABASE_URL no Render.');
    }
  } catch (err) {
    console.error('❌ Erro ao consultar produção:', err.message);
  }
}

runAudit();
