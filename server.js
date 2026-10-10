import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Middlewares
import { applySecurityHeaders, globalLimiter, errorHandler } from './backend/middleware/security_middleware.js';

// Rotas da API
import authRoutes from './backend/routes/auth_routes.js';
import tenantRoutes from './backend/routes/tenant_routes.js';
import checklistRoutes from './backend/routes/checklist_routes.js';
import processRoutes from './backend/routes/process_routes.js';
import documentRoutes from './backend/routes/document_routes.js';
import auditRoutes from './backend/routes/audit_routes.js';
import planRoutes from './backend/routes/plan_routes.js';
import dashboardRoutes from './backend/routes/dashboard_routes.js';
import analysisRoutes from './backend/routes/analysis_routes.js';
import webhookRoutes from './backend/routes/webhook_routes.js';

// Database & Seeds
import {
  seedDefaultChecklists,
  checkConnection,
  isPostgresConfigured,
  runMigrations,
  migrateJsonDbToPostgres,
  syncAllRepositoriesFromPg
} from './backend/database/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Inicializa modelos de sistema
seedDefaultChecklists();

// 2. Middlewares de infraestrutura e segurança
app.use(applySecurityHeaders);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(globalLimiter);

// 3. Endpoint MANDATÓRIO de Monitoramento em Nuvem 24/7 com verificação de banco
app.get('/api/health', async (req, res) => {
  const dbStatus = await checkConnection();
  const isProd = process.env.NODE_ENV === 'production';
  const isDegraded = isProd && !dbStatus.connected;

  res.status(200).json({
    status: isDegraded ? 'degraded' : 'ok',
    app: process.env.APP_NAME || 'DocumentoCerto',
    version: '2.0.0',
    uptime_seconds: Math.floor(process.uptime()),
    database: dbStatus,
    timestamp: new Date().toISOString()
  });
});

// 3.1 Endpoint Administrativo para Execução e Auditoria de Migração de Dados
app.all(['/api/admin/migrate-data', '/api/admin/reconciliation'], async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.query.key;
    const expectedKey = process.env.ADMIN_KEY || 'documentocerto_admin_migrate_2026';
    if (adminKey !== expectedKey) {
      return res.status(401).json({ success: false, error: 'Chave de administração inválida.' });
    }

    const result = await migrateJsonDbToPostgres();
    const syncedCount = await syncAllRepositoriesFromPg();
    return res.status(200).json({
      success: true,
      message: 'Migração e reconciliação executadas com sucesso.',
      migration: result,
      syncedRepositoriesRecords: syncedCount
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Registro dos Módulos da API REST
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/checklists', checklistRoutes);
app.use('/api/processes', processRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/webhook', webhookRoutes);

// 5. Resolução Resiliente e Universal de Arquivos Estáticos de Frontend
const staticCandidates = [
  path.join(process.cwd(), 'public'),
  path.join(__dirname, 'public'),
  path.join(process.cwd(), 'frontend', 'public'),
  path.join(__dirname, 'frontend', 'public'),
  process.cwd()
];

staticCandidates.forEach(dirPath => {
  if (fs.existsSync(dirPath)) {
    app.use(express.static(dirPath));
  }
});

// 6. Rotas Oficiais de Conformidade Jurídica e LGPD (Termos e Privacidade)
app.get('/termos', (req, res) => {
  const file = path.join(__dirname, 'public', 'termos.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  res.redirect('/#termos');
});

app.get('/privacidade', (req, res) => {
  const file = path.join(__dirname, 'public', 'privacidade.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  res.redirect('/#privacidade');
});

// 7. Fallback SPA para Rotas de Frontend (Landing page, App, LGPD, Termos)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint de API não encontrado.' }
    });
  }

  const htmlCandidates = [
    path.join(process.cwd(), 'public', 'index.html'),
    path.join(__dirname, 'public', 'index.html'),
    path.join(process.cwd(), 'frontend', 'index.html'),
    path.join(process.cwd(), 'index.html')
  ];

  const htmlFile = htmlCandidates.find(p => fs.existsSync(p));
  if (htmlFile) {
    return res.sendFile(htmlFile);
  }

  next();
});

// 8. Middleware de Erro Seguro (Sem vazamento de stack traces)
app.use(errorHandler);

// Inicialização do servidor HTTP
if (process.env.NODE_ENV !== 'test') {
  // Verificação de segurança e transição de banco
  if (process.env.NODE_ENV === 'production' && !isPostgresConfigured()) {
    console.warn('================================================================');
    console.warn('[AVISO] DATABASE_URL não configurada no ambiente de produção.');
    console.warn('Operando temporariamente em modo de transição segura (JsonDB).');
    console.warn('Vincule o banco documentocerto-db no painel do Render para persistência PostgreSQL.');
    console.warn('================================================================');
  }

  // Executa migrações pendentes e migração de dados idempotente
  if (isPostgresConfigured()) {
    runMigrations()
      .then(() => migrateJsonDbToPostgres())
      .then(res => {
        if (res && res.success) {
          console.log(`[Data Migration]: ✅ Reconciliados ${res.totalRecordsJson} registros com sucesso no PostgreSQL!`);
        }
        return syncAllRepositoriesFromPg();
      })
      .then(syncedCount => {
        if (typeof syncedCount === 'number') {
          console.log(`[Repository Sync]: ✅ ${syncedCount} registros sincronizados a partir do PostgreSQL.`);
        }
      })
      .catch(err => {
        console.error('[Migrations Erro ao Inicializar]:', err.message);
      });
  }

  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 DocumentoCerto rodando com sucesso na porta ${PORT}`);
    console.log(`🔗 Local: http://localhost:${PORT}`);
    console.log(`🩺 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🔒 Modo Multi-Tenant e Armazenamento Privado Ativos`);
    console.log(`📦 Banco: ${isPostgresConfigured() ? 'PostgreSQL Ativo' : 'JsonDB (Modo Local/Compat)'}`);
    console.log(`==================================================`);
  });
}

export default app;
