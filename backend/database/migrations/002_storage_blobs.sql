-- ============================================================================
-- Migration 002: Tabela de Armazenamento Persistente de Binários (Blobs)
-- DocumentoCerto SaaS - Proteção definitiva contra perda de dados em contêineres efêmeros
-- ============================================================================

CREATE TABLE IF NOT EXISTS document_blobs (
  id VARCHAR(64) PRIMARY KEY,
  document_id VARCHAR(64) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id VARCHAR(64) NOT NULL,
  file_data BYTEA NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  storage_provider VARCHAR(32) NOT NULL DEFAULT 'postgres_blob',
  storage_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices otimizados para busca rápida por documento e isolamento por tenant
CREATE INDEX IF NOT EXISTS idx_document_blobs_doc ON document_blobs(document_id);
CREATE INDEX IF NOT EXISTS idx_document_blobs_tenant ON document_blobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_document_blobs_sha ON document_blobs(sha256);

-- Adiciona coluna sha256 na tabela documents caso não exista para integridade rápida
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'documents' AND column_name = 'sha256'
  ) THEN
    ALTER TABLE documents ADD COLUMN sha256 VARCHAR(64);
  END IF;
END $$;
