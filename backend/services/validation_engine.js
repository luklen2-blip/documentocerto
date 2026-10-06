import crypto from 'crypto';
import { NormalizerService } from './normalizer_service.js';
import { MathValidatorService } from './math_validator_service.js';

export const SEVERITY = {
  HIGH: 'HIGH',       // 🔴 POSSÍVEL PROBLEMA
  MEDIUM: 'MEDIUM',   // 🟡 REQUER ATENÇÃO
  LOW: 'LOW',         // ⚪ AVISO INFORMATIVO
  INFO: 'INFO'        // 🟢 OK / CONFORMIDADE
};

export const CLASSIFICATION = {
  CONSISTENTE: 'APARENTEMENTE CONSISTENTE',
  ATENCAO: 'REQUER ATENÇÃO',
  PROBLEMA: 'POSSÍVEL PROBLEMA',
  NAO_CONCLUIDO: 'NÃO CONCLUÍDO'
};

export class ValidationEngine {
  /**
   * Executa a bateria de regras determinísticas em um processo.
   * @param {object} params
   * @param {object} params.process Processo com seus itens
   * @param {Array<object>} params.documents Documentos anexados
   * @param {Array<object>} params.extractedFields Todos os campos extraídos de todos os documentos
   * @param {Array<object>} params.ocrResults Resultados do OCR de cada documento
   * @returns {object} Relatório de conferência determinístico
   */
  static run({ process: proc, documents = [], extractedFields = [], ocrResults = [] }) {
    const findings = [];
    const deductions = [];

    // 1. Regra de Documentos Obrigatórios (RequiredDocumentRule)
    this._runRequiredDocumentRule(proc, findings, deductions);

    // 2. Regra de Duplicidade Criptográfica (DuplicateRule)
    this._runDuplicateRule(documents, ocrResults, findings, deductions);

    // 3. Regra de Legibilidade e Qualidade (LegibilityRule)
    this._runLegibilityRule(documents, ocrResults, findings, deductions);

    // 4. Regra de Validação Matemática de CPF (CPFRule)
    this._runCpfRule(extractedFields, findings, deductions);

    // 5. Regra de Validação Matemática de CNPJ (CNPJRule)
    this._runCnpjRule(extractedFields, findings, deductions);

    // 6. Regra de Datas e Sanidade Temporal (DateRule & ExpirationRule)
    this._runDateRules(extractedFields, findings, deductions);

    // 7. Regra MANDATÓRIA de Consistência Cruzada (CrossDocumentConsistencyRule)
    this._runCrossDocumentConsistencyRule(extractedFields, findings, deductions);

    // Cálculo do Índice de Conferência (0 a 100)
    let score = 100;
    deductions.forEach(d => {
      score -= d.points;
    });
    score = Math.max(0, Math.min(100, score));

    // Classificação Geral
    let overallStatus = CLASSIFICATION.CONSISTENTE;
    const hasHigh = findings.some(f => f.severity === SEVERITY.HIGH);
    const hasMedium = findings.some(f => f.severity === SEVERITY.MEDIUM);

    if (documents.length === 0) {
      overallStatus = CLASSIFICATION.NAO_CONCLUIDO;
    } else if (hasHigh) {
      overallStatus = CLASSIFICATION.PROBLEMA;
    } else if (hasMedium) {
      overallStatus = CLASSIFICATION.ATENCAO;
    } else {
      overallStatus = CLASSIFICATION.CONSISTENTE;
    }

    return {
      status: overallStatus,
      score,
      scoreMax: 100,
      deductions,
      findings,
      totalFindings: findings.length,
      analyzedDocumentsCount: documents.length,
      extractedFieldsCount: extractedFields.length,
      disclaimer: 'O DocumentoCerto auxilia na conferência prévia dos documentos. A análise automática é estritamente orientativa e não substitui a validação profissional, jurídica ou administrativa.'
    };
  }

