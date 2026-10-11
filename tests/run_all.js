import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import app from '../server.js';
import { StatusService, STATUS_TYPES } from '../backend/services/status_service.js';
import { MathValidatorService } from '../backend/services/math_validator_service.js';
import { NormalizerService } from '../backend/services/normalizer_service.js';
import { ExtractionService } from '../backend/services/extraction_service.js';
import { ValidationEngine, SEVERITY, CLASSIFICATION } from '../backend/services/validation_engine.js';
import { AIAnalysisProvider } from '../backend/services/ai_analysis_provider.js';
import { MockOCRProvider } from '../backend/ocr/mock_ocr_provider.js';
import { setOCRProvider } from '../backend/ocr/index.js';
import { organizationsDb } from '../backend/database/index.js';

console.log('====================================================');
console.log('🧪 INICIANDO SUÍTE DE TESTES AUTOMATIZADOS: DOCUMENTOCERTO');
console.log('====================================================\n');

process.env.NODE_ENV = 'test';

let server;
let baseUrl = '';

function request(path, options = {}) {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const isMultipart = options.body instanceof FormData || options.isMultipart;
    const headers = { ...options.headers };

    let bodyData = options.body;
    if (bodyData && typeof bodyData === 'object' && !isMultipart && !Buffer.isBuffer(bodyData)) {
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
    if (bodyData) {
      req.write(bodyData);
    }
    req.end();
  });
}

// Multipart helper simplificado para testes de upload
function multipartUpload(endpoint, token, processId, itemId, fileName, fileContent, mimeType) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const crlf = '\r\n';

  let body = '';
  // Field processId
  body += `--${boundary}${crlf}`;
  body += `Content-Disposition: form-data; name="processId"${crlf}${crlf}`;
  body += `${processId}${crlf}`;

  // Field itemId
  body += `--${boundary}${crlf}`;
  body += `Content-Disposition: form-data; name="itemId"${crlf}${crlf}`;
  body += `${itemId}${crlf}`;

  // File
  body += `--${boundary}${crlf}`;
  body += `Content-Disposition: form-data; name="file"; filename="${fileName}"${crlf}`;
  body += `Content-Type: ${mimeType}${crlf}${crlf}`;
  body += fileContent + crlf;
  body += `--${boundary}--${crlf}`;

  return request(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body
  });
}

