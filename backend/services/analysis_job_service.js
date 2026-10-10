import crypto from 'crypto';
import {
  analysisJobsDb,
  extractedTextDb,
  extractedFieldsDb,
  findingsDb,
  aiAnalysisDb,
  processesDb,
  documentsDb
} from '../database/index.js';
import { getOCRProvider } from '../ocr/index.js';
import { ExtractionService } from './extraction_service.js';
import { ValidationEngine, CLASSIFICATION } from './validation_engine.js';
import { AIAnalysisProvider } from './ai_analysis_provider.js';
import { AuditService } from './audit_service.js';
import { StorageService } from './storage_service.js';

export class AnalysisJobService {
  /**
   * Inicia um job de análise inteligente assíncrona.
   */
  static async startJob({ tenantId, processId, userId, userName, isReanalysis = false }) {
    const existingJobs = analysisJobsDb.findAll(j => j.processId === processId && j.tenantId === tenantId);
    const version = existingJobs.length + 1;

    const job = analysisJobsDb.insert({
      id: `job_${crypto.randomUUID()}`,
      tenantId,
      processId,
      version,
      status: 'QUEUED',
      progress: 5,
      stage: 'Documento recebido. Preparando análise...',
      error: null,
      result: null,
      createdBy: userId,
      createdByName: userName
    });

    AuditService.log({
      tenantId,
      processId,
      userId,
      userName,
      action: isReanalysis ? 'DOCUMENT_REANALYZED' : 'ANALYSIS_STARTED',
      details: { jobId: job.id, version }
    });

    // Dispara processamento assíncrono sem travar a resposta HTTP
    setImmediate(() => {
      this._runJob(job.id, tenantId, processId, userId, userName).catch(err => {
        console.error(`[AnalysisJobService] Erro fatal no job ${job.id}:`, err);
        analysisJobsDb.update(job.id, {
          status: 'FAILED',
          progress: 100,
          stage: 'Não foi possível analisar este processo automaticamente. Revise os arquivos ou tente novamente.',
          error: err.message
        });
      });
    });

    return job;
  }

  static async _runJob(jobId, tenantId, processId, userId, userName) {
    const ocrProvider = getOCRProvider();

    // 1. Atualiza estado para PROCESSING
    analysisJobsDb.update(jobId, {
      status: 'PROCESSING',
      progress: 20,
      stage: 'Extraindo informações dos documentos...'
    });

    const proc = processesDb.findById(processId);
    if (!proc || proc.tenantId !== tenantId) {
      throw new Error('Processo não encontrado ou sem permissão de acesso.');
    }

    const documents = documentsDb.findAll(d => d.processId === processId && d.tenantId === tenantId);
    const ocrResults = [];
    const allExtractedFields = [];

    // 2. Extração OCR para cada documento
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];

      AuditService.log({
        tenantId,
        processId,
        userId,
        userName,
        action: 'OCR_STARTED',
        details: { documentId: doc.id, fileName: doc.originalName, provider: ocrProvider.name }
      });

      let ocrRes;
      try {
        const localFilePath = (await StorageService.ensureLocalFile(doc.id, tenantId)) || StorageService.resolveLocalPath(doc.storagePath);
        ocrRes = await ocrProvider.extractText(localFilePath, doc.mimeType);
      } catch (err) {
        ocrRes = {
          success: false,
          text: '',
          pages: [],
          confidence: 0,
          error: err.message
        };
      }

      if (ocrRes.success) {
        AuditService.log({
          tenantId,
          processId,
          userId,
          userName,
          action: 'OCR_COMPLETED',
          details: { documentId: doc.id, textLength: ocrRes.text.length, confidence: ocrRes.confidence }
        });
      } else {
        AuditService.log({
          tenantId,
          processId,
          userId,
          userName,
          action: 'OCR_FAILED',
          details: { documentId: doc.id, error: ocrRes.error }
        });
      }

      const ocrEntry = {
        documentId: doc.id,
        documentName: doc.originalName,
        text: ocrRes.text || '',
        pages: ocrRes.pages || [],
        confidence: ocrRes.confidence || 0,
        source: ocrRes.source || 'OCR',
        metadata: ocrRes.metadata || {},
        error: ocrRes.error || null
      };

