import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { documentsDb, documentBlobsDb } from '../database/index.js';
import { isPostgresConfigured, query } from '../database/pg_pool.js';

export class StorageService {
  /**
   * Resolve o caminho físico no sistema de arquivos a partir de um caminho armazenado
   * (suporta tanto caminhos relativos universais quanto legados)
   */
  static resolveLocalPath(storedPath) {
    if (!storedPath) return null;
    if (path.isAbsolute(storedPath)) {
      // Se for absoluto mas pertencer a outro SO ou outro diretório raiz
      const match = storedPath.match(/storage[\\/]private[\\/].*$/);
      if (match) {
        return path.resolve(process.cwd(), match[0].replace(/\\/g, '/'));
      }
      return storedPath;
    }
    return path.resolve(process.cwd(), storedPath.replace(/\\/g, '/'));
  }

  /**
   * Converte qualquer caminho para o formato relativo universal padronizado
   */
  static toRelativeStoragePath(absoluteOrRelative) {
    if (!absoluteOrRelative) return '';
    const match = absoluteOrRelative.match(/storage[\\/]private[\\/].*$/);
    if (match) {
      return match[0].replace(/\\/g, '/');
    }
    const rel = path.relative(process.cwd(), absoluteOrRelative);
    return rel.replace(/\\/g, '/');
  }

  /**
   * Salva um arquivo no armazenamento local (cache) e persiste no PostgreSQL document_blobs
   */
  static async saveFile({ documentId, tenantId, buffer, mimeType, originalName, relativePath }) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      throw new Error('Buffer de arquivo inválido para armazenamento.');
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const fileSize = buffer.length;
    const blobId = `blob_${documentId}`;
    const base64Data = buffer.toString('base64');

    // 1. Garante que o cache local em disco exista
    const cleanRelative = this.toRelativeStoragePath(relativePath);
    const localPath = this.resolveLocalPath(cleanRelative);
    const dir = path.dirname(localPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(localPath, buffer);

    // 2. Persistência no repositório documentBlobsDb (compatibilidade imediata com JsonDB)
    try {
      const existing = documentBlobsDb.findById(blobId);
      if (existing) {
        documentBlobsDb.update(blobId, {
          documentId,
          tenantId,
          fileData: base64Data,
          mimeType,
          fileSize,
          sha256,
          storageProvider: isPostgresConfigured() ? 'postgres_blob' : 'local_blob'
        });
      } else {
        documentBlobsDb.insert({
          id: blobId,
          documentId,
          tenantId,
          fileData: base64Data,
          mimeType,
          fileSize,
          sha256,
          storageProvider: isPostgresConfigured() ? 'postgres_blob' : 'local_blob'
        });
      }
    } catch (e) {
      console.warn('[StorageService] Aviso no cache de blobs local:', e.message);
    }

    // 3. Persistência de alta durabilidade em PostgreSQL (BYTEA)
    if (isPostgresConfigured()) {
      try {
        await query(
          `INSERT INTO document_blobs 
            (id, document_id, tenant_id, file_data, mime_type, file_size, sha256, storage_provider, created_at, updated_at)
           VALUES 
            ($1, $2, $3, $4, $5, $6, $7, 'postgres_blob', NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET
            file_data = EXCLUDED.file_data,
            file_size = EXCLUDED.file_size,
            sha256 = EXCLUDED.sha256,
            updated_at = NOW()`,
          [blobId, documentId, tenantId, buffer, mimeType, fileSize, sha256]
        );

        // Atualiza hash sha256 na tabela documents
        await query(
          `UPDATE documents SET sha256 = $1, storage_path = $2 WHERE id = $3`,
          [sha256, cleanRelative, documentId]
        );
      } catch (err) {
        console.error(`[StorageService.saveFile] Erro ao persistir blob no PostgreSQL: ${err.message}`);
      }
    }

    return {
      sha256,
      fileSize,
      relativePath: cleanRelative,
      localPath
    };
  }

