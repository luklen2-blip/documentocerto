import { organizationsDb, usersDb, processesDb } from '../database/index.js';
import { hashPassword } from '../utils/crypto_utils.js';
import { AuditService } from '../services/audit_service.js';

export class TenantController {
  static async getCurrent(req, res) {
    const org = req.organization;
    const totalProcessos = processesDb.findAll(p => p.tenantId === org.id).length;
    const totalMembros = usersDb.findAll(u => u.tenantId === org.id && u.ativo).length;

    return res.status(200).json({
      success: true,
      data: {
        organization: org,
        stats: {
          totalProcessos,
          totalMembros
        }
      }
    });
  }

  static async listUsers(req, res) {
    const users = usersDb.findAll(u => u.tenantId === req.user.tenantId);
    const safeUsers = users.map(({ senhaHash, ...rest }) => rest);
    return res.status(200).json({
      success: true,
      data: safeUsers
    });
  }

  static async addUser(req, res) {
    try {
      const { nome, email, senha, papel } = req.body;

      if (!nome || !email || !senha) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Nome, e-mail e senha inicial são obrigatórios.' }
        });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const existing = usersDb.findOne(u => u.email === normalizedEmail);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: { code: 'EMAIL_ALREADY_EXISTS', message: 'Este e-mail já está em uso.' }
        });
      }

      const validRoles = ['ADMIN', 'MEMBRO', 'AUDITOR', 'GESTOR', 'CLIENTE'];
      const chosenRole = validRoles.includes(papel) ? papel : 'MEMBRO';

      const newUser = usersDb.insert({
        tenantId: req.user.tenantId,
        nome: nome.trim(),
        email: normalizedEmail,
        senhaHash: hashPassword(senha),
        papel: chosenRole,
        ativo: true
      });

      AuditService.log({
        tenantId: req.user.tenantId,
        userId: req.user.id,
        userName: req.user.nome,
        action: 'USUARIO_ALTERADO',
        details: { acao: 'CRIADO', novoUsuarioId: newUser.id, nome: newUser.nome, papel: newUser.papel }
      });

      const { senhaHash, ...safe } = newUser;
      return res.status(201).json({
        success: true,
        data: safe,
        message: 'Membro adicionado com sucesso!'
      });
    } catch (err) {
      console.error('[TenantController.addUser]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao adicionar membro.' }
      });
    }
  }

  static async updateRole(req, res) {
    const { id } = req.params;
    const { papel } = req.body;

    const targetUser = usersDb.findById(id);
    if (!targetUser || targetUser.tenantId !== req.user.tenantId) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Usuário não encontrado nesta organização.' }
      });
    }

    if (targetUser.id === req.user.id) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_OPERATION', message: 'Você não pode alterar seu próprio papel.' }
      });
    }

    const validRoles = ['ADMIN', 'MEMBRO', 'AUDITOR', 'GESTOR', 'CLIENTE'];
    if (!validRoles.includes(papel)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ROLE', message: 'Papel de usuário inválido.' }
      });
    }

    const updated = usersDb.update(id, { papel });
    AuditService.log({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      userName: req.user.nome,
      action: 'USUARIO_ALTERADO',
      details: { acao: 'ALTERACAO_PAPEL', usuarioAfetado: id, novoPapel: papel }
    });

    const { senhaHash, ...safe } = updated;
    return res.status(200).json({ success: true, data: safe });
  }
}