  // ================= 1. DOCUMENTOS OBRIGATÓRIOS =================
  static _runRequiredDocumentRule(proc, findings, deductions) {
    if (!proc || !Array.isArray(proc.itens)) return;

    const missingRequired = proc.itens.filter(i => i.obrigatorio && !i.documentoId);
    if (missingRequired.length > 0) {
      const names = missingRequired.map(i => i.nome).join(', ');
      findings.push({
        id: `fnd_${crypto.randomUUID()}`,
        severity: SEVERITY.HIGH,
        code: 'REQUIRED_DOCUMENTS_MISSING',
        title: 'Documentos obrigatórios ausentes',
        message: `Existem ${missingRequired.length} item(ns) obrigatório(s) não anexado(s): ${names}.`,
        recommendation: 'Anexe todos os documentos exigidos pelo checklist antes do envio.',
        evidence: []
      });
      deductions.push({
        factor: 'Documentos obrigatórios ausentes no processo',
        points: Math.min(30, missingRequired.length * 15)
      });
    }
  }

  // ================= 2. DUPLICIDADE CRIPTOGRÁFICA =================
  static _runDuplicateRule(documents, ocrResults, findings, deductions) {
    const hashes = new Map();

    ocrResults.forEach(res => {
      const hash = res.metadata?.fileHash;
      if (!hash) return;

      if (hashes.has(hash)) {
        const previous = hashes.get(hash);
        findings.push({
          id: `fnd_${crypto.randomUUID()}`,
          severity: SEVERITY.MEDIUM,
          code: 'DUPLICATE_DOCUMENT',
          title: 'Documento duplicado identificado',
          message: `O arquivo "${res.documentName}" possui conteúdo idêntico (hash SHA-256) ao arquivo "${previous.documentName}".`,
          recommendation: 'Verifique se o mesmo arquivo foi enviado duas vezes por engano.',
          document_id: res.documentId,
          document_name: res.documentName,
          comparison: {
            currentDoc: res.documentName,
            duplicatedWith: previous.documentName,
            sha256: hash
          },
          evidence: []
        });
        deductions.push({ factor: `Documento duplicado: ${res.documentName}`, points: 10 });
      } else {
        hashes.set(hash, res);
      }
    });
  }

  // ================= 3. LEGIBILIDADE E QUALIDADE =================
  static _runLegibilityRule(documents, ocrResults, findings, deductions) {
    ocrResults.forEach(res => {
      const isLowConfidence = res.confidence < 0.5;
      const isLowResolution = res.metadata?.legibilityStatus === 'LOW_RESOLUTION';
      const noText = !res.text || res.text.trim().length === 0;

      if (isLowResolution || (isLowConfidence && noText)) {
        findings.push({
          id: `fnd_${crypto.randomUUID()}`,
          severity: SEVERITY.MEDIUM,
          code: 'LEGIBILITY_ISSUE',
          title: 'Possível problema de legibilidade ou arquivo vazio',
          message: `Não foi possível extrair informações suficientes do documento "${res.documentName}".`,
          recommendation: 'Verifique a nitidez e resolução do arquivo antes do protocolo.',
          document_id: res.documentId,
          document_name: res.documentName,
          evidence: []
        });
        deductions.push({ factor: `Legibilidade baixa: ${res.documentName}`, points: 10 });
      }
    });
  }

  // ================= 4. VALIDAÇÃO MATEMÁTICA DE CPF =================
  static _runCpfRule(extractedFields, findings, deductions) {
    const cpfs = extractedFields.filter(f => f.field === 'cpf');
    cpfs.forEach(field => {
      const val = field.validation;
      if (val && val.status === 'INVALIDO') {
        findings.push({
          id: `fnd_${crypto.randomUUID()}`,
          severity: SEVERITY.HIGH,
          code: 'INVALID_CPF',
          title: 'CPF com dígitos verificadores inválidos',
          message: `O CPF "${field.value}" no documento "${field.document_name}" não é matematicamente válido.`,
          recommendation: 'Verifique o número de CPF no documento original para evitar rejeição cadastral.',
          document_id: field.document_id,
          document_name: field.document_name,
          page: field.page,
          evidence: [field]
        });
        deductions.push({ factor: `CPF inválido no documento ${field.document_name}`, points: 20 });
      }
    });
  }

