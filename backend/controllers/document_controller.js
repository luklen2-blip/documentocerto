import { documentsDb, processesDb } from '../database/index.js';
import { StatusService } from '../services/status_service.js';
import { AuditService } from '../services/audit_service.js';
import { StorageService } from '../services/storage_service.js';
import fs from 'fs';
import path from 'path';

export class DocumentController {
  static async upload(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_FILE', message: 'Nenhum arquivo válido foi enviado.' }
        });
      }

      const { processId, itemId } = req.body;
      if (!processId || !itemId) {
        // Remove arquivo temporário se requisição for inválida
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'ID do processo e ID do item são obrigatórios.' }
        });
      }

      const process = processesDb.findById(processId);
      if (!process) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(404).json({
          success: false,
          error: { code: 'PROCESS_NOT_FOUND', message: 'Processo não encontrado.' }
        });
      }

      // Verificação de isolamento multi-tenant
      if (process.tenantId !== req.user.tenantId) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(403).json({
          success: false,
          error: { code: 'CROSS_TENANT_ACCESS_DENIED', message: 'Acesso negado a este processo.' }
        });
      }

      const itens = process.itens || [];
      const itemIndex = itens.findIndex(it => it.id === itemId);
      if (itemIndex === -1) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(404).json({
          success: false,
          error: { code: 'ITEM_NOT_FOUND', message: 'Item do checklist não localizado no processo.' }
        });
      }

      const isSubstituicao = Boolean(itens[itemIndex].documentoId);
      const oldDocId = itens[itemIndex].documentoId;

      // Se for substituição, remove o documento anterior e seu blob persistente
      if (isSubstituicao && oldDocId) {
        const oldDoc = documentsDb.findById(oldDocId);
        if (oldDoc && oldDoc.tenantId === req.user.tenantId) {
          try {
            await StorageService.deleteFile(oldDocId, req.user.tenantId);
          } catch {}
          documentsDb.delete(oldDocId);
        }
      }

      // Lê os bytes do arquivo para armazenamento seguro
      const fileBuffer = fs.readFileSync(req.file.path);
      const relativeStoragePath = StorageService.toRelativeStoragePath(req.file.path);

      // Registra o novo documento
      const doc = documentsDb.insert({
        tenantId: req.user.tenantId,
        processId,
        itemId,
        originalName: req.file.originalname,
        storedFilename: req.file.filename,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        storagePath: relativeStoragePath,
        uploadedBy: req.user.id,
        uploadedByName: req.user.nome
      });

      // Persistência em alta durabilidade via StorageService (PostgreSQL BYTEA + SHA-256)
      const savedStorage = await StorageService.saveFile({
        documentId: doc.id,
        tenantId: req.user.tenantId,
        buffer: fileBuffer,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
        relativePath: relativeStoragePath
      });

      doc.sha256 = savedStorage.sha256;
      doc.storagePath = savedStorage.relativePath;
      documentsDb.update(doc.id, {
        sha256: savedStorage.sha256,
        storagePath: savedStorage.relativePath
      });

      // Atualiza o item do processo
      itens[itemIndex].documentoId = doc.id;
      itens[itemIndex].documento = {
        id: doc.id,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        uploadedAt: doc.createdAt,
        uploadedByName: doc.uploadedByName
      };
      itens[itemIndex].statusItem = 'presente';

      // Recalcula status geral determinístico
      const statusCalculado = StatusService.calculate(itens);

      const updatedProcess = processesDb.update(processId, {
        itens,
        statusDeterminístico: statusCalculado.status
      });

      // Registra auditoria
      AuditService.log({
        tenantId: req.user.tenantId,
        processId,
        userId: req.user.id,
        userName: req.user.nome,
        action: isSubstituicao ? 'DOCUMENTO_SUBSTITUIDO' : 'DOCUMENTO_ENVIADO',
        details: {
          documentoId: doc.id,
          nomeArquivo: doc.originalName,
          tamanho: doc.sizeBytes,
          itemNome: itens[itemIndex].nome
        }
      });

      return res.status(201).json({
        success: true,
        data: {
          document: doc,
          process: {
            ...updatedProcess,
            statusInfo: statusCalculado
          }
        },
        message: isSubstituicao ? 'Documento substituído com sucesso!' : 'Documento anexado com sucesso!'
      });
    } catch (err) {
      console.error('[DocumentController.upload]:', err);
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao processar upload do documento.' }
      });
    }
  }

  static async getFile(req, res) {
    try {
      const { id } = req.params;
      const doc = documentsDb.findById(id);

      if (!doc) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Documento não encontrado.' }
        });
      }

      // MANDATÓRIO: Verificação de isolamento multi-tenant
      if (doc.tenantId !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'CROSS_TENANT_ACCESS_DENIED',
            message: 'Acesso negado: este documento pertence a outra organização.'
          }
        });
      }

      // Recupera via StorageService com auto-reidratação resiliente
      const fileResult = await StorageService.getFileStream(id, req.user.tenantId);
      if (!fileResult || !fileResult.stream) {
        return res.status(404).json({
          success: false,
          error: { code: 'FILE_MISSING_ON_DISK', message: 'O arquivo físico não foi encontrado no armazenamento.' }
        });
      }

      res.setHeader('Content-Type', fileResult.doc.mimeType || doc.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileResult.doc.originalName || doc.originalName)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (fileResult.doc.sha256 || doc.sha256) {
        res.setHeader('ETag', `"${fileResult.doc.sha256 || doc.sha256}"`);
      }

      fileResult.stream.pipe(res);
    } catch (err) {
      if (err.code === 'CROSS_TENANT_ACCESS_DENIED') {
        return res.status(403).json({
          success: false,
          error: { code: 'CROSS_TENANT_ACCESS_DENIED', message: err.message }
        });
      }
      console.error('[DocumentController.getFile]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao ler arquivo do documento.' }
      });
    }
  }

  static async delete(req, res) {
    try {
      const { id } = req.params;
      const doc = documentsDb.findById(id);

      if (!doc) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Documento não encontrado.' }
        });
      }

      // Verificação de isolamento multi-tenant
      if (doc.tenantId !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          error: { code: 'CROSS_TENANT_ACCESS_DENIED', message: 'Acesso negado a este documento.' }
        });
      }

      // Verificação de papel: apenas ADMIN ou o usuário que enviou pode excluir
      if (req.user.papel !== 'ADMIN' && doc.uploadedBy !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Apenas administradores ou o remetente original podem excluir este documento.' }
        });
      }

      // Remove arquivo físico e blob persistente via StorageService
      try {
        await StorageService.deleteFile(id, req.user.tenantId);
      } catch (e) {
        console.warn('[DocumentController.delete] Aviso ao remover arquivo:', e.message);
      }

      // Atualiza o item do processo correspondente
      const process = processesDb.findById(doc.processId);
      if (process && process.tenantId === req.user.tenantId) {
        const itens = process.itens || [];
        const itemIndex = itens.findIndex(it => it.id === doc.itemId);
        if (itemIndex !== -1) {
          itens[itemIndex].documentoId = null;
          itens[itemIndex].documento = null;
          itens[itemIndex].statusItem = 'ausente';

          const statusCalculado = StatusService.calculate(itens);
          processesDb.update(process.id, {
            itens,
            statusDeterminístico: statusCalculado.status
          });
        }
      }

      documentsDb.delete(id);

      AuditService.log({
        tenantId: req.user.tenantId,
        processId: doc.processId,
        userId: req.user.id,
        userName: req.user.nome,
        action: 'DOCUMENTO_EXCLUIDO',
        details: { nomeArquivo: doc.originalName, itemId: doc.itemId }
      });

      return res.status(200).json({
        success: true,
        message: 'Documento excluído com sucesso.'
      });
    } catch (err) {
      console.error('[DocumentController.delete]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao excluir documento.' }
      });
    }
  }
}
