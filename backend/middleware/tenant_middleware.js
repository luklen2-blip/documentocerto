import { organizationsDb } from '../database/index.js';

export function requireTenant(req, res, next) {
  if (!req.user || !req.user.tenantId) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'TENANT_REQUIRED',
        message: 'Nenhuma organização associada a este usuário.'
      }
    });
  }

  const org = organizationsDb.findById(req.user.tenantId);
  if (!org || !org.ativo) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'TENANT_NOT_FOUND',
        message: 'A organização do usuário está inativa ou não foi encontrada.'
      }
    });
  }

  req.organization = org;
  next();
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Usuário não autenticado.' }
      });
    }

    if (!allowedRoles.includes(req.user.papel)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_ROLE',
          message: `Operação restrita para: ${allowedRoles.join(', ')}. Seu perfil atual é: ${req.user.papel}.`
        }
      });
    }

    next();
  };
}

export function enforceTenantMatch(req, res, resourceTenantId) {
  if (req.user.tenantId !== resourceTenantId) {
    res.status(403).json({
      success: false,
      error: {
        code: 'CROSS_TENANT_ACCESS_DENIED',
        message: 'Tentativa de acesso não autorizada: o recurso pertence a outra organização.'
      }
    });
    return false;
  }
  return true;
}
