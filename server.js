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

// Database & Seeds
import { seedDefaultChecklists } from './backend/database/index.js';

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

// 3. Endpoint MANDATÓRIO de Monitoramento em Nuvem 24/7
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    app: process.env.APP_NAME || 'DocumentoCerto',
    version: '2.0.0',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
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

// 6. Fallback SPA para Rotas de Frontend (Landing page, App, LGPD, Termos)
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

// 7. Middleware de Erro Seguro (Sem vazamento de stack traces)
app.use(errorHandler);

// Inicialização do servidor HTTP
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 DocumentoCerto rodando com sucesso na porta ${PORT}`);
    console.log(`🔗 Local: http://localhost:${PORT}`);
    console.log(`🩺 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🔒 Modo Multi-Tenant e Armazenamento Privado Ativos`);
    console.log(`==================================================`);
  });
}

export default app;
