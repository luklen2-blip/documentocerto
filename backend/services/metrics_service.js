import {
  organizationsDb,
  usersDb,
  processesDb,
  documentsDb,
  analysisJobsDb,
  kiwifyTransactionsDb,
  kiwifyWebhookEventsDb
} from '../database/index.js';
import { isPostgresConfigured, query } from '../database/pg_pool.js';

export class MetricsService {
  /**
   * Calcula métricas em tempo real diretamente no PostgreSQL Neon
   * com fallback transparente para o repositório JsonDB em modo local.
   */
  static async getConversionMetrics() {
    if (isPostgresConfigured()) {
      return await this._getPostgresMetrics();
    }
    return this._getJsonDbMetrics();
  }

  /**
   * Computação de alta velocidade via queries SQL no PostgreSQL
   */
  static async _getPostgresMetrics() {
    try {
      // 1. Métricas de Organizações e Funil de Trial
      const orgQuery = await query(`
        SELECT 
          COUNT(*)::int AS total_organizacoes,
          COUNT(*) FILTER (WHERE trial_ativo = TRUE AND trial_expira_em > NOW())::int AS trials_ativos,
          COUNT(*) FILTER (WHERE plano = 'GRATIS' AND (trial_ativo = FALSE OR trial_expira_em <= NOW()))::int AS trials_expirados,
          COUNT(*) FILTER (WHERE plano = 'VITALICIO')::int AS vitalicios_ativos,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS cadastros_hoje,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS cadastros_ultimos_7_dias
        FROM organizations;
      `);

      // 2. Métricas de Usuários, Processos e Documentos
      const countsQuery = await query(`
        SELECT 
          (SELECT COUNT(*)::int FROM users) AS total_usuarios,
          (SELECT COUNT(*)::int FROM processes) AS total_processos,
          (SELECT COUNT(*)::int FROM documents) AS total_documentos,
          (SELECT COUNT(*)::int FROM analysis_jobs) AS total_conferencias;
      `);

      // 3. Métricas de Receita e Transações Kiwify (Sem dupla contagem, com estornos segregados)
      const financialQuery = await query(`
        SELECT 
          COALESCE(SUM(valor_pago) FILTER (WHERE status = 'PAID'), 0)::numeric(10,2) AS receita_consolidada,
          COALESCE(SUM(valor_pago) FILTER (WHERE status = 'PAID_PENDING_CLAIM'), 0)::numeric(10,2) AS receita_pendente,
          COALESCE(SUM(valor_pago) FILTER (WHERE status IN ('REFUNDED', 'CHARGEDBACK')), 0)::numeric(10,2) AS total_estornado,
          COUNT(*) FILTER (WHERE status = 'PAID')::int AS transacoes_consolidadas,
          COUNT(*) FILTER (WHERE status = 'PAID_PENDING_CLAIM')::int AS transacoes_pendentes,
          COUNT(*) FILTER (WHERE status IN ('REFUNDED', 'CHARGEDBACK'))::int AS transacoes_estornadas
        FROM kiwify_transactions;
      `);

      // 4. Últimas 10 transações para o gestor
      const recentTxQuery = await query(`
        SELECT 
          id, order_id, customer_email, customer_name, valor_pago,
          payment_method, status, claimed_at, created_at
        FROM kiwify_transactions
        ORDER BY created_at DESC
        LIMIT 10;
      `);

      const orgData = orgQuery.rows[0] || {};
      const countsData = countsQuery.rows[0] || {};
      const finData = financialQuery.rows[0] || {};

      const totalOrgs = orgData.total_organizacoes || 0;
      const vitalicios = orgData.vitalicios_ativos || 0;
      const taxaConversaoNum = totalOrgs > 0 ? (vitalicios / totalOrgs) * 100 : 0;
      const taxaConversao = `${taxaConversaoNum.toFixed(1)}%`;

      const receitaConsolidada = parseFloat(finData.receita_consolidada || 0);
      const receitaPendente = parseFloat(finData.receita_pendente || 0);
      const totalEstornado = parseFloat(finData.total_estornado || 0);
      const receitaBruta = Math.max(receitaConsolidada + receitaPendente, vitalicios * 19.90);
      const receitaLiquida = Math.max(0, receitaBruta - totalEstornado);

      return {
        funil: {
          totalCadastros: totalOrgs,
          trialsAtivos: orgData.trials_ativos || 0,
          trialsExpirados: orgData.trials_expirados || 0,
          vitaliciosAtivos: vitalicios,
          taxaConversao,
          taxaConversaoPercentual: parseFloat(taxaConversaoNum.toFixed(1))
        },
        operacional: {
          totalUsuarios: countsData.total_usuarios || 0,
          totalProcessos: countsData.total_processos || 0,
          totalDocumentos: countsData.total_documentos || 0,
          totalConferenciasInteligentes: countsData.total_conferencias || 0
        },
        crescimento: {
          cadastrosHoje: orgData.cadastros_hoje || 0,
          cadastrosUltimos7Dias: orgData.cadastros_ultimos_7_dias || 0
        },
        financeiro: {
          receitaTotalBruta: receitaBruta,
          receitaConsolidada,
          receitaPendente,
          totalEstornado,
          receitaLiquida,
          receitaFormatada: `R$ ${receitaLiquida.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          totalTransacoesPagas: finData.transacoes_consolidadas || vitalicios,
          transacoesPendentesResgate: finData.transacoes_pendentes || 0,
          transacoesEstornadas: finData.transacoes_estornadas || 0,
          ticketMedio: 19.90
        },
        ultimasTransacoes: recentTxQuery.rows || [],
        storageEngine: 'PostgreSQL Neon'
      };
    } catch (err) {
      console.warn('[MetricsService] Erro na query PostgreSQL, aplicando fallback para repositório:', err.message);
      return this._getJsonDbMetrics();
    }
  }

  /**
   * Computação em memória para ambiente de testes e modo compatível
   */
  static _getJsonDbMetrics() {
    const orgs = organizationsDb.findAll();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let trialsAtivos = 0;
    let trialsExpirados = 0;
    let vitaliciosAtivos = 0;
    let cadastrosHoje = 0;
    let cadastros7Dias = 0;

    for (const org of orgs) {
      const createdAt = new Date(org.createdAt);
      if (org.createdAt && org.createdAt.slice(0, 10) === todayStr) {
        cadastrosHoje++;
      }
      if (createdAt >= sevenDaysAgo) {
        cadastros7Dias++;
      }

      if (org.plano === 'VITALICIO') {
        vitaliciosAtivos++;
      } else if (org.trialAtivo && org.trialExpiraEm && new Date(org.trialExpiraEm) > now) {
        trialsAtivos++;
      } else {
        trialsExpirados++;
      }
    }

    const totalOrgs = orgs.length;
    const taxaConversaoNum = totalOrgs > 0 ? (vitaliciosAtivos / totalOrgs) * 100 : 0;
    const taxaConversao = `${taxaConversaoNum.toFixed(1)}%`;

    const txs = kiwifyTransactionsDb.findAll();
    const paidTxs = txs.filter(t => t.status === 'PAID');
    const pendingTxs = txs.filter(t => t.status === 'PAID_PENDING_CLAIM');
    const refundedTxs = txs.filter(t => t.status === 'REFUNDED' || t.status === 'CHARGEDBACK');

    const receitaConsolidada = paidTxs.reduce((acc, t) => acc + (parseFloat(t.valorPago) || 0), 0);
    const receitaPendente = pendingTxs.reduce((acc, t) => acc + (parseFloat(t.valorPago) || 0), 0);
    const totalEstornado = refundedTxs.reduce((acc, t) => acc + (parseFloat(t.valorPago) || 0), 0);
    const receitaBruta = Math.max(receitaConsolidada + receitaPendente, vitaliciosAtivos * 19.90);
    const receitaLiquida = Math.max(0, receitaBruta - totalEstornado);

    const sortedTxs = [...txs]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 10);

    return {
      funil: {
        totalCadastros: totalOrgs,
        trialsAtivos,
        trialsExpirados,
        vitaliciosAtivos,
        taxaConversao,
        taxaConversaoPercentual: parseFloat(taxaConversaoNum.toFixed(1))
      },
      operacional: {
        totalUsuarios: usersDb.findAll().length,
        totalProcessos: processesDb.findAll().length,
        totalDocumentos: documentsDb.findAll().length,
        totalConferenciasInteligentes: analysisJobsDb.findAll().length
      },
      crescimento: {
        cadastrosHoje,
        cadastrosUltimos7Dias: cadastros7Dias
      },
      financeiro: {
        receitaTotalBruta: receitaBruta,
        receitaConsolidada,
        receitaPendente,
        totalEstornado,
        receitaLiquida,
        receitaFormatada: `R$ ${receitaLiquida.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        totalTransacoesPagas: paidTxs.length || vitaliciosAtivos,
        transacoesPendentesResgate: pendingTxs.length,
        transacoesEstornadas: refundedTxs.length,
        ticketMedio: 19.90
      },
      ultimasTransacoes: sortedTxs,
      storageEngine: 'JsonDB (Local/Compat)'
    };
  }
}
