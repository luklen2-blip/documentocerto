import { auditDb } from '../database/index.js';

export class AuditService {
  static log({ tenantId, processId = null, userId, userName, action, details = {} }) {
    if (!tenantId || !userId || !action) {
      console.warn('[AuditService] Tentativa de registrar evento com dados incompletos.');
      return null;
    }

    return auditDb.insert({
      tenantId,
      processId,
      userId,
      userName: userName || 'Usuário',
      action,
      details,
      timestamp: new Date().toISOString()
    });
  }

  static getByTenant(tenantId, limit = 50) {
    const logs = auditDb.findAll(l => l.tenantId === tenantId);
    return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
  }

  static getByProcess(processId, tenantId) {
    const logs = auditDb.findAll(l => l.processId === processId && l.tenantId === tenantId);
    return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
}
