import { OCRProvider } from './ocr_provider.js';

export class CloudOCRProvider extends OCRProvider {
  constructor(apiKey = process.env.CLOUD_OCR_API_KEY, endpoint = process.env.CLOUD_OCR_ENDPOINT) {
    super('CloudOCRProvider');
    this.apiKey = apiKey;
    this.endpoint = endpoint;
  }

  async extractText(filePath, mimeType, options = {}) {
    if (!this.apiKey) {
      return {
        success: false,
        text: '',
        pages: [],
        confidence: 0,
        source: 'CLOUD_OCR',
        metadata: {},
        error: 'Chave de API do provedor em nuvem não configurada no ambiente.'
      };
    }

    // Adaptador preparado para Google Vision / AWS Textract
    return {
      success: false,
      text: '',
      pages: [],
      confidence: 0,
      source: 'CLOUD_OCR',
      metadata: { endpoint: this.endpoint },
      error: 'Provedor em nuvem em espera de ativação de credenciais de produção.'
    };
  }
}