  /**
   * Obtém o buffer do arquivo com auto-reidratação caso o contêiner tenha sido reiniciado
   */
  static async getFileBuffer(documentId, tenantId) {
    const doc = documentsDb.findById(documentId);
    if (!doc) return null;

    if (doc.tenantId !== tenantId) {
      const err = new Error('Acesso negado: documento pertence a outro tenant.');
      err.code = 'CROSS_TENANT_ACCESS_DENIED';
      throw err;
    }

    const localPath = this.resolveLocalPath(doc.storagePath);

    // 1. Se existir no disco local, lê direto
    if (localPath && fs.existsSync(localPath)) {
      const buf = fs.readFileSync(localPath);
      return {
        buffer: buf,
        mimeType: doc.mimeType,
        originalName: doc.originalName,
        sha256: doc.sha256 || crypto.createHash('sha256').update(buf).digest('hex')
      };
    }

    // 2. Se não existir no disco (redeploy do Render), reidrata do PostgreSQL document_blobs ou fallback
    let buffer = null;
    let mimeType = doc.mimeType;
    let sha256 = doc.sha256;

    if (isPostgresConfigured()) {
      try {
        const res = await query(
          `SELECT file_data, mime_type, file_size, sha256 
           FROM document_blobs 
           WHERE document_id = $1 AND tenant_id = $2 
           LIMIT 1`,
          [documentId, tenantId]
        );

        if (res.rows.length > 0) {
          buffer = res.rows[0].file_data;
          mimeType = res.rows[0].mime_type || mimeType;
          sha256 = res.rows[0].sha256 || sha256;
        }
      } catch (err) {
        console.error(`[StorageService.getFileBuffer] Erro ao buscar blob no PostgreSQL: ${err.message}`);
      }
    }

    if (!buffer) {
      const fallbackEntry = documentBlobsDb.findById(`blob_${documentId}`) ||
                            documentBlobsDb.findOne(b => b.documentId === documentId && b.tenantId === tenantId);
      if (fallbackEntry && fallbackEntry.fileData) {
        buffer = Buffer.isBuffer(fallbackEntry.fileData) ? fallbackEntry.fileData : Buffer.from(fallbackEntry.fileData, 'base64');
        mimeType = fallbackEntry.mimeType || mimeType;
        sha256 = fallbackEntry.sha256 || sha256;
      }
    }

    if (buffer) {
      // Reidrata o cache em disco de forma resiliente
      if (localPath) {
        try {
          const dir = path.dirname(localPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(localPath, buffer);
        } catch (e) {
          console.warn('[StorageService] Falha ao recriar cache local (não impeditivo):', e.message);
        }
      }

      return {
        buffer,
        mimeType,
        originalName: doc.originalName,
        sha256: sha256 || crypto.createHash('sha256').update(buffer).digest('hex')
      };
    }

    return null;
  }

  /**
   * Obtém Readable Stream pronto para resposta HTTP com auto-reidratação
   */
  static async getFileStream(documentId, tenantId) {
    const doc = documentsDb.findById(documentId);
    if (!doc) return null;

    if (doc.tenantId !== tenantId) {
      const err = new Error('Acesso negado: documento pertence a outro tenant.');
      err.code = 'CROSS_TENANT_ACCESS_DENIED';
      throw err;
    }

    const localPath = this.resolveLocalPath(doc.storagePath);

    if (localPath && fs.existsSync(localPath)) {
      return {
        stream: fs.createReadStream(localPath),
        doc,
        source: 'LOCAL_CACHE'
      };
    }

    // Auto-reidratação a partir da camada persistente
    const fileData = await this.getFileBuffer(documentId, tenantId);
    if (fileData) {
      return {
        stream: Readable.from(fileData.buffer),
        doc: {
          ...doc,
          mimeType: fileData.mimeType,
          sha256: fileData.sha256
        },
        source: 'REHYDRATED'
      };
    }

    return null;
  }

  /**
   * Garante a presença física do arquivo no disco (usado pelo OCR e utilitários que demandam caminho físico)
   */
  static async ensureLocalFile(documentId, tenantId) {
    const doc = documentsDb.findById(documentId);
    if (!doc) return null;

    if (doc.tenantId !== tenantId) {
      const err = new Error('Acesso negado a este documento.');
      err.code = 'CROSS_TENANT_ACCESS_DENIED';
      throw err;
    }

    const localPath = this.resolveLocalPath(doc.storagePath);
    if (localPath && fs.existsSync(localPath)) {
      return localPath;
    }

    // Reidrata do banco para o caminho local
    const data = await this.getFileBuffer(documentId, tenantId);
    if (data && localPath) {
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(localPath, data.buffer);
      return localPath;
    }

    return null;
  }

  /**
   * Exclui o arquivo físico e o registro de blob persistente no PostgreSQL
   */
  static async deleteFile(documentId, tenantId) {
    const doc = documentsDb.findById(documentId);
    if (doc) {
      const localPath = this.resolveLocalPath(doc.storagePath);
      if (localPath && fs.existsSync(localPath)) {
        try { fs.unlinkSync(localPath); } catch {}
      }
    }

    documentBlobsDb.delete(`blob_${documentId}`);

    if (isPostgresConfigured()) {
      try {
        await query(
          `DELETE FROM document_blobs WHERE document_id = $1 AND tenant_id = $2`,
          [documentId, tenantId]
        );
      } catch (err) {
        console.error(`[StorageService.deleteFile] Erro ao deletar blob no PostgreSQL: ${err.message}`);
      }
    }

    return true;
  }
}
