import { NormalizerService } from './normalizer_service.js';
import { MathValidatorService } from './math_validator_service.js';
import crypto from 'crypto';

export class ExtractionService {
  /**
   * Extrai campos estruturados e gera evidências auditáveis para cada achado.
   * @param {object} params
   * @param {string} params.documentId
   * @param {string} params.documentName
   * @param {Array<{ pageNumber: number, text: string, confidence: number }>} params.pages
   * @param {string} params.source
   * @returns {Array<object>} Lista de campos extraídos com evidências
   */
  static extractFromDocument({ documentId, documentName, pages = [], source = 'OCR' }) {
    const extractedFields = [];

    pages.forEach(page => {
      const pageText = page.text || '';
      const pageNumber = page.pageNumber || 1;
      const baseConfidence = page.confidence || 0.9;

      // 1. CPF
      const cpfMatches = pageText.matchAll(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/g);
      for (const match of cpfMatches) {
        const raw = match[1];
        const validation = MathValidatorService.validateCpf(raw);
        const snippet = this._getSnippet(pageText, match.index, raw.length);
        extractedFields.push({
          id: `fld_${crypto.randomUUID()}`,
          document_id: documentId,
          document_name: documentName,
          page: pageNumber,
          field: 'cpf',
          value: raw,
          normalized_value: validation.cleanCpf || NormalizerService.normalizeCpf(raw),
          confidence: validation.isValid ? Math.min(baseConfidence, 0.98) : 0.85,
          source,
          snippet,
          validation: {
            isValid: validation.isValid,
            status: validation.status,
            label: validation.label
          }
        });
      }

      // 2. CNPJ
      const cnpjMatches = pageText.matchAll(/\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/g);
      for (const match of cnpjMatches) {
        const raw = match[1];
        const validation = MathValidatorService.validateCnpj(raw);
        const snippet = this._getSnippet(pageText, match.index, raw.length);
        extractedFields.push({
          id: `fld_${crypto.randomUUID()}`,
          document_id: documentId,
          document_name: documentName,
          page: pageNumber,
          field: 'cnpj',
          value: raw,
          normalized_value: validation.cleanCnpj || NormalizerService.normalizeCnpj(raw),
          confidence: validation.isValid ? Math.min(baseConfidence, 0.98) : 0.85,
          source,
          snippet,
          validation: {
            isValid: validation.isValid,
            status: validation.status,
            label: validation.label
          }
        });
      }

      // 3. Nome Completo (com âncoras contextuais)
      const nameAnchorRegex = /(?:NOME(?:\s+COMPLETO)?|TITULAR|CONTRATADO|COLABORADOR|RAZ[ÃA]O\s+SOCIAL)[\s:]+([A-ZÀ-Ú][A-ZÀ-Úa-zà-ú\s]{5,50})/gi;
      let nameMatch;
      while ((nameMatch = nameAnchorRegex.exec(pageText)) !== null) {
        const raw = nameMatch[1].trim().split(/[\n\r]/)[0].trim();
        // Garante que tenha ao menos duas palavras
        if (raw.includes(' ') && raw.length >= 6) {
          const snippet = this._getSnippet(pageText, nameMatch.index, nameMatch[0].length);
          extractedFields.push({
            id: `fld_${crypto.randomUUID()}`,
            document_id: documentId,
            document_name: documentName,
            page: pageNumber,
            field: 'nome_completo',
            value: raw,
            normalized_value: NormalizerService.normalizeName(raw),
            confidence: Math.min(baseConfidence, 0.94),
            source,
            snippet
          });
        }
      }

      // 4. RG e Número de Documento
      const rgRegex = /(?:RG|REGISTRO\s+GERAL|IDENTIDADE)[\s:]+([0-9][0-9.\-A-Za-z]{4,14})/gi;
      let rgMatch;
      while ((rgMatch = rgRegex.exec(pageText)) !== null) {
        const raw = rgMatch[1].trim();
        extractedFields.push({
          id: `fld_${crypto.randomUUID()}`,
          document_id: documentId,
          document_name: documentName,
          page: pageNumber,
          field: 'rg',
          value: raw,
          normalized_value: raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase(),
          confidence: Math.min(baseConfidence, 0.92),
          source,
          snippet: this._getSnippet(pageText, rgMatch.index, rgMatch[0].length)
        });
      }

      // 5. Data de Nascimento
      const nascRegex = /(?:DATA\s+DE\s+NASCIMENTO|NASCIDO\s+EM|NASCIMENTO)[\s:]+([0-3]?\d[\/\.-][0-1]?\d[\/\.-]\d{4})/gi;
      let nascMatch;
      while ((nascMatch = nascRegex.exec(pageText)) !== null) {
        const raw = nascMatch[1].trim();
        extractedFields.push({
          id: `fld_${crypto.randomUUID()}`,
          document_id: documentId,
          document_name: documentName,
          page: pageNumber,
          field: 'data_nascimento',
          value: raw,
          normalized_value: NormalizerService.normalizeDate(raw),
          confidence: Math.min(baseConfidence, 0.95),
          source,
          snippet: this._getSnippet(pageText, nascMatch.index, nascMatch[0].length)
        });
      }

      // 6. Data de Emissão
      const emissaoRegex = /(?:DATA\s+DE\s+EMISS[ÃA]O|EXPEDI[ÇC][ÃA]O|EMISS[ÃA]O)[\s:]+([0-3]?\d[\/\.-][0-1]?\d[\/\.-]\d{4})/gi;
      let emMatch;
      while ((emMatch = emissaoRegex.exec(pageText)) !== null) {
        const raw = emMatch[1].trim();
        extractedFields.push({
          id: `fld_${crypto.randomUUID()}`,
          document_id: documentId,
          document_name: documentName,
          page: pageNumber,
          field: 'data_emissao',
          value: raw,
          normalized_value: NormalizerService.normalizeDate(raw),
          confidence: Math.min(baseConfidence, 0.95),
          source,
          snippet: this._getSnippet(pageText, emMatch.index, emMatch[0].length)
        });
      }

      // 7. Data de Validade / Vencimento
      const validadeRegex = /(?:DATA\s+DE\s+VALIDADE|VALIDADE|VENCIMENTO|V[ÁA]LIDO\s+AT[ÉÉ])[\s:]+([0-3]?\d[\/\.-][0-1]?\d[\/\.-]\d{4})/gi;
      let valMatch;
      while ((valMatch = validadeRegex.exec(pageText)) !== null) {
        const raw = valMatch[1].trim();
        extractedFields.push({
          id: `fld_${crypto.randomUUID()}`,
          document_id: documentId,
          document_name: documentName,
          page: pageNumber,
          field: 'data_validade',
          value: raw,
          normalized_value: NormalizerService.normalizeDate(raw),
          confidence: Math.min(baseConfidence, 0.95),
          source,
          snippet: this._getSnippet(pageText, valMatch.index, valMatch[0].length)
        });
      }

      // 8. CEP
      const cepRegex = /(?:CEP)[\s:]+(\d{5}-?\d{3})\b/gi;
      let cepMatch;
      while ((cepMatch = cepRegex.exec(pageText)) !== null) {
        const raw = cepMatch[1].trim();
        extractedFields.push({
          id: `fld_${crypto.randomUUID()}`,
          document_id: documentId,
          document_name: documentName,
          page: pageNumber,
          field: 'cep',
          value: raw,
          normalized_value: raw.replace(/\D/g, ''),
          confidence: 0.96,
          source,
          snippet: this._getSnippet(pageText, cepMatch.index, cepMatch[0].length)
        });
      }

      // 9. E-mail
      const emailMatches = pageText.matchAll(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
      for (const match of emailMatches) {
        extractedFields.push({
          id: `fld_${crypto.randomUUID()}`,
          document_id: documentId,
          document_name: documentName,
          page: pageNumber,
          field: 'email',
          value: match[1],
          normalized_value: match[1].toLowerCase(),
          confidence: 0.95,
          source,
          snippet: this._getSnippet(pageText, match.index, match[1].length)
        });
      }

      // 10. Órgão Emissor
      const orgaoRegex = /\b(SSP(?:\/[A-Z]{2})?|DETRAN(?:\/[A-Z]{2})?|PF|PGFN|RFB|CREA|OAB|CRM)\b/gi;
      let orgaoMatch;
      while ((orgaoMatch = orgaoRegex.exec(pageText)) !== null) {
        extractedFields.push({
          id: `fld_${crypto.randomUUID()}`,
          document_id: documentId,
          document_name: documentName,
          page: pageNumber,
          field: 'orgao_emissor',
          value: orgaoMatch[1],
          normalized_value: orgaoMatch[1].toUpperCase(),
          confidence: 0.92,
          source,
          snippet: this._getSnippet(pageText, orgaoMatch.index, orgaoMatch[1].length)
        });
      }

      // 11. Tipo do Documento (Detecção Contextual)
      let detectedType = null;
      if (/REGISTRO\s+GERAL|CARTEIRA\s+DE\s+IDENTIDADE/i.test(pageText)) detectedType = 'RG';
      else if (/HABILITA[ÇC][ÃA]O|CNH/i.test(pageText)) detectedType = 'CNH';
      else if (/CADASTRO\s+NACIONAL\s+DA\s+PESSOA\s+JUR[ÍI]DICA|CART[ÃA]O\s+CNPJ/i.test(pageText)) detectedType = 'CARTAO_CNPJ';
      else if (/CERTID[ÃA]O\s+NEGATIVA|CND/i.test(pageText)) detectedType = 'CERTIDAO_NEGATIVA';
      else if (/CONTRATO\s+SOCIAL|ESTATUTO\s+SOCIAL/i.test(pageText)) detectedType = 'CONTRATO_SOCIAL';
      else if (/CONTRATO\s+DE\s+PRESTA[ÇC][ÃA]O|CONTRATO\s+DE\s+TRABALHO/i.test(pageText)) detectedType = 'CONTRATO';
      else if (/COMPROVANTE\s+DE\s+RESID[ÊE]NCIA|CONTA\s+DE\s+LUZ|CONTA\s+DE\s+[ÁA]GUA/i.test(pageText)) detectedType = 'COMPROVANTE_RESIDENCIA';

      if (detectedType) {
        extractedFields.push({
          id: `fld_${crypto.randomUUID()}`,
          document_id: documentId,
          document_name: documentName,
          page: pageNumber,
          field: 'tipo_documento',
          value: detectedType,
          normalized_value: detectedType,
          confidence: 0.9,
          source,
          snippet: `Identificado contexto de documento: ${detectedType}`
        });
      }
    });

    return extractedFields;
  }

  static _getSnippet(text, index, length, margin = 40) {
    const start = Math.max(0, index - margin);
    const end = Math.min(text.length, index + length + margin);
    return text.substring(start, end).replace(/\s+/g, ' ').trim();
  }
}
