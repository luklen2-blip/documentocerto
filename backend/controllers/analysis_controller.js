import { AnalysisJobService } from '../services/analysis_job_service.js';
import { processesDb } from '../database/index.js';
import { AuditService } from '../services/audit_service.js';

export class AnalysisController {
  static async run(req, res) {
    try {
      const { processId } = req.params;
      const isReanalysis = req.body?.isReanalysis || false;

      const proc = processesDb.findById(processId);
      if (!proc) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Processo não encontrado.' }
        });
      }

      // MANDATÓRIO: Verificação de isolamento multi-tenant
      if (proc.tenantId !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'CROSS_TENANT_ACCESS_DENIED',
            message: 'Acesso negado: o processo pertence a outra organização.'
          }
        });
      }

      const job = await AnalysisJobService.startJob({
        tenantId: req.user.tenantId,
        processId,
        userId: req.user.id,
        userName: req.user.nome,
        isReanalysis
      });

      return res.status(202).json({
        success: true,
        data: job,
        message: isReanalysis ? 'Reanálise iniciada com sucesso.' : 'Análise inteligente iniciada com sucesso.'
      });
    } catch (err) {
      console.error('[AnalysisController.run]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao iniciar análise inteligente.' }
      });
    }
  }

  static async getJobStatus(req, res) {
    try {
      const { jobId } = req.params;
      const job = AnalysisJobService.getJob(jobId, req.user.tenantId);

      if (!job) {
        return res.status(404).json({
          success: false,
          error: { code: 'JOB_NOT_FOUND', message: 'Job de análise não encontrado ou sem permissão.' }
        });
      }

      return res.status(200).json({
        success: true,
        data: job
      });
    } catch (err) {
      console.error('[AnalysisController.getJobStatus]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao consultar status do job.' }
      });
    }
  }

  static async getLatest(req, res) {
    try {
      const { processId } = req.params;
      const proc = processesDb.findById(processId);

      if (!proc) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Processo não encontrado.' }
        });
      }

      // MANDATÓRIO: Verificação de isolamento multi-tenant
      if (proc.tenantId !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'CROSS_TENANT_ACCESS_DENIED',
            message: 'Acesso negado: o processo pertence a outra organização.'
          }
        });
      }

      const latestJob = AnalysisJobService.getLatestForProcess(processId, req.user.tenantId);

      if (latestJob) {
        AuditService.log({
          tenantId: req.user.tenantId,
          processId,
          userId: req.user.id,
          userName: req.user.nome,
          action: 'ANALYSIS_VIEWED',
          details: { jobId: latestJob.id, version: latestJob.version }
        });
      }

      return res.status(200).json({
        success: true,
        data: latestJob
      });
    } catch (err) {
      console.error('[AnalysisController.getLatest]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao obter última análise.' }
      });
    }
  }

  static async getHistory(req, res) {
    try {
      const { processId } = req.params;
      const proc = processesDb.findById(processId);

      if (!proc || proc.tenantId !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          error: { code: 'CROSS_TENANT_ACCESS_DENIED', message: 'Acesso negado ao histórico do processo.' }
        });
      }

      const history = AnalysisJobService.getHistoryForProcess(processId, req.user.tenantId);

      return res.status(200).json({
        success: true,
        data: history
      });
    } catch (err) {
      console.error('[AnalysisController.getHistory]:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Erro ao listar histórico de análises.' }
      });
    }
  }
}
