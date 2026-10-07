import { usersDb, organizationsDb } from '../database/index.js';
import { hashPassword, verifyPassword, createToken } from '../utils/crypto_utils.js';
import { AuditService } from '../services/audit_service.js';

export class AuthController {
  static async register(req, res) {
    try {
      const { nome, email, senha, nomeEmpresa, cpfCnpj } = req.body;

      if (!nome || !email || !senha || !nomeEmpresa) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Nome, e-mail, senha e nome da empresa são obrigatórios.'
          }
        });
      }

      if (senha.length < 6) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'WEAK_PASSWORD',
            message: 'A senha deve conter no mínimo 6 caracteres.'
          }
        });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const existingUser = usersDb.findOne(u => u.email === normalizedEmail);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'Este e-mail já está cadastrado no sistema.'
          }
        });
      }

      // 1. Cria a Organização (Tenant) com 1 dia de período de teste completo
      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const organization = organizationsDb.insert({
        nome: nomeEmpresa.trim(),
        cpfCnpj: (cpfCnpj || '').trim(),
        plano: 'GRATIS',
        ativo: true,
        trialAtivo: true,
        trialDias: 1,
        trialIniciadoEm: now.toISOString(),
        trialExpiraEm: trialEndsAt,
        limiteProcessosMes: 20, // Processos liberados durante o período de teste
        processosCriadosMes: 0
      });

      // 2. Cria o Usuário Principal (ADMIN do Tenant)
      const user = usersDb.insert({
        tenantId: organization.id,
        nome: nome.trim(),
        email: normalizedEmail,
        senhaHash: hashPassword(senha),
        papel: 'ADMIN', // Papel inicial do criador
        ativo: true
      });

      // 3. Auditoria
      AuditService.log({
        tenantId: organization.id,
        userId: user.id,
        userName: user.nome,
        action: 'ORGANIZACAO_CRIADA',
        details: { nomeEmpresa: organization.nome, plano: organization.plano }
      });

      const token = createToken({
        userId: user.id,
        tenantId: organization.id,
        email: user.email,
        papel: user.papel
      });

      const { senhaHash, ...safeUser } = user;

      return res.status(201).json({
        success: true,
        data: {
          user: safeUser,
          organization,
          token
        },
        message: 'Conta e organização criadas com sucesso!'
      });
    } catch (err) {
      console.error('[AuthController.register]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro interno ao criar conta.' }
      });
    }
  }

  static async login(req, res) {
    try {
      const { email, senha } = req.body;

      if (!email || !senha) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'E-mail e senha são obrigatórios.' }
        });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const user = usersDb.findOne(u => u.email === normalizedEmail);

      if (!user || !verifyPassword(senha, user.senhaHash)) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha incorretos.' }
        });
      }

      if (!user.ativo) {
        return res.status(403).json({
          success: false,
          error: { code: 'USER_INACTIVE', message: 'Conta inativa. Entre em contato com o administrador.' }
        });
      }

      const organization = organizationsDb.findById(user.tenantId);
      if (!organization || !organization.ativo) {
        return res.status(403).json({
          success: false,
          error: { code: 'TENANT_INACTIVE', message: 'A organização vinculada a este usuário está inativa.' }
        });
      }

      const token = createToken({
        userId: user.id,
        tenantId: organization.id,
        email: user.email,
        papel: user.papel
      });

      const { senhaHash, ...safeUser } = user;

      return res.status(200).json({
        success: true,
        data: {
          user: safeUser,
          organization,
          token
        },
        message: 'Login realizado com sucesso.'
      });
    } catch (err) {
      console.error('[AuthController.login]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro interno ao realizar login.' }
      });
    }
  }

  static async me(req, res) {
    const { senhaHash, ...safeUser } = req.user;
    return res.status(200).json({
      success: true,
      data: {
        user: safeUser,
        organization: req.organization
      }
    });
  }
}
