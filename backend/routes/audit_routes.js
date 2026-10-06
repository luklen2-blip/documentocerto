import { Router } from 'express';
import { AuditService } from '../services/audit_service.js';
import { authenticate } from '../middleware/auth_middleware.js';
import { requireTenant, requireRole } from '../middleware/tenant_middleware.js';

const router = Router();

router.use(authenticate, requireTenant);

// Lista logs de auditoria da organização (ADMIN)
router.get('/', requireRole('ADMIN'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const logs = AuditService.getByTenant(req.user.tenantId, limit);
  res.status(200).json({ success: true, data: logs });
});

// Lista logs de auditoria de um processo específico (Membro e Admin do mesmo tenant)
router.get('/process/:processId', (req, res) => {
  const { processId } = req.params;
  const logs = AuditService.getByProcess(processId, req.user.tenantId);
  res.status(200).json({ success: true, data: logs });
});

export default router;
