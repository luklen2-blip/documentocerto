import { processesDb, checklistsDb, documentsDb, organizationsDb } from '../database/index.js';
import { StatusService, STATUS_TYPES } from '../services/status_service.js';
import { AuditService } from '../services/audit_service.js';
import { StorageService } from '../services/storage_service.js';
import fs from 'fs';
import path from 'path';

export class ProcessController {
  static async list(req, res) {
    const tenantId = req.user.tenantId;
    const processes = processesDb.findAll(p => p.tenantId === tenantId);

    // Enriquece cada processo com status determinístico em tempo real
    const enriched = processes.map(p => {
      const statusCalculado = StatusService.calculate(p.itens || []);
      return {
        ...p,
        statusDeterminístico: statusCalculado.status,
        statusInfo: statusCalculado
      };
    });

    // Ordena pelo mais recente
    enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({
      success: true,
      data: enriched
    });
  }

  static async getById(req, res) {
    const { id } = req.params;
    const process = processesDb.findById(id);

    if (!process) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Processo não encontrado.' }
      });
    }

    // MANDATÓRIO: Verificação de isolamento multi-tenant
    if (process.tenantId !== req.user.tenantId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'CROSS_TENANT_ACCESS_DENIED',
          message: 'Acesso negado: este processo pertence a outra organização.'
        }
      });
    }

    const statusCalculado = StatusService.calculate(process.itens || []);
    const auditLogs = AuditService.getByProcess(process.id, process.tenantId);

    return res.status(200).json({
      success: true,
      data: {
        ...process,
        statusDeterminístico: statusCalculado.status,
        statusInfo: statusCalculado,
        historico: auditLogs
      }
    });
  }

  static async create(req, res) {
    try {
      const { nome, tipo, responsavelNome, prazo, observacoes, checklistId } = req.body;

      if (!nome || !checklistId) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Nome do processo e modelo de checklist são obrigatórios.' }
        });
      }

      // Verifica limite do plano da organização
      const org = organizationsDb.findById(req.user.tenantId);
      if (org && org.plano === 'GRATIS' && (org.processosCriadosMes || 0) >= (org.limiteProcessosMes || 5)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'PLAN_LIMIT_EXCEEDED',
            message: 'Limite mensal do plano Grátis atingido (5 processos). Considere fazer upgrade para continuar.'
          }
        });
      }

      // Busca o checklist solicitado
      const checklist = checklistsDb.findById(checklistId);
      if (!checklist) {
        return res.status(404).json({
          success: false,
          error: { code: 'CHECKLIST_NOT_FOUND', message: 'Checklist informado não foi encontrado.' }
        });
      }

      // Validação de acesso ao checklist
      if (!checklist.isSystemTemplate && checklist.tenantId !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          error: { code: 'CROSS_TENANT_ACCESS_DENIED', message: 'Checklist pertence a outra organização.' }
        });
      }

      // Constrói os itens do processo copiando a estrutura do checklist
      const processItens = (checklist.itens || []).map((item, idx) => ({
        id: `item_p_${Date.now()}_${idx}`,
        checklistItemId: item.id,
        nome: item.nome,
        tipo: item.tipo,
        obrigatorio: Boolean(item.obrigatorio),
        orientacoes: item.orientacoes || 'Verificar conformidade antes do envio.',
        documentoId: null,
        documento: null,
        statusItem: 'ausente', // 'ausente', 'presente', 'conferir'
        observacoes: '',
        conferido: false
      }));

      const statusCalculado = StatusService.calculate(processItens);

      const newProcess = await processesDb.insertAsync({
        tenantId: req.user.tenantId,
        nome: nome.trim(),
        tipo: tipo || 'Conferência Geral',
        responsavelId: req.user.id,
        responsavelNome: responsavelNome ? responsavelNome.trim() : req.user.nome,
        statusWorkflow: 'EM ANÁLISE', // RASCUNHO, EM ANÁLISE, PENDENTE, COMPLETO, ARQUIVADO
        statusDeterminístico: statusCalculado.status,
        prazo: prazo || null,
        observacoes: observacoes ? observacoes.trim() : '',
        checklistId: checklist.id,
        checklistNome: checklist.nome,
        itens: processItens
      });

      // Atualiza contador de processos no tenant
      if (org) {
        organizationsDb.update(org.id, {
          processosCriadosMes: (org.processosCriadosMes || 0) + 1
        });
      }

      AuditService.log({
        tenantId: req.user.tenantId,
        processId: newProcess.id,
        userId: req.user.id,
        userName: req.user.nome,
        action: 'PROCESSO_CRIADO',
        details: { nome: newProcess.nome, checklist: checklist.nome }
      });

      return res.status(201).json({
        success: true,
        data: {
          ...newProcess,
          statusInfo: statusCalculado
        },
        message: 'Processo criado com sucesso!'
      });
    } catch (err) {
      console.error('[ProcessController.create]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao criar processo.' }
      });
    }
  }

  static async updateItem(req, res) {
    try {
      const { id, itemId } = req.params;
      const { observacoes, statusItem, conferido } = req.body;

      const process = processesDb.findById(id);
      if (!process) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Processo não encontrado.' }
        });
      }

      if (process.tenantId !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          error: { code: 'CROSS_TENANT_ACCESS_DENIED', message: 'Acesso negado a este processo.' }
        });
      }

      const itens = process.itens || [];
      const itemIndex = itens.findIndex(it => it.id === itemId);
      if (itemIndex === -1) {
        return res.status(404).json({
          success: false,
          error: { code: 'ITEM_NOT_FOUND', message: 'Item de checklist não encontrado no processo.' }
        });
      }

      // Atualiza propriedades do item
      if (observacoes !== undefined) itens[itemIndex].observacoes = observacoes.trim();
      if (statusItem !== undefined) itens[itemIndex].statusItem = statusItem;
      if (conferido !== undefined) itens[itemIndex].conferido = Boolean(conferido);

      // Recalcula status
      const statusCalculado = StatusService.calculate(itens);

      const updated = processesDb.update(id, {
        itens,
        statusDeterminístico: statusCalculado.status
      });

      AuditService.log({
        tenantId: req.user.tenantId,
        processId: id,
        userId: req.user.id,
        userName: req.user.nome,
        action: 'PENDENCIA_RESOLVIDA',
        details: { itemId, itemNome: itens[itemIndex].nome, statusItem, observacoes }
      });

      return res.status(200).json({
        success: true,
        data: {
          ...updated,
          statusInfo: statusCalculado
        },
        message: 'Item atualizado com sucesso.'
      });
    } catch (err) {
      console.error('[ProcessController.updateItem]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao atualizar item do processo.' }
      });
    }
  }

  static async updateWorkflowStatus(req, res) {
    try {
      const { id } = req.params;
      const { statusWorkflow } = req.body;

      const validWorkflow = ['RASCUNHO', 'EM ANÁLISE', 'PENDENTE', 'COMPLETO', 'ARQUIVADO'];
      if (!validWorkflow.includes(statusWorkflow)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: 'Status de fluxo inválido.' }
        });
      }

      const process = processesDb.findById(id);
      if (!process || process.tenantId !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          error: { code: 'CROSS_TENANT_ACCESS_DENIED', message: 'Processo não encontrado ou sem permissão.' }
        });
      }

      const statusCalculado = StatusService.calculate(process.itens || []);

      // Se tentar finalizar como COMPLETO mas tiver documento obrigatório faltando
      if (statusWorkflow === 'COMPLETO' && statusCalculado.status === STATUS_TYPES.INCOMPLETO) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CANNOT_COMPLETE',
            message: 'Não é possível finalizar conferência enquanto houver documentos obrigatórios faltantes.'
          }
        });
      }

      const updated = processesDb.update(id, { statusWorkflow });

      AuditService.log({
        tenantId: req.user.tenantId,
        processId: id,
        userId: req.user.id,
        userName: req.user.nome,
        action: statusWorkflow === 'COMPLETO' ? 'PROCESSO_FINALIZADO' : 'STATUS_ALTERADO',
        details: { statusAnterior: process.statusWorkflow, novoStatus: statusWorkflow }
      });

      return res.status(200).json({
        success: true,
        data: {
          ...updated,
          statusInfo: statusCalculado
        },
        message: `Status do processo alterado para ${statusWorkflow}.`
      });
    } catch (err) {
      console.error('[ProcessController.updateWorkflowStatus]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao atualizar status.' }
      });
    }
  }

  static async delete(req, res) {
    try {
      const { id } = req.params;
      const process = processesDb.findById(id);

      if (!process) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Processo não encontrado.' }
        });
      }

      // MANDATÓRIO: Verificação de isolamento multi-tenant
      if (process.tenantId !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'CROSS_TENANT_ACCESS_DENIED',
            message: 'Acesso negado: este processo pertence a outra organização.'
          }
        });
      }

      // Exclui documentos físicos, blobs persistentes e registros no banco
      const docs = documentsDb.findAll(d => d.processId === id && d.tenantId === req.user.tenantId);
      for (const d of docs) {
        try {
          await StorageService.deleteFile(d.id, req.user.tenantId);
        } catch (e) {
          console.warn('[ProcessController.delete] Erro ao excluir arquivo físico/blob:', e.message);
        }
        documentsDb.delete(d.id);
      }

      // Tenta remover diretório do processo se vazio
      try {
        const safeTenant = req.user.tenantId.replace(/[^a-zA-Z0-9_-]/g, '');
        const safeProcess = id.replace(/[^a-zA-Z0-9_-]/g, '');
        const processDir = path.resolve(process.cwd(), 'storage', 'private', safeTenant, safeProcess);
        if (fs.existsSync(processDir)) {
          fs.rmSync(processDir, { recursive: true, force: true });
        }
      } catch {}

      processesDb.delete(id);

      AuditService.log({
        tenantId: req.user.tenantId,
        processId: id,
        userId: req.user.id,
        userName: req.user.nome,
        action: 'PROCESSO_EXCLUIDO',
        details: { nome: process.nome }
      });

      return res.status(200).json({
        success: true,
        message: 'Processo e arquivos vinculados excluídos com sucesso.'
      });
    } catch (err) {
      console.error('[ProcessController.delete]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao excluir processo.' }
      });
    }
  }
}
