import { Router } from 'express';
import { MetricsService } from '../services/metrics_service.js';
import {
  migrateJsonDbToPostgres,
  migrateFilesToStorage,
  syncAllRepositoriesFromPg,
  usersDb
} from '../database/index.js';
import { verifyToken } from '../utils/crypto_utils.js';

const router = Router();

/**
 * Middleware de proteção administrativa:
 * Autoriza acesso via chave de cabeçalho x-admin-key (ou query param ?key=)
 * OU via Bearer Token de um usuário administrador autenticado.
 */
function requireAdminAuth(req, res, next) {
  const adminKey = req.headers['x-admin-key'] || req.query.key;
  const expectedKey = process.env.ADMIN_KEY || 'documentocerto_admin_migrate_2026';

  // 1. Verificação via chave administrativa mestra
  if (adminKey && adminKey === expectedKey) {
    req.isAdminMaster = true;
    return next();
  }

  // 2. Verificação via Token JWT de Usuário com papel ADMIN
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token);
    if (payload && payload.userId) {
      const user = usersDb.findById(payload.userId);
      if (user && user.ativo && user.papel === 'ADMIN') {
        req.user = user;
        req.tenantId = user.tenantId;
        return next();
      }
    }
  }

  return res.status(401).json({
    success: false,
    error: {
      code: 'ADMIN_UNAUTHORIZED',
      message: 'Acesso restrito: forneça x-admin-key válida ou autentique-se como Administrador.'
    }
  });
}

/**
 * GET /api/admin/metrics
 * Retorna as métricas em tempo real e o funil de conversão
 */
router.get('/metrics', requireAdminAuth, async (req, res) => {
  try {
    const metrics = await MetricsService.getConversionMetrics();
    return res.status(200).json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Admin Metrics Error]:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'METRICS_ERROR', message: err.message }
    });
  }
});

/**
 * POST/GET /api/admin/migrate-data & /api/admin/reconciliation
 * Rotas de conciliação de dados legados e persistência de arquivos
 */
router.all(['/migrate-data', '/reconciliation'], requireAdminAuth, async (req, res) => {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && !process.env.ADMIN_KEY) {
      return res.status(503).json({
        success: false,
        error: 'Endpoint de migração desativado em produção: defina ADMIN_KEY nas variáveis de ambiente.'
      });
    }

    const result = await migrateJsonDbToPostgres();
    const filesResult = await migrateFilesToStorage();
    const syncedCount = await syncAllRepositoriesFromPg();

    return res.status(200).json({
      success: true,
      message: 'Migração, persistência de arquivos e reconciliação executadas com sucesso.',
      migration: result,
      filesMigration: filesResult,
      syncedRepositoriesRecords: syncedCount
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