async function runAllTests() {
  let passed = 0;
  let failed = 0;

  // Inicia servidor em porta randômica disponível
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`🌐 Servidor de testes ativo em: ${baseUrl}\n`);
      resolve();
    });
  });

  const test = async (name, fn) => {
    try {
      process.stdout.write(`⏳ Testando: ${name}... `);
      await fn();
      passed++;
      console.log(`✅ APROVADO`);
    } catch (err) {
      failed++;
      console.log(`❌ REPROVADO`);
      console.error(`   Erro:`, err.message);
    }
  };

  let tokenA = '';
  let userA = null;
  let tenantA = null;

  let tokenB = '';
  let userB = null;
  let tenantB = null;

  let processA = null;
  let customChecklistA = null;
  let uploadedDocId = null;

  // TESTE 1: Health Check
  await test('1. Endpoint de Monitoramento 24/7 (/api/health)', async () => {
    const res = await request('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'ok');
    assert.strictEqual(res.data.app, 'DocumentoCerto');
    assert.strictEqual(res.data.version, '2.0.0');
    assert.ok(typeof res.data.uptime_seconds === 'number');
    assert.ok(res.data.timestamp);
  });

  // TESTE 2: Cadastro de Conta e Criação de Organização (Tenant A)
  await test('2. Cadastro e Criação do Tenant A (Escritório Alfa)', async () => {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: {
        nome: 'Luciano Admin Alfa',
        email: `luciano.alfa.${Date.now()}@alfa.com.br`,
        senha: 'senhaForte123@',
        nomeEmpresa: 'Escritório Alfa Contábil',
        cpfCnpj: '12.345.678/0001-90'
      }
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.success);
    assert.ok(res.data.data.token);
    assert.strictEqual(res.data.data.user.papel, 'ADMIN');
    assert.strictEqual(res.data.data.organization.nome, 'Escritório Alfa Contábil');

    tokenA = res.data.data.token;
    userA = res.data.data.user;
    tenantA = res.data.data.organization;
  });

  // TESTE 3: Login e Verificação de Credenciais
  await test('3. Login do Usuário no Tenant A', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: {
        email: userA.email,
        senha: 'senhaForte123@'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
    assert.ok(res.data.data.token);
  });

  // TESTE 4: Cadastro do Tenant B (Isolamento Multi-tenant)
  await test('4. Cadastro do Tenant B (Imobiliária Beta)', async () => {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: {
        nome: 'Beatriz Admin Beta',
        email: `beatriz.beta.${Date.now()}@beta.com.br`,
        senha: 'outraSenha456@',
        nomeEmpresa: 'Imobiliária Beta Prime'
      }
    });

    assert.strictEqual(res.status, 201);
    tokenB = res.data.data.token;
    userB = res.data.data.user;
    tenantB = res.data.data.organization;

    assert.notStrictEqual(tenantA.id, tenantB.id, 'Tenants devem ter IDs distintos');
  });

  // TESTE 5: Listagem de Checklists e Criação de Checklist Customizado no Tenant A
  await test('5. Checklists Padrão e Criação de Customizado no Tenant A', async () => {
    const listRes = await request('/api/checklists', {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert.strictEqual(listRes.status, 200);
    assert.ok(listRes.data.data.length >= 3, 'Deve conter pelo menos os 3 modelos de sistema');

    // Cria customizado no Tenant A
    const createRes = await request('/api/checklists', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenA}` },
      body: {
        nome: 'Homologação Exclusiva Alfa',
        categoria: 'Operações',
        itens: [
          { nome: 'Contrato Social Registrado', tipo: 'juridico', obrigatorio: true },
          { nome: 'Alvará de Funcionamento', tipo: 'licenca', obrigatorio: false }
        ]
      }
    });

    assert.strictEqual(createRes.status, 201);
    customChecklistA = createRes.data.data;
  });

  // TESTE 6: Tentativa do Tenant B de acessar o Checklist Privado do Tenant A
  await test('6. Isolamento: Tenant B bloqueado ao tentar ler Checklist do Tenant A', async () => {
    const res = await request(`/api/checklists/${customChecklistA.id}`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.error.code, 'CROSS_TENANT_ACCESS_DENIED');
  });

  // TESTE 7: Criação de Processo no Tenant A e Cálculo Inicial de Status
  await test('7. Criação de Processo com Checklist de Admissão e Status Inicial', async () => {
    // Busca o checklist padrão de admissão
    const chkRes = await request('/api/checklists', { headers: { 'Authorization': `Bearer ${tokenA}` } });
    const admissaoChk = chkRes.data.data.find(c => c.id === 'chk_admissao_default');

    const procRes = await request('/api/processes', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenA}` },
      body: {
        nome: 'Admissão João Silva - Desenvolvedor',
        tipo: 'Admissão CLT',
        responsavelNome: 'Luciano RH',
        prazo: '2026-11-15',
        checklistId: admissaoChk.id
      }
    });

    assert.strictEqual(procRes.status, 201);
    processA = procRes.data.data;

    // Regra determinística: Sem nenhum documento, status DEVE ser INCOMPLETO
    assert.strictEqual(processA.statusDeterminístico, STATUS_TYPES.INCOMPLETO);
    assert.strictEqual(processA.statusInfo.status, 'INCOMPLETO');
    assert.strictEqual(processA.statusInfo.obrigatoriosPresentes, 0);
  });

  // TESTE 8: OBRIGATÓRIO - Tentativa de invasão/acesso cross-tenant ao processo
  await test('8. [OBRIGATÓRIO] Rejeição de Invasão Cross-Tenant ao Processo do Tenant A', async () => {
    // 8.1 - Leitura negada
    const readRes = await request(`/api/processes/${processA.id}`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.strictEqual(readRes.status, 403);
    assert.strictEqual(readRes.data.error.code, 'CROSS_TENANT_ACCESS_DENIED');

    // 8.2 - Exclusão negada
    const deleteRes = await request(`/api/processes/${processA.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.strictEqual(deleteRes.status, 403);
    assert.strictEqual(deleteRes.data.error.code, 'CROSS_TENANT_ACCESS_DENIED');
  });

  // TESTE 9: Upload Seguro de Documento em Item Obrigatório
  await test('9. Upload Seguro de Documento (PDF) para Item 1', async () => {
    const item1 = processA.itens[0];
    const dummyPdf = '%PDF-1.4 ... (conteudo simulado seguro do teste de admissao)';

    const upRes = await multipartUpload(
      '/api/documents/upload',
      tokenA,
      processA.id,
      item1.id,
      'documento_rg_cnh.pdf',
      dummyPdf,
      'application/pdf'
    );

    assert.strictEqual(upRes.status, 201);
    assert.ok(upRes.data.success);
    assert.ok(upRes.data.data.document.id);
    uploadedDocId = upRes.data.data.document.id;

    // Verifica que o arquivo físico está no armazenamento privado
    assert.ok(fs.existsSync(upRes.data.data.document.storagePath));

    // Regra: Com apenas 1 de 6 documentos obrigatórios, ainda DEVE ser INCOMPLETO
    const updatedProc = upRes.data.data.process;
    assert.strictEqual(updatedProc.statusDeterminístico, STATUS_TYPES.INCOMPLETO);
  });

  // TESTE 10: OBRIGATÓRIO - Tentativa de Download Cross-Tenant de Documento Privado
  await test('10. [OBRIGATÓRIO] Rejeição de Download de Arquivo Privado por Outro Tenant', async () => {
    const docRes = await request(`/api/documents/${uploadedDocId}/file`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.strictEqual(docRes.status, 403);
    assert.strictEqual(docRes.data.error.code, 'CROSS_TENANT_ACCESS_DENIED');
  });

  // TESTE 11: Cálculo de Status Determinístico (Unitário & Integrado)
  await test('11. Cálculo Determinístico de Status: Regras de Completude e Atenção', () => {
    // Caso 1: Itens obrigatórios ausentes -> INCOMPLETO
    const itens1 = [
      { id: '1', nome: 'RG', obrigatorio: true, documentoId: 'doc1' },
      { id: '2', nome: 'CPF', obrigatorio: true, documentoId: null }
    ];
    const calc1 = StatusService.calculate(itens1);
    assert.strictEqual(calc1.status, STATUS_TYPES.INCOMPLETO);

    // Caso 2: Todos os obrigatórios presentes, mas item com nota para conferência -> ATENÇÃO
    const itens2 = [
      { id: '1', nome: 'RG', obrigatorio: true, documentoId: 'doc1' },
      { id: '2', nome: 'CPF', obrigatorio: true, documentoId: 'doc2', statusItem: 'conferir', observacoes: 'Recomenda-se verificar nitidez da foto' }
    ];
    const calc2 = StatusService.calculate(itens2);
    assert.strictEqual(calc2.status, STATUS_TYPES.ATENCAO);

    // Caso 3: Todos os obrigatórios presentes e sem pendência de conferência -> APARENTEMENTE COMPLETO
    const itens3 = [
      { id: '1', nome: 'RG', obrigatorio: true, documentoId: 'doc1' },
      { id: '2', nome: 'CPF', obrigatorio: true, documentoId: 'doc2' }
    ];
    const calc3 = StatusService.calculate(itens3);
    assert.strictEqual(calc3.status, STATUS_TYPES.COMPLETO);
  });

  // TESTE 12: Permissão RBAC (Membro vs Admin)
  await test('12. Controle de Acesso Baseado em Papel (RBAC: Admin vs Membro)', async () => {
    // 12.1 - Admin do Tenant A cria um novo Membro
    const addMemberRes = await request('/api/tenants/users', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenA}` },
      body: {
        nome: 'Marcos Membro Operacional',
        email: `marcos.membro.${Date.now()}@alfa.com.br`,
        senha: 'senhaMembro123@',
        papel: 'MEMBRO'
      }
    });

    assert.strictEqual(addMemberRes.status, 201);
    const memberId = addMemberRes.data.data.id;

    // 12.2 - Login como Membro
    const loginMemberRes = await request('/api/auth/login', {
      method: 'POST',
      body: {
        email: addMemberRes.data.data.email,
        senha: 'senhaMembro123@'
      }
    });
    const tokenMembro = loginMemberRes.data.data.token;

    // 12.3 - Membro tenta excluir processo (PROIBIDO: restrito a ADMIN)
    const deleteTryRes = await request(`/api/processes/${processA.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenMembro}` }
    });
    assert.strictEqual(deleteTryRes.status, 403);
    assert.strictEqual(deleteTryRes.data.error.code, 'FORBIDDEN_ROLE');
  });

  // TESTE 13: Histórico de Auditoria
  await test('13. Registro e Consulta de Trilha de Auditoria', async () => {
    const auditRes = await request(`/api/audit/process/${processA.id}`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });

    assert.strictEqual(auditRes.status, 200);
    assert.ok(auditRes.data.data.length >= 2, 'Deve ter registrado criacao e upload');
    const actions = auditRes.data.data.map(l => l.action);
    assert.ok(actions.includes('PROCESSO_CRIADO'));
    assert.ok(actions.includes('DOCUMENTO_ENVIADO'));
  });

  // TESTE 14: Planos Comerciais e Geração de PIX Oficial (Bacen EMV)
  await test('14. Planos Comerciais e Geração Oficial de PIX EMV', async () => {
    const plansRes = await request('/api/plans');
    assert.strictEqual(plansRes.status, 200);
    assert.strictEqual(plansRes.data.data.length, 4);

    const pixRes = await request('/api/plans/pix-quote', {
      method: 'POST',
      body: { planoId: 'profissional' }
    });

    assert.strictEqual(pixRes.status, 200);
    assert.ok(pixRes.data.data.pix.emvCopiaECola.startsWith('000201'));
    assert.ok(pixRes.data.data.pix.qrCodeUrl.includes('create-qr-code'));
  });

  // TESTE 15: Exclusão Segura de Documento
  await test('15. Exclusão Segura de Documento pelo Admin', async () => {
    const delRes = await request(`/api/documents/${uploadedDocId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });

    assert.strictEqual(delRes.status, 200);

    // Confirma que não pode mais ser baixado
    const checkRes = await request(`/api/documents/${uploadedDocId}/file`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert.strictEqual(checkRes.status, 404);
  });

  // ====================================================
  // SUÍTE DE TESTES DA FASE 2: OCR, EXTRAÇÃO & DIAGNÓSTICO
  // ====================================================

  // TESTE 16: Validação Matemática de CPF (Módulo 11)
  await test('16. [Fase 2] Validação Matemática Real de CPF (Módulo 11)', () => {
    // 16.1 - CPF válido real
    const val1 = MathValidatorService.validateCpf('123.456.789-09');
    assert.strictEqual(val1.status, 'VALIDO');
    assert.strictEqual(val1.isValid, true);
    assert.strictEqual(val1.cleanCpf, '12345678909');

    // 16.2 - CPF com dígitos incorretos
    const val2 = MathValidatorService.validateCpf('123.456.789-08');
    assert.strictEqual(val2.status, 'INVALIDO');
    assert.strictEqual(val2.isValid, false);

    // 16.3 - Sequência repetida inválida
    const val3 = MathValidatorService.validateCpf('111.111.111-11');
    assert.strictEqual(val3.status, 'INVALIDO');

    // 16.4 - Tamanho insuficiente / não identificado
    const val4 = MathValidatorService.validateCpf('12345');
    assert.strictEqual(val4.status, 'NAO_IDENTIFICADO');
  });

  // TESTE 17: Validação Matemática de CNPJ (Módulo 11)
  await test('17. [Fase 2] Validação Matemática Real de CNPJ (Módulo 11)', () => {
    // 17.1 - CNPJ matematicamente válido (11.222.333/0001-81)
    const val1 = MathValidatorService.validateCnpj('11.222.333/0001-81');
    assert.strictEqual(val1.status, 'VALIDO');
    assert.strictEqual(val1.isValid, true);
    assert.strictEqual(val1.cleanCpf || val1.cleanCnpj, '11222333000181');

    // 17.2 - CNPJ com dígitos incorretos
    const val2 = MathValidatorService.validateCnpj('11.222.333/0001-82');
    assert.strictEqual(val2.status, 'INVALIDO');

    // 17.3 - Sequência repetida
    const val3 = MathValidatorService.validateCnpj('00.000.000/0000-00');
    assert.strictEqual(val3.status, 'INVALIDO');

    // 17.4 - CNPJ incompleto
    const val4 = MathValidatorService.validateCnpj('11222333');
    assert.strictEqual(val4.status, 'NAO_IDENTIFICADO');
  });

  // TESTE 18: Normalização Canônica de Dados
  await test('18. [Fase 2] Normalizadores de CPF, CNPJ, Nomes e Datas', () => {
    assert.strictEqual(NormalizerService.normalizeCpf('123.456.789-09'), '12345678909');
    assert.strictEqual(NormalizerService.normalizeCnpj('12.345.678/0001-90'), '12345678000190');

    // Nomes com acentos e espaços
    assert.strictEqual(NormalizerService.normalizeName('  João   da   Silva  '), 'JOAO DA SILVA');
    assert.strictEqual(NormalizerService.compareNames('João da Silva', 'JOAO DA SILVA'), true);
    assert.strictEqual(NormalizerService.compareNames('João da Silva', 'João Pereira'), false);

    // Datas brasileiras para ISO
    assert.strictEqual(NormalizerService.normalizeDate('15/04/1985'), '1985-04-15');
    assert.strictEqual(NormalizerService.normalizeDate('2026-10-06'), '2026-10-06');
  });

  // TESTE 19: Extração Estruturada e Evidências Auditáveis
  await test('19. [Fase 2] Extração Estruturada com Trecho e Nível de Confiança', () => {
    const textSample = `REPÚBLICA FEDERATIVA DO BRASIL\nNOME: JOAO DA SILVA\nCPF: 123.456.789-09\nDATA DE NASCIMENTO: 15/04/1985\nDATA DE EMISSÃO: 10/01/2020\nÓRGÃO EMISSOR: SSP/SP\nREGISTRO GERAL RG: 12.345.678-9`;
    const fields = ExtractionService.extractFromDocument({
      documentId: 'doc_teste_1',
      documentName: 'RG_Oficial.pdf',
      pages: [{ pageNumber: 1, text: textSample, confidence: 0.98 }],
      source: 'PDF_TEXT'
    });

    assert.ok(fields.length >= 4);
    const cpfField = fields.find(f => f.field === 'cpf');
    assert.ok(cpfField);
    assert.strictEqual(cpfField.normalized_value, '12345678909');
    assert.strictEqual(cpfField.document_name, 'RG_Oficial.pdf');
    assert.ok(cpfField.snippet.includes('123.456.789-09'));
    assert.ok(cpfField.confidence > 0.9);

    const nameField = fields.find(f => f.field === 'nome_completo');
    assert.ok(nameField);
    assert.strictEqual(nameField.normalized_value, 'JOAO DA SILVA');
  });

  // TESTE 20: Detecção de Duplicidade Criptográfica (SHA-256)
  await test('20. [Fase 2] Detecção de Documentos Duplicados via Hash Criptográfico', () => {
    const ocrResults = [
      { documentId: 'doc1', documentName: 'Contrato_V1.pdf', metadata: { fileHash: 'hash_abc123' }, confidence: 0.95 },
      { documentId: 'doc2', documentName: 'Contrato_Copia.pdf', metadata: { fileHash: 'hash_abc123' }, confidence: 0.95 }
    ];

    const findings = [];
    const deductions = [];
    ValidationEngine._runDuplicateRule([], ocrResults, findings, deductions);

    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].code, 'DUPLICATE_DOCUMENT');
    assert.strictEqual(findings[0].severity, SEVERITY.MEDIUM);
    assert.ok(findings[0].comparison.sha256 === 'hash_abc123');
  });

  // TESTE 21: Conferência Cruzada entre Documentos (Divergência de Nome e CPF)
  await test('21. [Fase 2] Conferência Cruzada: Detecção de Divergência de Nomes e CPFs', () => {
    // 21.1 - Divergência de Nome entre Doc A e Doc B
    const fieldsNameDiff = [
      { id: '1', document_id: 'docA', document_name: 'DocA.pdf', field: 'nome_completo', value: 'JOAO DA SILVA', normalized_value: 'JOAO DA SILVA', page: 1 },
      { id: '2', document_id: 'docB', document_name: 'DocB.pdf', field: 'nome_completo', value: 'JOAO PEREIRA', normalized_value: 'JOAO PEREIRA', page: 1 }
    ];

    const findingsName = [];
    const deductionsName = [];
    ValidationEngine._runCrossDocumentConsistencyRule(fieldsNameDiff, findingsName, deductionsName);

    assert.strictEqual(findingsName.length, 1);
    assert.strictEqual(findingsName[0].code, 'NAME_MISMATCH');
    assert.strictEqual(findingsName[0].severity, SEVERITY.HIGH);
    assert.ok(findingsName[0].comparison.docA.value === 'JOAO DA SILVA');
    assert.ok(findingsName[0].comparison.docB.value === 'JOAO PEREIRA');

    // 21.2 - Divergência de CPF entre Doc A e Doc B
    const fieldsCpfDiff = [
      { id: '1', document_id: 'docA', document_name: 'DocA.pdf', field: 'cpf', value: '123.456.789-09', normalized_value: '12345678909', validation: { isValid: true }, page: 1 },
      { id: '2', document_id: 'docB', document_name: 'DocB.pdf', field: 'cpf', value: '987.654.321-00', normalized_value: '98765432100', validation: { isValid: true }, page: 1 }
    ];

    const findingsCpf = [];
    const deductionsCpf = [];
    ValidationEngine._runCrossDocumentConsistencyRule(fieldsCpfDiff, findingsCpf, deductionsCpf);

    assert.strictEqual(findingsCpf.length, 1);
    assert.strictEqual(findingsCpf[0].code, 'CPF_MISMATCH');
    assert.strictEqual(findingsCpf[0].severity, SEVERITY.HIGH);
  });

  // TESTE 22: Detecção de Documento Vencido e Data Futura
  await test('22. [Fase 2] Detecção de Documento Vencido e Data de Emissão no Futuro', () => {
    const fieldsDates = [
      { id: '1', document_id: 'docA', document_name: 'Certidao.pdf', field: 'data_validade', value: '01/01/2020', normalized_value: '2020-01-01', page: 1 },
      { id: '2', document_id: 'docB', document_name: 'Nota.pdf', field: 'data_emissao', value: '31/12/2099', normalized_value: '2099-12-31', page: 1 }
    ];

    const findings = [];
    const deductions = [];
    ValidationEngine._runDateRules(fieldsDates, findings, deductions);

    assert.strictEqual(findings.length, 2);
    assert.ok(findings.some(f => f.code === 'EXPIRED_DOCUMENT'));
    assert.ok(findings.some(f => f.code === 'FUTURE_ISSUE_DATE'));
  });

  // TESTE 23: Cálculo do Índice de Conferência (0 a 100)
  await test('23. [Fase 2] Cálculo do Índice de Conferência e Classificação Geral', () => {
    const mockReport = ValidationEngine.run({
      process: { itens: [] },
      documents: [{ id: 'doc1' }],
      extractedFields: [
        { id: 'f1', document_id: 'doc1', document_name: 'Doc.pdf', field: 'cpf', value: '111.111.111-11', validation: { status: 'INVALIDO', isValid: false }, page: 1 }
      ],
      ocrResults: []
    });

    assert.strictEqual(mockReport.status, CLASSIFICATION.PROBLEMA);
    assert.ok(mockReport.score < 100, 'Score deve deduzir penalidade por CPF inválido');
    assert.strictEqual(mockReport.score, 80); // 100 - 20
    assert.strictEqual(mockReport.deductions.length, 1);
    assert.ok(mockReport.disclaimer);
  });

  // TESTE 24: Blindagem Anti-Alucinação na Camada de IA
  await test('24. [Fase 2] Filtro Mandatório Anti-Alucinação na Camada de IA', () => {
    const validEvidenceId = 'ev_real_123';
    const fakeEvidenceId = 'ev_fake_999';

    const aiFindingsWithFake = [
      { code: 'TEST_VALID', severity: 'HIGH', evidence_ids: [validEvidenceId] },
      { code: 'TEST_HALLUCINATED', severity: 'HIGH', evidence_ids: [fakeEvidenceId] }
    ];

    const grounded = AIAnalysisProvider.validateGrounding(aiFindingsWithFake, [validEvidenceId]);
    assert.strictEqual(grounded.length, 1);
    assert.strictEqual(grounded[0].code, 'TEST_VALID');
  });

  let jobProcessAId = '';

  // TESTE 25: Máquina de Estados e Execução Assíncrona de Análise
  await test('25. [Fase 2] Execução Assíncrona de Job de Análise (QUEUED -> COMPLETED)', async () => {
    // Configura Mock OCR para o teste
    const mockOcr = new MockOCRProvider();
    setOCRProvider(mockOcr);

    // Reanexa um documento para processA para o teste
    const item1 = processA.itens[0];
    await multipartUpload(
      '/api/documents/upload',
      tokenA,
      processA.id,
      item1.id,
      'documento_rg.pdf',
      '%PDF-1.4 ... (conteudo simulado)',
      'application/pdf'
    );

    // Dispara a análise assíncrona
    const runRes = await request(`/api/analysis/process/${processA.id}/run`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });

    assert.strictEqual(runRes.status, 202);
    assert.ok(runRes.data.data.id);
    jobProcessAId = runRes.data.data.id;

    // Aguarda o processamento assíncrono (polling breve)
    let jobStatus = runRes.data.data.status;
    let attempts = 0;
    while ((jobStatus === 'QUEUED' || jobStatus === 'PROCESSING') && attempts < 15) {
      await new Promise(r => setTimeout(r, 200));
      const pollRes = await request(`/api/analysis/job/${jobProcessAId}`, {
        headers: { 'Authorization': `Bearer ${tokenA}` }
      });
      jobStatus = pollRes.data.data.status;
      attempts++;
    }

    assert.ok(['COMPLETED', 'NEEDS_REVIEW'].includes(jobStatus), `Job deve finalizar com sucesso (status: ${jobStatus})`);

    // Consulta última análise completa do processo
    const latestRes = await request(`/api/analysis/process/${processA.id}/latest`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });

    assert.strictEqual(latestRes.status, 200);
    assert.ok(latestRes.data.data.result.score !== undefined);
    assert.ok(latestRes.data.data.result.aiSummary);
  });

  // TESTE 26: [OBRIGATÓRIO] Isolamento Multi-Tenant nas Rotas da Fase 2
  await test('26. [Fase 2] [OBRIGATÓRIO] Bloqueio Cross-Tenant em Análise Inteligente', async () => {
    // 26.1 - Tenant B tenta disparar análise no processo do Tenant A
    const runTryRes = await request(`/api/analysis/process/${processA.id}/run`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.strictEqual(runTryRes.status, 403);
    assert.strictEqual(runTryRes.data.error.code, 'CROSS_TENANT_ACCESS_DENIED');

    // 26.2 - Tenant B tenta ler a última análise do processo do Tenant A
    const getTryRes = await request(`/api/analysis/process/${processA.id}/latest`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.strictEqual(getTryRes.status, 403);
    assert.strictEqual(getTryRes.data.error.code, 'CROSS_TENANT_ACCESS_DENIED');

    // 26.3 - Tenant B tenta consultar o job do Tenant A
    const jobTryRes = await request(`/api/analysis/job/${jobProcessAId}`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.strictEqual(jobTryRes.status, 404);
  });

  // TESTE 27: [Kiwify & Trial] Integração do Plano Vitalício e 1 Dia de Teste Grátis
  await test('27. [Kiwify & Trial] Plano Vitalício (R$ 19,90) e Período de 1 Dia de Teste', async () => {
    // 27.1 - Rota de checkout Kiwify
    const kiwifyRes = await request('/api/plans/kiwify');
    assert.strictEqual(kiwifyRes.status, 200);
    assert.strictEqual(kiwifyRes.data.data.kiwifyUrl, 'https://pay.kiwify.com.br/ueLjXAd');
    assert.strictEqual(kiwifyRes.data.data.trialDias, 1);
    assert.strictEqual(kiwifyRes.data.data.plano, 'Plano Vitalício');

    // 27.2 - PIX quote com Kiwify URL embutida
    const quoteRes = await request('/api/plans/pix-quote', {
      method: 'POST',
      body: { planoId: 'vitalicio' }
    });
    assert.strictEqual(quoteRes.status, 200);
    assert.strictEqual(quoteRes.data.data.kiwifyUrl, 'https://pay.kiwify.com.br/ueLjXAd');
    assert.strictEqual(quoteRes.data.data.plano.valorMensal, 19.90);

    // 27.3 - Novo Tenant nasce com 1 dia de trial ativo
    const regRes = await request('/api/auth/register', {
      method: 'POST',
      body: {
        nome: 'Usuario Teste Kiwify',
        email: `trial.user.${Date.now()}@kiwify.com.br`,
        senha: 'senhaTrial123@',
        nomeEmpresa: 'Kiwify Teste Organização',
        cpfCnpj: '98.765.432/0001-10'
      }
    });
    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regRes.data.data.organization.trialAtivo, true);
    assert.strictEqual(regRes.data.data.organization.trialDias, 1);
    assert.ok(regRes.data.data.organization.trialExpiraEm);
  });

  // TESTE 28: [Bloqueio Backend & Expiração] Imunidade a manipulação e bloqueio após 24h
  await test('28. [Bloqueio Backend] Bloqueio estrito de API após término do período de teste', async () => {
    // 28.1 - Registra novo usuário para teste de expiração
    const expEmail = `expirado.${Date.now()}@teste.com`;
    const regRes = await request('/api/auth/register', {
      method: 'POST',
      body: {
        nome: 'Usuario Expiravel',
        email: expEmail,
        senha: 'senhaExpiravel123@',
        nomeEmpresa: 'Empresa Expiravel Ltda',
        cpfCnpj: '11.222.333/0001-44'
      }
    });
    assert.strictEqual(regRes.status, 201);
    const expToken = regRes.data.data.token;
    const expOrgId = regRes.data.data.organization.id;

    // 28.2 - Durante o trial válido: criação de processo é permitida
    const validProcRes = await request('/api/processes', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${expToken}` },
      body: {
        nome: 'Processo no Trial Valido',
        checklistId: 'chk_admissao_default',
        tipo: 'Admissão'
      }
    });
    assert.strictEqual(validProcRes.status, 201);
    const procId = validProcRes.data.data.id;

    // 28.3 - Simula término das 24 horas no banco de dados (expiração)
    const { organizationsDb } = await import('../backend/database/index.js');
    organizationsDb.update(expOrgId, {
      trialExpiraEm: new Date(Date.now() - 60000).toISOString() // Expirou há 1 minuto
    });

    // 28.4 - Consulta /api/auth/me: Servidor reporta TRIAL_EXPIRADO deterministicamente
    const meRes = await request('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${expToken}` }
    });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.data.organization.statusComercial, 'TRIAL_EXPIRADO');
    assert.strictEqual(meRes.data.data.organization.trialExpirado, true);

    // 28.5 - Tentativa de criar processo com trial expirado: BLOQUEADO (HTTP 403 TRIAL_EXPIRED)
    const blockedProcRes = await request('/api/processes', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${expToken}` },
      body: {
        nome: 'Tentativa Burlar Criacao',
        checklistId: 'chk_admissao_default',
        tipo: 'Admissão'
      }
    });
    assert.strictEqual(blockedProcRes.status, 403);
    assert.strictEqual(blockedProcRes.data.error.code, 'TRIAL_EXPIRED');

    // 28.6 - Tentativa de upload com trial expirado: BLOQUEADO (HTTP 403 TRIAL_EXPIRED)
    const blockedUploadRes = await multipartUpload(
      '/api/documents/upload',
      expToken,
      procId,
      'item_adm_1',
      'rg_teste.pdf',
      '%PDF-1.4 ...',
      'application/pdf'
    );
    assert.strictEqual(blockedUploadRes.status, 403);
    assert.strictEqual(blockedUploadRes.data.error.code, 'TRIAL_EXPIRED');

    // 28.7 - Tentativa de disparar análise com trial expirado: BLOQUEADO (HTTP 403 TRIAL_EXPIRED)
    const blockedAnalysisRes = await request(`/api/analysis/process/${procId}/run`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${expToken}` }
    });
    assert.strictEqual(blockedAnalysisRes.status, 403);
    assert.strictEqual(blockedAnalysisRes.data.error.code, 'TRIAL_EXPIRED');

    // 28.8 - Upgrade para Plano VITALICIO: Desbloqueio imediato definitivo
    organizationsDb.update(expOrgId, {
      plano: 'VITALICIO',
      ativo: true
    });

    const unblockedProcRes = await request('/api/processes', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${expToken}` },
      body: {
        nome: 'Processo Apos Ativacao Vitalicia',
        checklistId: 'chk_admissao_default',
        tipo: 'Admissão'
      }
    });
    assert.strictEqual(unblockedProcRes.status, 201);
  });

  // ----------------------------------------------------
  // TESTE 29: Conformidade Legal LGPD e Termos de Uso (/termos e /privacidade)
  // ----------------------------------------------------
  await test('29. [LGPD & Legal] Disponibilidade das rotas /termos e /privacidade...', async () => {
    const termosRes = await request('/termos');
    assert.strictEqual(termosRes.status, 200);
    assert.ok(termosRes.raw.includes('Termos de Uso'));
    assert.ok(termosRes.raw.includes('DocumentoCerto'));

    const privRes = await request('/privacidade');
    assert.strictEqual(privRes.status, 200);
    assert.ok(privRes.raw.includes('Política de Privacidade'));
    assert.ok(privRes.raw.includes('LGPD'));
    assert.ok(privRes.raw.includes('Lei 13.709/2018'));
  });

  // ----------------------------------------------------
  // TESTE 30: [Fase 3] Webhook Kiwify: Defesa de Autenticação (HTTP 401)
  // ----------------------------------------------------
  await test('30. [Fase 3] Webhook Kiwify: Rejeição de chamada sem token válido (HTTP 401)...', async () => {
    process.env.KIWIFY_WEBHOOK_TOKEN = 'secret_test_token_2026';
    const res = await request('/api/webhooks/kiwify', {
      method: 'POST',
      body: { order_id: 'fake_123', order_status: 'paid' }
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.error.code, 'UNAUTHORIZED_WEBHOOK');
  });

  // ----------------------------------------------------
  // TESTE 31: [Fase 3] Webhook Kiwify: Ativação Automática de Pagamento Aprovado
  // ----------------------------------------------------
  const kwOrderId = `kw_runall_${Date.now()}`;
  await test('31. [Fase 3] Webhook Kiwify: Pagamento aprovado ativa plano VITALICIO...', async () => {
    process.env.KIWIFY_WEBHOOK_TOKEN = 'secret_test_token_2026';
    const res = await request('/api/webhooks/kiwify?token=secret_test_token_2026', {
      method: 'POST',
      body: {
        order_id: kwOrderId,
        order_status: 'paid',
        Product: { product_name: 'DocumentoCerto Plano Vitalício' },
        Customer: { email: userA.email, full_name: userA.nome }
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.plano, 'VITALICIO');

    const orgA = organizationsDb.findById(tenantA.id);
    assert.strictEqual(orgA.plano, 'VITALICIO');
  });

  // ----------------------------------------------------
  // TESTE 32: [Fase 3] Webhook Kiwify: Idempotência Comprovada (Reenvio)
  // ----------------------------------------------------
  await test('32. [Fase 3] Webhook Kiwify: Idempotência confirmada contra reenvio de evento...', async () => {
    const res = await request('/api/webhooks/kiwify?token=secret_test_token_2026', {
      method: 'POST',
      body: {
        order_id: kwOrderId,
        order_status: 'paid',
        Customer: { email: userA.email }
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.idempotente, true);
  });

  // ----------------------------------------------------
  // TESTE 33: [Fase 3] Resgate de Compra (/api/plans/claim-purchase)
  // ----------------------------------------------------
  await test('33. [Fase 3] Resgate seguro de compra comprovada Kiwify...', async () => {
    const unclaimedId = `kw_unclaimed_runall_${Date.now()}`;
    const whRes = await request('/api/webhooks/kiwify?token=secret_test_token_2026', {
      method: 'POST',
      body: {
        order_id: unclaimedId,
        order_status: 'paid',
        Customer: { email: 'cliente_desconhecido@teste.com' }
      }
    });
    assert.strictEqual(whRes.status, 200);
    const token = whRes.data.data.claim_token;
    assert.ok(token);

    // Resgate com login do Tenant B
    const claimRes = await request('/api/plans/claim-purchase', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenB}` },
      body: { claimToken: token }
    });
    assert.strictEqual(claimRes.status, 200);
    assert.strictEqual(claimRes.data.data.plano, 'VITALICIO');

    const orgB = organizationsDb.findById(tenantB.id);
    assert.strictEqual(orgB.plano, 'VITALICIO');
  });

  // ----------------------------------------------------
  // TESTE 34: [Persistência] Auto-Reidratação de Documentos Pós-Deleção Efêmera
  // ----------------------------------------------------
  await test('34. [Persistência] Auto-Reidratação transparente e integridade SHA-256...', async () => {
    const { StorageService } = await import('../backend/services/storage_service.js');
    const { documentsDb } = await import('../backend/database/index.js');
    const crypto = (await import('crypto')).default;
    const fs = (await import('fs')).default;

    const sampleBuf = Buffer.from('%PDF-1.4 TESTE DE PERSISTENCIA RUN_ALL', 'utf-8');
    const sampleSha = crypto.createHash('sha256').update(sampleBuf).digest('hex');

    const saved = await StorageService.saveFile({
      documentId: 'doc_runall_persist_1',
      tenantId: tenantA.id,
      buffer: sampleBuf,
      mimeType: 'application/pdf',
      originalName: 'teste_persist.pdf',
      relativePath: `storage/private/${tenantA.id}/proc_runall/teste_persist.pdf`
    });

    documentsDb.insert({
      id: 'doc_runall_persist_1',
      tenantId: tenantA.id,
      processId: processA.id,
      itemId: 'item_adm_1',
      originalName: 'teste_persist.pdf',
      mimeType: 'application/pdf',
      sizeBytes: sampleBuf.length,
      storagePath: saved.relativePath,
      sha256: sampleSha
    });

    // Simula remoção do disco efêmero
    const localP = StorageService.resolveLocalPath(saved.relativePath);
    if (fs.existsSync(localP)) fs.unlinkSync(localP);
    assert.strictEqual(fs.existsSync(localP), false);

    // Recupera via getFileBuffer (reidratação)
    const rehydrated = await StorageService.getFileBuffer('doc_runall_persist_1', tenantA.id);
    assert.ok(rehydrated);
    assert.strictEqual(rehydrated.sha256, sampleSha);
    assert.ok(fs.existsSync(localP), 'Deve recriar arquivo físico em disco');

    // Limpeza
    await StorageService.deleteFile('doc_runall_persist_1', tenantA.id);
    documentsDb.delete('doc_runall_persist_1');
  });

  // ----------------------------------------------------
  // TESTE 35: [Analytics & Funil] Endpoint Administrativo GET /api/admin/metrics
  // ----------------------------------------------------
  await test('35. [Analytics & Funil] Endpoint Administrativo GET /api/admin/metrics e cálculo do funil...', async () => {
    // 35.1 - Chamada desprotegida deve retornar 401
    const unauthRes = await request('/api/admin/metrics');
    assert.strictEqual(unauthRes.status, 401);
    assert.strictEqual(unauthRes.data.error.code, 'ADMIN_UNAUTHORIZED');

    // 35.2 - Tentativa via query param ?key= (bloqueada: HTTP 401)
    const queryParamRes = await request('/api/admin/metrics?key=documentocerto_admin_migrate_2026');
    assert.strictEqual(queryParamRes.status, 401);

    // 35.3 - Tenant Admin comum sem x-admin-key (bloqueado com HTTP 403 PLATFORM_KEY_REQUIRED)
    const tenantAdminRes = await request('/api/admin/metrics', {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert.strictEqual(tenantAdminRes.status, 403);
    assert.strictEqual(tenantAdminRes.data.error.code, 'PLATFORM_KEY_REQUIRED');

    // 35.4 - Chamada com x-admin-key válida pelo Operador de Plataforma (HTTP 200 OK)
    const adminKey = process.env.ADMIN_KEY || 'documentocerto_admin_migrate_2026';
    const metricsRes = await request('/api/admin/metrics', {
      headers: { 'x-admin-key': adminKey }
    });
    assert.strictEqual(metricsRes.status, 200);
    assert.strictEqual(metricsRes.data.success, true);

    const m = metricsRes.data.data;
    assert.ok(m.funil, 'Deve conter bloco do funil');
    assert.ok(typeof m.funil.totalCadastros === 'number');
    assert.ok(typeof m.funil.vitaliciosAtivos === 'number');
    assert.ok(m.funil.taxaConversao);
    assert.ok(m.financeiro, 'Deve conter métricas financeiras');
    assert.ok(typeof m.financeiro.receitaTotalBruta === 'number');
    assert.ok(typeof m.financeiro.receitaLiquida === 'number');
    assert.ok(Array.isArray(m.ultimasTransacoes));
  });

  // ----------------------------------------------------
  // TESTE 36: [Fase 4] Webhook Kiwify: Estorno/Reembolso revoga acesso Vitalício
  // ----------------------------------------------------
  await test('36. [Fase 4] Webhook Kiwify: Estorno/Reembolso revoga acesso Vitalício...', async () => {
    const refundRes = await request(`/api/webhooks/kiwify?token=secret_test_token_2026`, {
      method: 'POST',
      body: {
        order_id: kwOrderId,
        order_status: 'refunded',
        Customer: { email: userA.email }
      }
    });

    assert.strictEqual(refundRes.status, 200);
    assert.strictEqual(refundRes.data.plano_revogado, true);

    const orgA = organizationsDb.findById(tenantA.id);
    assert.strictEqual(orgA.plano, 'GRATIS');
    assert.strictEqual(orgA.trialAtivo, false);
  });

  // Finalização do servidor de teste
  server.close();

  console.log('\n====================================================');
  console.log(`📊 RESULTADO FINAL DOS TESTES:`);
  console.log(`   Total executados: ${passed + failed}`);
  console.log(`   ✅ Aprovados:     ${passed}`);
  console.log(`   ❌ Reprovados:    ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch(err => {
  console.error('Falha crítica na execução dos testes:', err);
  if (server) server.close();
  process.exit(1);
});
