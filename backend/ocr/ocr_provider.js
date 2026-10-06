/**
 * OCRProvider - Interface Base do Provedor de OCR
 * Define o contrato para extração de texto e metadados de documentos.
 */
export class OCRProvider {
  constructor(name = 'BaseOCRProvider') {
    this.name = name;
  }

  /**
   * Extrai texto e informações do arquivo.
   * @param {string} filePath Caminho absoluto do arquivo no disco
   * @param {string} mimeType Tipo MIME do arquivo (ex: application/pdf, image/jpeg, image/png)
   * @param {object} options Opções adicionais de processamento
   * @returns {Promise<{
   *   success: boolean,
   *   text: string,
   *   pages: Array<{ pageNumber: number, text: string, confidence: number }>,
   *   confidence: number,
   *   source: string,
   *   metadata: object,
   *   error?: string
   * }>}
   */
  async extractText(filePath, mimeType, options = {}) {
    throw new Error(`Método extractText() não implementado pelo provedor ${this.name}`);
  }

  getCapabilities() {
    return {
      name: this.name,
      supportsPdf: true,
      supportsImages: true,
      hasBoundingBoxes: false
    };
  }
}
