/**
 * NormalizerService
 * Padronização e higienização canônica para comparação de dados entre documentos.
 */

export class NormalizerService {
  /**
   * Normaliza CPF para apenas dígitos.
   */
  static normalizeCpf(rawCpf) {
    if (!rawCpf) return '';
    return String(rawCpf).replace(/\D/g, '');
  }

  /**
   * Formata CPF para exibição: 000.000.000-00
   */
  static formatCpf(cleanCpf) {
    const digits = String(cleanCpf).replace(/\D/g, '');
    if (digits.length !== 11) return cleanCpf;
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  /**
   * Normaliza CNPJ para apenas dígitos.
   */
  static normalizeCnpj(rawCnpj) {
    if (!rawCnpj) return '';
    return String(rawCnpj).replace(/\D/g, '');
  }

  /**
   * Formata CNPJ para exibição: 00.000.000/0000-00
   */
  static formatCnpj(cleanCnpj) {
    const digits = String(cleanCnpj).replace(/\D/g, '');
    if (digits.length !== 14) return cleanCnpj;
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }

  /**
   * Normaliza nome para comparação:
   * - remove espaços duplicados e nas extremidades
   * - converte para maiúsculas
   * - remove acentuação
   * Mantém o original para exibição.
   */
  static normalizeName(rawName) {
    if (!rawName) return '';
    return String(rawName)
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Compara se dois nomes são compatíveis.
   */
  static compareNames(nameA, nameB) {
    const normA = this.normalizeName(nameA);
    const normB = this.normalizeName(nameB);
    if (!normA || !normB) return false;
    return normA === normB;
  }

  /**
   * Normaliza datas no formato brasileiro (DD/MM/YYYY) para ISO (YYYY-MM-DD).
   */
  static normalizeDate(rawDate) {
    if (!rawDate) return null;
    const str = String(rawDate).trim();

    // DD/MM/YYYY ou DD-MM-YYYY
    const brMatch = str.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
    if (brMatch) {
      const day = brMatch[1].padStart(2, '0');
      const month = brMatch[2].padStart(2, '0');
      const year = brMatch[3];
      return `${year}-${month}-${day}`;
    }

    // YYYY-MM-DD
    const isoMatch = str.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})$/);
    if (isoMatch) {
      const year = isoMatch[1];
      const month = isoMatch[2].padStart(2, '0');
      const day = isoMatch[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    return null;
  }
}
