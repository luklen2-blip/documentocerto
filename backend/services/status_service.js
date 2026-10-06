export const STATUS_TYPES = {
  COMPLETO: 'APARENTEMENTE COMPLETO',
  ATENCAO: 'ATENÇÃO',
  INCOMPLETO: 'INCOMPLETO'
};

export const STATUS_COLORS = {
  [STATUS_TYPES.COMPLETO]: {
    color: 'emerald',
    icon: '🟢',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },
  [STATUS_TYPES.ATENCAO]: {
    color: 'amber',
    icon: '🟡',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200'
  },
  [STATUS_TYPES.INCOMPLETO]: {
    color: 'rose',
    icon: '🔴',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200'
  }
};

export class StatusService {
  /**
   * Calcula deterministamente o status de conformidade do processo documental.
   * Regra:
   * - 1 ou mais itens obrigatórios ausentes -> INCOMPLETO (🔴)
   * - Todos os obrigatórios presentes, mas há itens marcados para conferência -> ATENÇÃO (🟡)
   * - Todos os obrigatórios presentes e sem pendências de conferência -> APARENTEMENTE COMPLETO (🟢)
   */
  static calculate(processItens = []) {
    if (!Array.isArray(processItens) || processItens.length === 0) {
      return {
        status: STATUS_TYPES.INCOMPLETO,
        colorInfo: STATUS_COLORS[STATUS_TYPES.INCOMPLETO],
        totalItens: 0,
        obrigatoriosTotais: 0,
        obrigatoriosPresentes: 0,
        opcionaisTotais: 0,
        opcionaisPresentes: 0,
        documentosEncontrados: [],
        documentosFaltantes: [],
        itensParaConferencia: [],
        resumo: 'Nenhum item vinculado a este processo. O checklist precisa ser configurado.',
        disclaimer: 'Os resultados apresentados pelo DocumentoCerto são auxiliares e não substituem análise profissional, jurídica ou administrativa quando necessária.'
      };
    }

    const documentosEncontrados = [];
    const documentosFaltantes = [];
    const itensParaConferencia = [];

    let obrigatoriosTotais = 0;
    let obrigatoriosPresentes = 0;
    let opcionaisTotais = 0;
    let opcionaisPresentes = 0;

    for (const item of processItens) {
      const isObrigatorio = Boolean(item.obrigatorio);
      const hasDocument = Boolean(item.documentoId || (item.documento && item.documento.id));
      const hasObservacao = Boolean(item.observacoes && item.observacoes.trim().length > 0);
      const isMarcadoConferir = item.statusItem === 'conferir' || item.statusItem === 'atencao' || hasObservacao;

      if (isObrigatorio) {
        obrigatoriosTotais++;
        if (hasDocument) {
          obrigatoriosPresentes++;
        }
      } else {
        opcionaisTotais++;
        if (hasDocument) {
          opcionaisPresentes++;
        }
      }

      // Classificação granular
      if (hasDocument) {
        documentosEncontrados.push({
          id: item.id,
          nome: item.nome,
          obrigatorio: isObrigatorio,
          documento: item.documento || null,
          rotulo: '✅ Documento presente'
        });
      } else {
        documentosFaltantes.push({
          id: item.id,
          nome: item.nome,
          obrigatorio: isObrigatorio,
          motivo: isObrigatorio ? 'Documento aparentemente ausente (obrigatório)' : 'Documento opcional ausente',
          rotulo: isObrigatorio ? '❌ Documento aparentemente ausente' : '⚪ Documento opcional não enviado'
        });
      }

      if (isMarcadoConferir) {
        itensParaConferencia.push({
          id: item.id,
          nome: item.nome,
          obrigatorio: isObrigatorio,
          observacoes: item.observacoes || 'Item para conferência manual antes do envio.',
          rotulo: '⚠️ Recomenda-se verificar'
        });
      }
    }

    // Determinação do status
    let statusFinal = STATUS_TYPES.APARENTEMENTE_COMPLETO;
    let resumoTexto = '';

    const haObrigatorioFaltando = obrigatoriosTotais > obrigatoriosPresentes;
    const haItensConferencia = itensParaConferencia.length > 0;

    if (haObrigatorioFaltando) {
      statusFinal = STATUS_TYPES.INCOMPLETO;
      const faltantesObrigatorios = documentosFaltantes.filter(f => f.obrigatorio).length;
      resumoTexto = `Existem ${faltantesObrigatorios} documento(s) obrigatório(s) aparentemente ausente(s).`;
    } else if (haItensConferencia) {
      statusFinal = STATUS_TYPES.ATENCAO;
      resumoTexto = `Todos os documentos obrigatórios foram localizados, porém há ${itensParaConferencia.length} item(ns) para conferência com possível inconsistência.`;
    } else {
      statusFinal = STATUS_TYPES.COMPLETO;
      resumoTexto = `Todos os ${obrigatoriosTotais} documentos obrigatórios foram anexados e estão aparentemente completos.`;
    }

    return {
      status: statusFinal,
      colorInfo: STATUS_COLORS[statusFinal],
      totalItens: processItens.length,
      obrigatoriosTotais,
      obrigatoriosPresentes,
      opcionaisTotais,
      opcionaisPresentes,
      taxaCompletude: processItens.length > 0 ? Math.round(((obrigatoriosPresentes + opcionaisPresentes) / processItens.length) * 100) : 0,
      documentosEncontrados,
      documentosFaltantes,
      itensParaConferencia,
      resumo: resumoTexto,
      disclaimer: 'Os resultados apresentados pelo DocumentoCerto são auxiliares e não substituem análise profissional, jurídica ou administrativa quando necessária.'
    };
  }
}