  // ================= 5. VALIDAÇÃO MATEMÁTICA DE CNPJ =================
  static _runCnpjRule(extractedFields, findings, deductions) {
    const cnpjs = extractedFields.filter(f => f.field === 'cnpj');
    cnpjs.forEach(field => {
      const val = field.validation;
      if (val && val.status === 'INVALIDO') {
        findings.push({
          id: `fnd_${crypto.randomUUID()}`,
          severity: SEVERITY.HIGH,
          code: 'INVALID_CNPJ',
          title: 'CNPJ com dígitos verificadores inválidos',
          message: `O CNPJ "${field.value}" no documento "${field.document_name}" não é matematicamente válido.`,
          recommendation: 'Verifique se os dígitos do CNPJ foram digitados ou extraídos corretamente.',
          document_id: field.document_id,
          document_name: field.document_name,
          page: field.page,
          evidence: [field]
        });
        deductions.push({ factor: `CNPJ inválido no documento ${field.document_name}`, points: 20 });
      }
    });
  }

  // ================= 6. DATAS E SANIDADE TEMPORAL =================
  static _runDateRules(extractedFields, findings, deductions) {
    const today = new Date().toISOString().slice(0, 10);

    // Validação de Vencimento
    const validades = extractedFields.filter(f => f.field === 'data_validade' && f.normalized_value);
    validades.forEach(field => {
      if (field.normalized_value < today) {
        findings.push({
          id: `fnd_${crypto.randomUUID()}`,
          severity: SEVERITY.HIGH,
          code: 'EXPIRED_DOCUMENT',
          title: 'Documento vencido',
          message: `A data de validade "${field.value}" no documento "${field.document_name}" é anterior à data de hoje.`,
          recommendation: 'Solicite uma certidão ou via atualizada do documento.',
          document_id: field.document_id,
          document_name: field.document_name,
          page: field.page,
          evidence: [field]
        });
        deductions.push({ factor: `Documento vencido: ${field.document_name}`, points: 25 });
      }
    });

    // Validação de Data de Emissão Futura
    const emissoes = extractedFields.filter(f => f.field === 'data_emissao' && f.normalized_value);
    emissoes.forEach(field => {
      if (field.normalized_value > today) {
        findings.push({
          id: `fnd_${crypto.randomUUID()}`,
          severity: SEVERITY.HIGH,
          code: 'FUTURE_ISSUE_DATE',
          title: 'Data de emissão posterior à data atual',
          message: `A data de emissão "${field.value}" no documento "${field.document_name}" está no futuro.`,
          recommendation: 'Verifique se houve erro de digitação ou leitura na data de emissão.',
          document_id: field.document_id,
          document_name: field.document_name,
          page: field.page,
          evidence: [field]
        });
        deductions.push({ factor: `Data de emissão no futuro em ${field.document_name}`, points: 15 });
      }
    });
  }

