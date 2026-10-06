import { checklistsDb } from '../database/index.js';
import { AuditService } from '../services/audit_service.js';

export class ChecklistController {
  static async list(req, res) {
    const tenantId = req.user.tenantId;
    // Retorna templates de sistema + checklists criados pela organização
    const checklists = checklistsDb.findAll(c => c.isSystemTemplate || c.tenantId === tenantId);
    return res.status(200).json({
      success: true,
      data: checklists
    });
  }

  static async getById(req, res) {
    const { id } = req.params;
    const checklist = checklistsDb.findById(id);

    if (!checklist) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Checklist não encontrado.' }
      });
    }

    // Validação de acesso ao checklist
    if (!checklist.isSystemTemplate && checklist.tenantId !== req.user.tenantId) {
      return res.status(403).json({
        success: false,
        error: { code: 'CROSS_TENANT_ACCESS_DENIED', message: 'Acesso negado a este modelo de checklist.' }
      });
    }

    return res.status(200).json({
      success: true,
      data: checklist
    });
  }

  static async create(req, res) {
    try {
      const { nome, descricao, categoria, itens } = req.body;

      if (!nome || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Nome e pelo menos um item são obrigatórios para o checklist.' }
        });
      }

      const formattedItens = itens.map((item, idx) => ({
        id: item.id || `item_custom_${Date.now()}_${idx}`,
        nome: (item.nome || '').trim(),
        tipo: item.tipo || 'documento',
        obrigatorio: Boolean(item.obrigatorio),
        orientacoes: item.orientacoes || 'Verificar conformidade antes do envio.'
      }));

      const newChecklist = checklistsDb.insert({
        tenantId: req.user.tenantId,
        isSystemTemplate: false,
        nome: nome.trim(),
        descricao: descricao ? descricao.trim() : 'Modelo customizado da organização',
        categoria: categoria || 'Geral',
        ativo: true,
        itens: formattedItens
      });

      AuditService.log({
        tenantId: req.user.tenantId,
        userId: req.user.id,
        userName: req.user.nome,
        action: 'CHECKLIST_CRIADO',
        details: { checklistId: newChecklist.id, nome: newChecklist.nome, totalItens: formattedItens.length }
      });

      return res.status(201).json({
        success: true,
        data: newChecklist,
        message: 'Checklist criado com sucesso.'
      });
    } catch (err) {
      console.error('[ChecklistController.create]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao criar checklist.' }
      });
    }
  }

  static async delete(req, res) {
    const { id } = req.params;
    const chk = checklistsDb.findById(id);

    if (!chk) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Checklist não encontrado.' }
      });
    }

    if (chk.isSystemTemplate) {
      return res.status(400).json({
        success: false,
        error: { code: 'IMMUTABLE_TEMPLATE', message: 'Modelos padrão do sistema não podem ser excluídos.' }
      });
    }

    if (chk.tenantId !== req.user.tenantId) {
      return res.status(403).json({
        success: false,
        error: { code: 'CROSS_TENANT_ACCESS_DENIED', message: 'Acesso negado a este checklist.' }
      });
    }

    checklistsDb.delete(id);
    return res.status(200).json({ success: true, message: 'Checklist excluído com sucesso.' });
  }
}
