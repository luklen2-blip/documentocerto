import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { OCRProvider } from './ocr_provider.js';

export class LocalOCRProvider extends OCRProvider {
  constructor() {
    super('LocalOCRProvider');
  }

  /**
   * Extração de texto e análise de legibilidade para PDFs e Imagens.
   */
  async extractText(filePath, mimeType, options = {}) {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        text: '',
        pages: [],
        confidence: 0,
        source: 'LOCAL_OCR',
        metadata: {},
        error: 'Arquivo físico não encontrado no servidor.'
      };
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const fileSize = fileBuffer.length;

    // 1. Processamento de PDF
    if (mimeType === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf')) {
      return this._processPdf(fileBuffer, fileHash, fileSize);
    }

    // 2. Processamento de Imagens (JPG, PNG)
    if (['image/jpeg', 'image/png', 'image/jpg'].includes(mimeType) ||
        /\.(jpe?g|png)$/i.test(filePath)) {
      return this._processImage(fileBuffer, mimeType, fileHash, fileSize);
    }

    return {
      success: false,
      text: '',
      pages: [],
      confidence: 0,
      source: 'LOCAL_OCR',
      metadata: { fileHash, fileSize },
      error: `Formato de arquivo ${mimeType} não suportado.`
    };
  }

  _processPdf(buffer, fileHash, fileSize) {
    // Validação básica do cabeçalho PDF
    const header = buffer.subarray(0, 10).toString('utf-8');
    if (!header.startsWith('%PDF-')) {
      return {
        success: false,
        text: '',
        pages: [],
        confidence: 0,
        source: 'PDF_READER',
        metadata: { fileHash, fileSize, status: 'CORRUPTED' },
        error: 'Arquivo PDF corrompido ou formato inválido.'
      };
    }

    // Extração direta de texto de streams do PDF
    try {
      const extractedPages = this._extractTextFromPdfBuffer(buffer);
      const fullText = extractedPages.map(p => p.text).join('\n\n').trim();

      if (fullText.length > 0) {
        return {
          success: true,
          text: fullText,
          pages: extractedPages,
          confidence: 0.95,
          source: 'PDF_TEXT',
          metadata: {
            fileHash,
            fileSize,
            pageCount: extractedPages.length,
            isScanned: false
          }
        };
      } else {
        // PDF digitalizado (apenas imagens escaneadas sem camada de texto)
        return {
          success: true,
          text: '',
          pages: [{ pageNumber: 1, text: '', confidence: 0.3 }],
          confidence: 0.3,
          source: 'SCANNED_PDF',
          metadata: {
            fileHash,
            fileSize,
            pageCount: 1,
            isScanned: true,
            warning: 'PDF digitalizado sem camada de texto selecionável.'
          }
        };
      }
    } catch (err) {
      return {
        success: false,
        text: '',
        pages: [],
        confidence: 0,
        source: 'PDF_READER',
        metadata: { fileHash, fileSize },
        error: `Erro ao processar estrutura interna do PDF: ${err.message}`
      };
    }
  }

  _extractTextFromPdfBuffer(buffer) {
    const raw = buffer.toString('binary');
    const pages = [];
    let pageCount = 1;

    // Busca blocos de texto no PDF (BT ... ET)
    const textPieces = [];

    // 1. Tenta extrair texto de streams descomprimidos
    const btRegex = /BT[\s\S]*?ET/g;
    let match;
    while ((match = btRegex.exec(raw)) !== null) {
      const block = match[0];
      const stringMatches = block.match(/\((.*?)\)\s*Tj|\[(.*?)\]\s*TJ/g);
      if (stringMatches) {
        for (const sm of stringMatches) {
          const text = sm.replace(/^\(/, '').replace(/\)\s*Tj$/, '')
                         .replace(/^\[/, '').replace(/\]\s*TJ$/, '')
                         .replace(/\\[nrtbf\\()]/g, ' ')
                         .trim();
          if (text) textPieces.push(text);
        }
      }
    }

    // 2. Tenta descomprimir streams FlateDecode se texto não foi encontrado diretamente
    if (textPieces.length === 0) {
      const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      let streamMatch;
      while ((streamMatch = streamRegex.exec(raw)) !== null) {
        const streamData = Buffer.from(streamMatch[1], 'binary');
        try {
          const decompressed = zlib.inflateSync(streamData);
          const decompStr = decompressed.toString('utf-8');
          const innerMatches = decompStr.match(/\((.*?)\)\s*Tj|\[(.*?)\]\s*TJ/g);
          if (innerMatches) {
            for (const im of innerMatches) {
              const text = im.replace(/^\(/, '').replace(/\)\s*Tj$/, '')
                             .replace(/^\[/, '').replace(/\]\s*TJ$/, '')
                             .replace(/\\[nrtbf\\()]/g, ' ')
                             .trim();
              if (text) textPieces.push(text);
            }
          } else {
            // Se o stream contiver texto legível simples
            const words = decompStr.match(/[A-Z0-9À-Úa-zà-ú/.,-]{3,}/g);
            if (words && words.length > 5) {
              textPieces.push(words.join(' '));
            }
          }
        } catch {}
      }
    }

    // 3. Fallback: extração de sequências de texto contidas no corpo do documento
    if (textPieces.length === 0) {
      const readableStrings = raw.match(/[A-Za-z0-9À-Úà-ú/.,-]{4,}/g);
      if (readableStrings) {
        const filtered = readableStrings.filter(s =>
          !['Font', 'Type', 'Pages', 'Parent', 'MediaBox', 'Resources', 'ProcSet', 'XObject'].includes(s)
        );
        if (filtered.length > 10) {
          textPieces.push(filtered.join(' '));
        }
      }
    }

    const pageText = textPieces.join(' ').replace(/\s+/g, ' ').trim();
    pages.push({
      pageNumber: 1,
      text: pageText,
      confidence: pageText.length > 0 ? 0.95 : 0.3
    });

    return pages;
  }

  _processImage(buffer, mimeType, fileHash, fileSize) {
    // Validação de magic bytes reais da imagem
    let isValidImage = false;
    let format = 'unknown';

    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      isValidImage = true;
      format = 'PNG';
    } else if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      isValidImage = true;
      format = 'JPEG';
    }

    if (!isValidImage) {
      return {
        success: false,
        text: '',
        pages: [],
        confidence: 0,
        source: 'IMAGE_VALIDATOR',
        metadata: { fileHash, fileSize },
        error: 'Arquivo de imagem inválido ou extensão incompatível com o conteúdo real.'
      };
    }

    // Heurística de legibilidade
    const isVerySmall = fileSize < 1024; // Menos de 1KB
    const legibilityStatus = isVerySmall ? 'LOW_RESOLUTION' : 'ACCEPTABLE';

    // Para imagens sem OCR em nuvem ativo, extrai metadados e texto se embutido (ex: EXIF)
    let extractedText = '';
    const raw = buffer.toString('binary');
    const textMatches = raw.match(/[A-Z0-9À-Úa-zà-ú/.,-]{5,}/g);
    if (textMatches && textMatches.length > 5) {
      extractedText = textMatches.slice(0, 50).join(' ');
    }

    return {
      success: true,
      text: extractedText,
      pages: [{
        pageNumber: 1,
        text: extractedText,
        confidence: isVerySmall ? 0.4 : (extractedText ? 0.8 : 0.5)
      }],
      confidence: isVerySmall ? 0.4 : (extractedText ? 0.8 : 0.6),
      source: 'IMAGE_ANALYZER',
      metadata: {
        fileHash,
        fileSize,
        format,
        legibilityStatus,
        requiresReview: isVerySmall || extractedText.length === 0
      }
    };
  }
}
