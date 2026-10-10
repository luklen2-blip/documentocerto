import https from 'https';
import crypto from 'crypto';

const agent = new https.Agent({ rejectUnauthorized: false });

function req(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { ...options.headers };
    let bodyData = options.body;

    const r = https.request(u, { method: options.method || 'GET', headers, agent }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf-8')); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, data: json, buffer: raw });
      });
    });
    r.on('error', reject);
    if (bodyData) r.write(bodyData);
    r.end();
  });
}

async function testLiveUploadDownload() {
  console.log('🧪 Testando ciclo completo de upload e recuperação em produção no Render...');

  // 1. Registro de tenant de teste
  const email = `live_storage_${Date.now()}@teste.com`;
  const regRes = await req('https://documentocerto-1.onrender.com/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: 'Teste Live Storage',
      email,
      senha: 'SenhaForte123!',
      nomeEmpresa: 'Live Empresa Persistente'
    })
  });

  if (regRes.status !== 201) throw new Error(`Falha no registro live: HTTP ${regRes.status}`);
  const token = regRes.data.data.token;
  console.log('✅ 1. Conta criada em produção no Render');

  // 2. Cria processo
  const procRes = await req('https://documentocerto-1.onrender.com/api/processes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      nome: 'Processo Live Persistência',
      checklistId: 'chk_admissao_default',
      tipo: 'Admissão'
    })
  });

  if (procRes.status !== 201) throw new Error(`Falha na criação de processo: HTTP ${procRes.status}`);
  const proc = procRes.data.data;
  console.log(`✅ 2. Processo criado em produção: ${proc.id}`);

  // 3. Upload de PDF com hash conhecido
  const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
  const pdfBuffer = Buffer.from('%PDF-1.4 TESTE LIVE CLOUD STORAGE NEON PERSISTENCE OK 2026', 'utf-8');
  const expectedHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  const crlf = '\r\n';
  const targetItemId = proc.itens && proc.itens[0] ? proc.itens[0].id : 'item_adm_1';
  const bodyChunks = [
    Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="processId"${crlf}${crlf}${proc.id}${crlf}`),
    Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="itemId"${crlf}${crlf}${targetItemId}${crlf}`),
    Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="live_doc.pdf"${crlf}Content-Type: application/pdf${crlf}${crlf}`),
    pdfBuffer,
    Buffer.from(`${crlf}--${boundary}--${crlf}`)
  ];
  const multipartBody = Buffer.concat(bodyChunks);

  const upRes = await req('https://documentocerto-1.onrender.com/api/documents/upload', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Authorization': `Bearer ${token}`
    },
    body: multipartBody
  });

  if (upRes.status !== 201) throw new Error(`Falha no upload live: HTTP ${upRes.status} ${JSON.stringify(upRes.data)}`);
  const docId = upRes.data.data.document.id;
  console.log(`✅ 3. Upload persistido com sucesso no PostgreSQL! Doc ID: ${docId}`);

  // 4. Download do documento e conferência de integridade
  const downRes = await req(`https://documentocerto-1.onrender.com/api/documents/${docId}/file`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (downRes.status !== 200) throw new Error(`Falha no download live: HTTP ${downRes.status}`);
  const downloadedHash = crypto.createHash('sha256').update(downRes.buffer).digest('hex');

  if (downloadedHash !== expectedHash) {
    throw new Error(`Hash divergente em produção: ${downloadedHash} !== ${expectedHash}`);
  }
  console.log(`✅ 4. Download validado com sucesso! Hash SHA-256 idêntico: ${downloadedHash}`);

  // 5. Health Check
  const healthRes = await req('https://documentocerto-1.onrender.com/api/health');
  console.log('✅ 5. Total de document_blobs no Neon PostgreSQL:', healthRes.data.database.record_counts.document_blobs);
  console.log('🎉 CICLO DE PERSISTÊNCIA COMPLETO 100% HOMOLOGADO AO VIVO NA NUVEM!');
}

testLiveUploadDownload()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Falha:', err);
    process.exit(1);
  });
