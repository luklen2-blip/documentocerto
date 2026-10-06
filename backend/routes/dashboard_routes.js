import { Router } from 'express';
import { processesDb, usersDb, documentsDb } from '../database/index.js';
import { StatusService, STATUS_TYPES } from '../services/status_service.js';
import { authenticate } from '../middleware/auth_middleware.js';
import { requireTenant } from '../middleware/tenant_middleware.js';

const router = Router();

router.use(authenticate, requireTenant);

router.get('/summary', (req, res) => {
  const tenantId = req.user.tenantId;
  const processes = processesDb.findAll(p => p.tenantId === tenantId);

  let completos = 0;
  let pendentes = 0;
  let emAnalise = 0;
  let comAtencao = 0;

  const enriched = processes.map(p => {
    const statusCalculado = StatusService.calculate(p.itens || []);
    if (statusCalculado.status === STATUS_TYPES.COMPLETO || p.statusWorkflow === 'COMPLETO') {
      completos++;
    } else if (statusCalculado.status === STATUS_TYPES.ATENCAO) {
      comAtencao++;
      emAnalise++;
    } else {
      pendentes++;
      if (p.statusWorkflow === 'EM ANÁLISE') emAnalise++;
    }

    return {
      id: p.id,
      nome: p.nome,
      tipo: p.tipo,
      responsavelNome: p.responsavelNome,
      statusWorkflow: p.statusWorkflow,
      statusDeterminístico: statusCalculado.status,
      statusColor: statusCalculado.colorInfo,
      totalItens: statusCalculado.totalItens,
      obrigatoriosPresentes: statusCalculado.obrigatoriosPresentes,
      obrigatoriosTotais: statusCalculado.obrigatoriosTotais,
      taxaCompletude: statusCalculado.taxaCompletude,
      prazo: p.prazo,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    };
  });

  enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const totalDocumentos = documentsDb.findAll(d => d.tenantId === tenantId).length;
  const totalMembros = usersDb.findAll(u => u.tenantId === tenantId && u.ativo).length;

  res.status(200).json({
    success: true,
    data: {
      metrics: {
        totalProcessos: processes.length,
        completos,
        pendentes,
        emAnalise,
        comAtencao,
        totalDocumentos,
        totalMembros
      },
      recentes: enriched.slice(0, 8),
      organization: req.organization
    }
  });
});

export default router;