  // ================= 7. CONFERÊNCIA CRUZADA ENTRE DOCUMENTOS =================
  static _runCrossDocumentConsistencyRule(extractedFields, findings, deductions) {
    // 7.1 - Comparação de Nomes entre Documentos
    const names = extractedFields.filter(f => f.field === 'nome_completo' && f.normalized_value);
    if (names.length >= 2) {
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const docA = names[i];
          const docB = names[j];

          // Compara apenas documentos diferentes
          if (docA.document_id !== docB.document_id) {
            const isMatch = NormalizerService.compareNames(docA.normalized_value, docB.normalized_value);
            if (!isMatch) {
              findings.push({
                id: `fnd_${crypto.randomUUID()}`,
                severity: SEVERITY.HIGH,
                code: 'NAME_MISMATCH',
                title: 'Possível divergência de nome entre documentos',
                message: `Nome encontrado em "${docA.document_name}" ("${docA.value}") difere do nome em "${docB.document_name}" ("${docB.value}").`,
                recommendation: 'Verifique se ambos os documentos pertencem ao mesmo titular antes de protocolar.',
                document_id: docA.document_id,
                document_name: docA.document_name,
                comparison: {
                  docA: { name: docA.document_name, value: docA.value, page: docA.page },
                  docB: { name: docB.document_name, value: docB.value, page: docB.page }
                },
                evidence: [docA, docB]
              });
              deductions.push({
                factor: `Divergência de nome entre ${docA.document_name} e ${docB.document_name}`,
                points: 25
              });
              return; // Reporta a primeira divergência crítica de nome para evitar flood
            }
          }
        }
      }
    }

    // 7.2 - Comparação de CPFs entre Documentos
    const validCpfs = extractedFields.filter(f => f.field === 'cpf' && f.normalized_value && f.validation?.isValid);
    if (validCpfs.length >= 2) {
      for (let i = 0; i < validCpfs.length; i++) {
        for (let j = i + 1; j < validCpfs.length; j++) {
          const docA = validCpfs[i];
          const docB = validCpfs[j];

          if (docA.document_id !== docB.document_id && docA.normalized_value !== docB.normalized_value) {
            findings.push({
              id: `fnd_${crypto.randomUUID()}`,
              severity: SEVERITY.HIGH,
              code: 'CPF_MISMATCH',
              title: 'Possível divergência de CPF entre documentos',
              message: `CPF encontrado em "${docA.document_name}" (${NormalizerService.formatCpf(docA.normalized_value)}) não coincide com o CPF em "${docB.document_name}" (${NormalizerService.formatCpf(docB.normalized_value)}).`,
              recommendation: 'Verifique qual documento possui o CPF correto para evitar nulidade do processo.',
              document_id: docA.document_id,
              document_name: docA.document_name,
              comparison: {
                docA: { name: docA.document_name, value: NormalizerService.formatCpf(docA.normalized_value), page: docA.page },
                docB: { name: docB.document_name, value: NormalizerService.formatCpf(docB.normalized_value), page: docB.page }
              },
              evidence: [docA, docB]
            });
            deductions.push({
              factor: `Divergência de CPF entre ${docA.document_name} e ${docB.document_name}`,
              points: 25
            });
            return;
          }
        }
      }
    }

    // 7.3 - Comparação de CNPJs entre Documentos
    const validCnpjs = extractedFields.filter(f => f.field === 'cnpj' && f.normalized_value && f.validation?.isValid);
    if (validCnpjs.length >= 2) {
      for (let i = 0; i < validCnpjs.length; i++) {
        for (let j = i + 1; j < validCnpjs.length; j++) {
          const docA = validCnpjs[i];
          const docB = validCnpjs[j];

          if (docA.document_id !== docB.document_id && docA.normalized_value !== docB.normalized_value) {
            findings.push({
              id: `fnd_${crypto.randomUUID()}`,
              severity: SEVERITY.HIGH,
              code: 'CNPJ_MISMATCH',
              title: 'Possível divergência de CNPJ entre documentos',
              message: `CNPJ encontrado em "${docA.document_name}" (${NormalizerService.formatCnpj(docA.normalized_value)}) difere do CNPJ em "${docB.document_name}" (${NormalizerService.formatCnpj(docB.normalized_value)}).`,
              recommendation: 'Confira a razão social e número de CNPJ nos documentos societários.',
              document_id: docA.document_id,
              document_name: docA.document_name,
              comparison: {
                docA: { name: docA.document_name, value: NormalizerService.formatCnpj(docA.normalized_value), page: docA.page },
                docB: { name: docB.document_name, value: NormalizerService.formatCnpj(docB.normalized_value), page: docB.page }
              },
              evidence: [docA, docB]
            });
            deductions.push({
              factor: `Divergência de CNPJ entre ${docA.document_name} e ${docB.document_name}`,
              points: 25
            });
            return;
          }
        }
      }
    }
  }
}
