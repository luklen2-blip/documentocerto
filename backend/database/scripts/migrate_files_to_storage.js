import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { isPostgresConfigured, query, withTransaction } from '../pg_pool.js';
import { documentsDb } from '../index.js';
import { StorageService } from '../../services/storage_service.js';

export async function migrateFilesToStorage() {
  console.log('================================================================');
  console.log('📦 MIGRAÇÃO DE ARQUIVOS PARA ARMAZENAMENTO PERSISTENTE (BLOBS)');
  console.log('================================================================');

  if (!isPostgresConfigured()) {
    console.log('[MigrateFiles] PostgreSQL não configurado. Modo local/JsonDB mantido.');
    return { success: true, count: 0, reason: 'NOT_POSTGRES' };
  }

  // 1. Busca todos os documentos registrados no PostgreSQL
  const docsRes = await query(`
    SELECT id, tenant_id, process_id, item_id, original_name, stored_filename, mime_type, size_bytes, storage_path, sha256 
    FROM documents 
    ORDER BY created_at ASC
  `);

  console.log(`[MigrateFiles] Total de documentos localizados no PostgreSQL: ${docsRes.rows.length}`);

  let ingested = 0;
  let skipped = 0;
  let normalized = 0;
  let missing = 0;

  for (const doc of docsRes.rows) {
    // Verifica se já possui blob gravado
    const blobCheck = await query('SELECT id, sha256 FROM document_blobs WHERE document_id = $1 LIMIT 1', [doc.id]);
    const alreadyHasBlob = blobCheck.rows.length > 0;

    // Resolve o caminho físico local
    let resolvedPath = StorageService.resolveLocalPath(doc.storage_path);
    let fileBuffer = null;

    if (resolvedPath && fs.existsSync(resolvedPath)) {
      try {
        fileBuffer = fs.readFileSync(resolvedPath);
      } catch (err) {
        console.warn(`[MigrateFiles] Aviso ao ler ${resolvedPath}:`, err.message);
      }
    }

    // Se não encontrou no caminho direto, tenta buscar por nome do arquivo em storage/private
    if (!fileBuffer && doc.stored_filename) {
      const searchBase = path.resolve(process.cwd(), 'storage', 'private');
      if (fs.existsSync(searchBase)) {
        const findInDir = (dir) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              const res = findInDir(full);
              if (res) return res;
            } else if (entry.name === doc.stored_filename) {
              return full;
            }
          }
          return null;
        };

        const alternatePath = findInDir(searchBase);
        if (alternatePath && fs.existsSync(alternatePath)) {
          try {
            fileBuffer = fs.readFileSync(alternatePath);
            resolvedPath = alternatePath;
          } catch {}
        }
      }
    }

    if (fileBuffer) {
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const relativePath = StorageService.toRelativeStoragePath(resolvedPath);

      if (!alreadyHasBlob) {
        const blobId = `blob_${doc.id}`;
        await query(
          `INSERT INTO document_blobs 
            (id, document_id, tenant_id, file_data, mime_type, file_size, sha256, storage_provider, created_at, updated_at)
           VALUES 
            ($1, $2, $3, $4, $5, $6, $7, 'postgres_blob', NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET
            file_data = EXCLUDED.file_data,
            sha256 = EXCLUDED.sha256,
            updated_at = NOW()`,
          [blobId, doc.id, doc.tenant_id, fileBuffer, doc.mime_type, fileBuffer.length, sha256]
        );
        ingested++;
        console.log(`[MigrateFiles] ✅ Documento ${doc.id} (${doc.original_name}) ingerido com sucesso no PostgreSQL! Hash: ${sha256.slice(0, 12)}...`);
      } else {
        skipped++;
      }

      // Normaliza caminho universal no PostgreSQL
      await query(
        `UPDATE documents SET sha256 = $1, storage_path = $2 WHERE id = $3`,
        [sha256, relativePath, doc.id]
      );
      normalized++;
    } else {
      if (alreadyHasBlob) {
        // Arquivo não está no disco, mas já está seguro no PostgreSQL! Auto-reidratação protegerá.
        skipped++;
      } else {
        missing++;
        console.warn(`[MigrateFiles] ⚠️ Documento ${doc.id} (${doc.original_name}) não possui binário local nem blob prévio.`);
      }
    }
  }

  console.log(`[MigrateFiles] Concluído: ${ingested} novos blobs ingeridos, ${skipped} preservados/já existentes, ${normalized} caminhos normalizados, ${missing} sem arquivo físico.`);
  return {
    success: true,
    total: docsRes.rows.length,
    ingested,
    skipped,
    normalized,
    missing
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrateFilesToStorage()
    .then(r => {
      console.log('[MigrateFiles] Resultado:', r);
      process.exit(0);
    })
    .catch(err => {
      console.error('[MigrateFiles] Erro:', err);
      process.exit(1);
    });
}
