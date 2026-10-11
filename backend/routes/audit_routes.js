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

// Registra eventos do tutorial de onboarding e primeiros passos (anônimo, sem dados sensíveis)
router.post('/onboarding-event', (req, res) => {
  const event = req.body.event || req.body.eventType;
  const step = req.body.step ?? req.body.metadata?.step;
  const actionName = req.body.actionName ?? req.body.metadata?.actionName;
  const allowedEvents = [
    'tutorial_iniciado',
    'tutorial_etapa_concluida',
    'tutorial_pulado',
    'tutorial_finalizado',
    'primeira_acao_relevante',
    'checkout_aberto'
  ];

  if (!event || !allowedEvents.includes(event)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_EVENT',
        message: 'Tipo de evento de onboarding inválido ou não suportado.'
      }
    });
  }

  // Sanitização estrita: registrar somente metadados técnicos seguros (sem documentos, CPF ou dados pessoais)
  const safeDetails = {
    event,
    step: typeof step === 'number' ? step : undefined,
    actionName: typeof actionName === 'string' ? actionName.slice(0, 50) : undefined
  };

  AuditService.log({
    tenantId: req.user.tenantId,
    userId: req.user.id,
    userName: req.user.nome,
    action: `ONBOARDING_${event.toUpperCase()}`,
    details: safeDetails
  });

  return res.status(200).json({
    success: true,
    data: { event, eventType: event },
    message: 'Evento de onboarding registrado com sucesso.'
  });
});

export default router;
