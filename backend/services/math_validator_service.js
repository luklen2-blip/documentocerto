/**
 * MathValidatorService
 * Validação matemática estrita de CPF e CNPJ pelo algoritmo de Módulo 11 (Receita Federal / Bacen).
 */

export class MathValidatorService {
  /**
   * Valida matematicamente um CPF.
   * @param {string} rawCpf
   * @returns {{ status: 'VALIDO'|'INVALIDO'|'NAO_IDENTIFICADO', label: string, isValid: boolean, cleanCpf: string|null }}
   */
  static validateCpf(rawCpf) {
    if (!rawCpf || typeof rawCpf !== 'string') {
      return { status: 'NAO_IDENTIFICADO', label: 'CPF não identificado', isValid: false, cleanCpf: null };
    }

    const clean = rawCpf.replace(/\D/g, '');

    if (clean.length !== 11) {
      return { status: 'NAO_IDENTIFICADO', label: 'CPF não identificado', isValid: false, cleanCpf: null };
    }

    // Rejeita sequências de dígitos todos iguais conhecidas (ex: 111.111.111-11)
    if (/^(\d)\1{10}$/.test(clean)) {
      return { status: 'INVALIDO', label: 'CPF inválido', isValid: false, cleanCpf: clean };
    }

    // Primeiro dígito verificador
    let sum1 = 0;
    for (let i = 0; i < 9; i++) {
      sum1 += parseInt(clean.charAt(i), 10) * (10 - i);
    }
    let rest1 = sum1 % 11;
    let digit1 = rest1 < 2 ? 0 : 11 - rest1;
    if (digit1 !== parseInt(clean.charAt(9), 10)) {
      return { status: 'INVALIDO', label: 'CPF inválido', isValid: false, cleanCpf: clean };
    }

    // Segundo dígito verificador
    let sum2 = 0;
    for (let i = 0; i < 10; i++) {
      sum2 += parseInt(clean.charAt(i), 10) * (11 - i);
    }
    let rest2 = sum2 % 11;
    let digit2 = rest2 < 2 ? 0 : 11 - rest2;
    if (digit2 !== parseInt(clean.charAt(10), 10)) {
      return { status: 'INVALIDO', label: 'CPF inválido', isValid: false, cleanCpf: clean };
    }

    return { status: 'VALIDO', label: 'CPF válido', isValid: true, cleanCpf: clean };
  }

  /**
   * Valida matematicamente um CNPJ.
   * @param {string} rawCnpj
   * @returns {{ status: 'VALIDO'|'INVALIDO'|'NAO_IDENTIFICADO', label: string, isValid: boolean, cleanCnpj: string|null }}
   */
  static validateCnpj(rawCnpj) {
    if (!rawCnpj || typeof rawCnpj !== 'string') {
      return { status: 'NAO_IDENTIFICADO', label: 'CNPJ não identificado', isValid: false, cleanCpf: null };
    }

    const clean = rawCnpj.replace(/\D/g, '');

    if (clean.length !== 14) {
      return { status: 'NAO_IDENTIFICADO', label: 'CNPJ não identificado', isValid: false, cleanCnpj: null };
    }

    // Rejeita sequências repetidas
    if (/^(\d)\1{13}$/.test(clean)) {
      return { status: 'INVALIDO', label: 'CNPJ inválido', isValid: false, cleanCnpj: clean };
    }

    // Primeiro dígito verificador
    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum1 = 0;
    for (let i = 0; i < 12; i++) {
      sum1 += parseInt(clean.charAt(i), 10) * weights1[i];
    }
    let rest1 = sum1 % 11;
    let digit1 = rest1 < 2 ? 0 : 11 - rest1;
    if (digit1 !== parseInt(clean.charAt(12), 10)) {
      return { status: 'INVALIDO', label: 'CNPJ inválido', isValid: false, cleanCnpj: clean };
    }

    // Segundo dígito verificador
    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum2 = 0;
    for (let i = 0; i < 13; i++) {
      sum2 += parseInt(clean.charAt(i), 10) * weights2[i];
    }
    let rest2 = sum2 % 11;
    let digit2 = rest2 < 2 ? 0 : 11 - rest2;
    if (digit2 !== parseInt(clean.charAt(13), 10)) {
      return { status: 'INVALIDO', label: 'CNPJ inválido', isValid: false, cleanCnpj: clean };
    }

    return { status: 'VALIDO', label: 'CNPJ válido', isValid: true, cleanCnpj: clean };
  }
}
