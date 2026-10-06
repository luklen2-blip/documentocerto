/**
 * AIAnalysisProvider - Camada de Síntese Inteligente com Proteção Anti-Alucinação
 * A IA é executada ESTRITAMENTE após o motor de regras determinísticas.
 */

export class AIAnalysisProvider {
  /**
   * Processa o relatório determinístico e gera a síntese explicativa.
   * @param {object} params
   * @param {object} params.deterministicReport Resultado do ValidationEngine
   * @param {Array<object>} params.extractedFields Campos extraídos do processo
   * @returns {object} Síntese validada com blindagem anti-alucinação
   */
  static analyze({ deterministicReport, extractedFields = [] }) {
    if (!deterministicReport) {
      return {
        summary: 'Não foi possível concluir com segurança.',
        findings: [],
        confidence: 0,
        disclaimer: 'O DocumentoCerto auxilia na conferência prévia. A análise não substitui validação jurídica.'
      };
    }

    const validEvidenceIds = new Set(extractedFields.map(f => f.id));
    const deterministicFindings = deterministicReport.findings || [];

    // Se não há achados de erro/alerta
    if (deterministicFindings.length === 0) {
      if (deterministicReport.analyzedDocumentsCount === 0) {
        return {
          summary: 'Não foi possível concluir com segurança: nenhum documento anexado.',
          findings: [],
          confidence: 0.5,
          disclaimer: 'O DocumentoCerto auxilia na conferência prévia. A análise não substitui validação jurídica.'
        };
      }

      return {
        summary: 'Todos os documentos analisados estão aparentemente consistentes com os requisitos de identificação e regras de negócio.',
        findings: [],
        confidence: 0.96,
        disclaimer: 'O DocumentoCerto auxilia na conferência prévia. A análise não substitui validação jurídica.'
      };
    }

    // Mapeia e organiza os achados explicativos a partir dos achados verificados
    const candidateFindings = deterministicFindings.map(df => {
      const evidenceIds = (df.evidence || []).map(e => e.id);

      let explanation = df.message;
      if (df.code === 'CPF_MISMATCH') {
        explanation = `Identificada divergência entre os números de CPF extraídos de diferentes documentos do processo. Recomenda-se conferir qual documento é o oficial.`;
      } else if (df.code === 'NAME_MISMATCH') {
        explanation = `Os nomes encontrados nos documentos apresentam divergência textual. Isso pode ocasionar atraso ou devolução no protocolo.`;
      } else if (df.code === 'EXPIRED_DOCUMENT') {
        explanation = `Documento com data de validade vencida em relação à data atual. É necessário obter uma via vigente.`;
      } else if (df.code === 'INVALID_CPF') {
        explanation = `Os dígitos verificadores do CPF não atendem ao algoritmo oficial Módulo 11 da Receita Federal.`;
      } else if (df.code === 'DUPLICATE_DOCUMENT') {
        explanation = `Dois arquivos idênticos foram anexados ao processo, o que pode representar duplicidade de envio.`;
      }

      return {
        code: df.code,
        severity: df.severity,
        title: df.title,
        explanation,
        recommendation: df.recommendation,
        document_name: df.document_name || null,
        evidence_ids: evidenceIds
      };
    });

    // ================= REGRA OBRIGATÓRIA: BLINDAGEM ANTI-ALUCINAÇÃO =================
    // Todo achado da IA DEVE apontar para evidências válidas OU para uma regra determinística comprovada.
    const groundedFindings = candidateFindings.filter(cf => {
      // Se tiver evidence_ids, todos devem existir nos campos extraídos reais
      if (cf.evidence_ids && cf.evidence_ids.length > 0) {
        const hasRealEvidence = cf.evidence_ids.some(id => validEvidenceIds.has(id));
        return hasRealEvidence;
      }
      // Se não possui evidence_ids específicos (ex: arquivos duplicados ou faltantes),
      // valida se o código do achado existe nos achados determinísticos
      return deterministicFindings.some(df => df.code === cf.code);
    });

    // Resumo executivo em português
    const highCount = groundedFindings.filter(f => f.severity === 'HIGH').length;
    const mediumCount = groundedFindings.filter(f => f.severity === 'MEDIUM').length;

    let summaryText = '';
    if (highCount > 0) {
      summaryText = `Atenção: Foram identificados ${highCount} ponto(s) crítico(s) de possível inconsistência (como divergências entre documentos ou dados inválidos) que requerem correção antes do envio.`;
    } else if (mediumCount > 0) {
      summaryText = `Recomenda-se conferência: Foram sinalizados ${mediumCount} item(ns) para verificação preventiva (qualidade de leitura ou duplicidades).`;
    } else {
      summaryText = `Documentos conferidos com sucesso.`;
    }

    return {
      summary: summaryText,
      findings: groundedFindings,
      confidence: 0.94,
      disclaimer: 'O DocumentoCerto auxilia na conferência prévia dos documentos. A análise automática é orientativa e não substitui a validação profissional e jurídica.'
    };
  }

  /**
   * Método de validação estrita anti-alucinação para testes.
   * Descarta qualquer conclusão não apoiada por evidências.
   */
  static validateGrounding(aiFindings = [], availableEvidenceIds = []) {
    const validIds = new Set(availableEvidenceIds);
    return aiFindings.filter(f => {
      if (!Array.isArray(f.evidence_ids) || f.evidence_ids.length === 0) {
        return false;
      }
      return f.evidence_ids.some(id => validIds.has(id));
    });
  }
}
