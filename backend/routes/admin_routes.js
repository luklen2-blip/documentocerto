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
 * Middleware de proteção administrativa de plataforma:
 * - Exige estritamente o cabeçalho x-admin-key correspondente a ADMIN_KEY.
 * - Rejeita passagem de chaves via query string (?key=) por ser uma má prática OWASP de exposição em logs.
 * - Impede que administradores de tenants comuns (clientes) acessem métricas globais de faturamento
 *   e transações de outros clientes da plataforma.
 * - Em produção (NODE_ENV === 'production'), exige que ADMIN_KEY esteja explicitamente configurada.
 */
function requireAdminAuth(req, res, next) {
  const expectedKey = process.env.ADMIN_KEY || 'documentocerto_admin_migrate_2026';
  const adminKeyHeader = req.headers['x-admin-key'];

  // 1. Verificação via chave de cabeçalho x-admin-key
  if (adminKeyHeader && adminKeyHeader === expectedKey) {
    req.isAdminMaster = true;
    return next();
  }

  // 2. Verificação de tentativas com Bearer Token de usuários comuns ou tenant admins
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token);
    if (payload && payload.userId) {
      const user = usersDb.findById(payload.userId);
      if (user && user.ativo) {
        if (user.papel === 'MEMBRO') {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN_ROLE',
              message: 'Acesso negado: usuários com papel MEMBRO não possuem permissão para painel de gestão.'
            }
          });
        }

        // Usuário é ADMIN de seu próprio tenant, mas rotas de plataforma exigem a chave do operador
        return res.status(403).json({
          success: false,
          error: {
            code: 'PLATFORM_KEY_REQUIRED',
            message: 'Acesso restrito ao operador da plataforma DocumentoCerto. Forneça o cabeçalho x-admin-key de gestão.'
          }
        });
      }
    }
  }

  // 3. Sem autenticação ou credenciais inválidas
  return res.status(401).json({
    success: false,
    error: {
      code: 'ADMIN_UNAUTHORIZED',
      message: 'Acesso restrito: forneça o cabeçalho x-admin-key com a chave de operador autorizada.'
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
    const isProd = process.env.NODE_ENV === 'production';
    return res.status(500).json({
      success: false,
      error: { code: 'METRICS_ERROR', message: isProd ? 'Falha ao computar métricas da plataforma.' : err.message }
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
