-- ====================================================================
-- DOCUMENTOCERTO - MIGRAÇÃO INICIAL 001: ESQUEMA COMPLETO POSTGRESQL
-- Criação de tabelas, chaves estrangeiras, índices e restrições
-- ====================================================================

-- 1. Tabela de Controle de Versão das Migrações
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Organizações (Tenants do SaaS)
CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(64) PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  cpf_cnpj VARCHAR(32),
  plano VARCHAR(32) NOT NULL DEFAULT 'GRATIS',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  trial_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  trial_dias INT NOT NULL DEFAULT 1,
  trial_iniciado_em TIMESTAMPTZ,
  trial_expira_em TIMESTAMPTZ,
  limite_processos_mes INT NOT NULL DEFAULT 20,
  processos_criados_mes INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Usuários
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  senha_hash VARCHAR(255) NOT NULL,
  papel VARCHAR(32) NOT NULL DEFAULT 'MEMBRO',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Modelos e Checklists
CREATE TABLE IF NOT EXISTS checklists (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  is_system_template BOOLEAN NOT NULL DEFAULT FALSE,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT,
  categoria VARCHAR(100),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Processos Documentais
CREATE TABLE IF NOT EXISTS processes (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome VARCHAR(255) NOT NULL,
  tipo VARCHAR(100),
  responsavel_id VARCHAR(64),
  responsavel_nome VARCHAR(255),
  status_workflow VARCHAR(64) NOT NULL DEFAULT 'EM_ANDAMENTO',
  status_deterministico VARCHAR(64),
  prazo TIMESTAMPTZ,
  observacoes TEXT,
  checklist_id VARCHAR(64),
  checklist_nome VARCHAR(255),
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Documentos Anexados
CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  process_id VARCHAR(64) NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  item_id VARCHAR(64) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by VARCHAR(64),
  uploaded_by_name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Trilha de Auditoria (Audit Logs)
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  process_id VARCHAR(64),
  user_id VARCHAR(64),
  user_name VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  details JSONB,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Jobs de Análise Assíncrona (Fase 2)
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  process_id VARCHAR(64) NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  status VARCHAR(64) NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  stage VARCHAR(64),
  error TEXT,
  result JSONB,
  created_by VARCHAR(64),
  created_by_name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Textos OCR Extraídos
CREATE TABLE IF NOT EXISTS extracted_text (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  process_id VARCHAR(64) NOT NULL,
  document_id VARCHAR(64) NOT NULL,
  job_id VARCHAR(64),
  text TEXT,
  confidence NUMERIC(5,2),
  source VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Campos Estruturados Extraídos
CREATE TABLE IF NOT EXISTS extracted_fields (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  process_id VARCHAR(64) NOT NULL,
  job_id VARCHAR(64),
  document_id VARCHAR(64),
  document_name VARCHAR(255),
  page INT,
  field VARCHAR(100) NOT NULL,
  value TEXT,
  normalized_value TEXT,
  confidence NUMERIC(5,2),
  source VARCHAR(64),
  snippet TEXT,
  validation JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Achados de Inconsistência e Conferência
CREATE TABLE IF NOT EXISTS findings (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  process_id VARCHAR(64) NOT NULL,
  job_id VARCHAR(64),
  severity VARCHAR(32) NOT NULL,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  recommendation TEXT,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Relatórios de Análise IA / Síntese
CREATE TABLE IF NOT EXISTS ai_analysis (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  process_id VARCHAR(64) NOT NULL,
  job_id VARCHAR(64),
  summary TEXT,
  findings JSONB,
  confidence NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Eventos Brutos de Webhook da Kiwify (Idempotência e Auditoria)
CREATE TABLE IF NOT EXISTS kiwify_webhook_events (
  id VARCHAR(64) PRIMARY KEY,
  event_id VARCHAR(128),
  order_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  customer_email VARCHAR(255),
  product_id VARCHAR(128),
  signature_received TEXT,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unq_kiwify_order_event UNIQUE (order_id, event_type)
);

-- 14. Transações Comerciais Confirmadas (Kiwify VITALÍCIO)
CREATE TABLE IF NOT EXISTS kiwify_transactions (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(128) NOT NULL UNIQUE,
  order_ref VARCHAR(128),
  tenant_id VARCHAR(64) REFERENCES organizations(id),
  user_id VARCHAR(64) REFERENCES users(id),
  customer_email VARCHAR(255) NOT NULL,
  customer_name VARCHAR(255),
  customer_cpf VARCHAR(32),
  product_id VARCHAR(128),
  product_name VARCHAR(255),
  plano_ativado VARCHAR(32) NOT NULL DEFAULT 'VITALICIO',
  valor_pago NUMERIC(10,2),
  payment_method VARCHAR(64),
  status VARCHAR(64) NOT NULL DEFAULT 'PAID',
  claim_token VARCHAR(128) UNIQUE,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de Isolamento Multi-Tenant e Alta Performance
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_processes_tenant ON processes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_process ON documents(process_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_checklists_tenant ON checklists(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kiwify_trans_email ON kiwify_transactions(customer_email);
CREATE INDEX IF NOT EXISTS idx_kiwify_events_order ON kiwify_webhook_events(order_id);