      ocrResults.push(ocrEntry);

      // Armazena texto extraído no banco
      extractedTextDb.insert({
        tenantId,
        processId,
        documentId: doc.id,
        jobId,
        text: ocrRes.text || '',
        confidence: ocrRes.confidence || 0,
        source: ocrRes.source || 'OCR'
      });

      // Extração de campos estruturados
      const docFields = ExtractionService.extractFromDocument({
        documentId: doc.id,
        documentName: doc.originalName,
        pages: ocrRes.pages || [{ pageNumber: 1, text: ocrRes.text || '', confidence: ocrRes.confidence || 0.9 }],
        source: ocrRes.source || 'OCR'
      });

      docFields.forEach(fld => {
        extractedFieldsDb.insert({
          ...fld,
          tenantId,
          processId,
          jobId
        });
        allExtractedFields.push(fld);
      });
    }

    // 3. Comparação de documentos e validações determinísticas
    analysisJobsDb.update(jobId, {
      progress: 65,
      stage: 'Comparando documentos e validando consistência...'
    });

    const deterministicReport = ValidationEngine.run({
      process: proc,
      documents,
      extractedFields: allExtractedFields,
      ocrResults
    });

    // Registra cada achado no banco e auditoria
    deterministicReport.findings.forEach(finding => {
      findingsDb.insert({
        ...finding,
        tenantId,
        processId,
        jobId
      });

      AuditService.log({
        tenantId,
        processId,
        userId,
        userName,
        action: 'FINDING_CREATED',
        details: { code: finding.code, severity: finding.severity, title: finding.title }
      });
    });

    // 4. Camada de Síntese Inteligente (IA) - Estritamente após as regras
    analysisJobsDb.update(jobId, {
      progress: 85,
      stage: 'Organizando achados e gerando diagnóstico...'
    });

    const aiReport = AIAnalysisProvider.analyze({
      deterministicReport,
      extractedFields: allExtractedFields
    });

    aiAnalysisDb.insert({
      tenantId,
      processId,
      jobId,
      summary: aiReport.summary,
      findings: aiReport.findings,
      confidence: aiReport.confidence
    });

    // 5. Determinação do estado final do Job
    let finalStatus = 'COMPLETED';
    if (deterministicReport.status === CLASSIFICATION.ATENCAO) {
      finalStatus = 'NEEDS_REVIEW';
    }

    const compiledResult = {
      jobId,
      status: deterministicReport.status,
      score: deterministicReport.score,
      scoreMax: 100,
      deductions: deterministicReport.deductions,
      findings: deterministicReport.findings,
      aiSummary: aiReport.summary,
      aiFindings: aiReport.findings,
      analyzedDocuments: ocrResults.map(r => ({
        documentId: r.documentId,
        documentName: r.documentName,
        confidence: r.confidence,
        textSnippet: r.text.slice(0, 150)
      })),
      extractedFields: allExtractedFields,
      disclaimer: deterministicReport.disclaimer,
      completedAt: new Date().toISOString()
    };

    analysisJobsDb.update(jobId, {
      status: finalStatus,
      progress: 100,
      stage: 'Análise concluída com sucesso.',
      result: compiledResult
    });

    AuditService.log({
      tenantId,
      processId,
      userId,
      userName,
      action: 'ANALYSIS_COMPLETED',
      details: { jobId, score: deterministicReport.score, status: deterministicReport.status }
    });
  }

  static getJob(jobId, tenantId) {
    const job = analysisJobsDb.findById(jobId);
    if (!job || job.tenantId !== tenantId) {
      return null;
    }
    return job;
  }

  static getLatestForProcess(processId, tenantId) {
    const jobs = analysisJobsDb.findAll(j => j.processId === processId && j.tenantId === tenantId);
    if (jobs.length === 0) return null;

    jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return jobs[0];
  }

  static getHistoryForProcess(processId, tenantId) {
    const jobs = analysisJobsDb.findAll(j => j.processId === processId && j.tenantId === tenantId);
    return jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}
