import { OCRProvider } from './ocr_provider.js';
import crypto from 'crypto';
import fs from 'fs';

/**
 * MockOCRProvider
 * ATENÇÃO: Este provedor é utilizado EXCLUSIVAMENTE em testes automatizados.
 * Não é utilizado no ambiente de produção.
 */
export class MockOCRProvider extends OCRProvider {
  constructor() {
    super('MockOCRProvider');
    this.customResponses = new Map();
  }

  setMockResponse(fileIdentifier, response) {
    this.customResponses.set(fileIdentifier, response);
  }

  clearMocks() {
    this.customResponses.clear();
  }

  async extractText(filePath, mimeType, options = {}) {
    // 1. Verifica se há mock específico para este arquivo
    const fileName = filePath ? filePath.split(/[/\\]/).pop() : '';
    if (this.customResponses.has(filePath)) {
      return this.customResponses.get(filePath);
    }
    if (this.customResponses.has(fileName)) {
      return this.customResponses.get(fileName);
    }

    // 2. Calcula hash real do arquivo para rastreamento determinístico
    let fileHash = 'mock_hash';
    let fileSize = 1024;
    try {
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        fileHash = crypto.createHash('sha256').update(buf).digest('hex');
        fileSize = buf.length;
      }
    } catch {}

    // 3. Resposta mock padrão para testes
    return {
      success: true,
      text: 'REPÚBLICA FEDERATIVA DO BRASIL\nREGISTRO GERAL\nNOME: JOAO DA SILVA\nCPF: 123.456.789-09\nDATA DE NASCIMENTO: 15/04/1985\nDATA DE EMISSÃO: 10/01/2020\nÓRGÃO EMISSOR: SSP/SP',
      pages: [
        {
          pageNumber: 1,
          text: 'REPÚBLICA FEDERATIVA DO BRASIL\nREGISTRO GERAL\nNOME: JOAO DA SILVA\nCPF: 123.456.789-09\nDATA DE NASCIMENTO: 15/04/1985\nDATA DE EMISSÃO: 10/01/2020\nÓRGÃO EMISSOR: SSP/SP',
          confidence: 0.98
        }
      ],
      confidence: 0.98,
      source: 'MOCK_OCR',
      metadata: {
        fileHash,
        fileSize,
        isMock: true
      }
    };
  }
}
