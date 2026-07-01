// ============================================================
// ORQUESTRADOR HÍBRIDO — Diagnóstico Estoico
// Cascata: IA Local (WebLLM, grátis/privado) → API Claude (nuvem)
// → Offline (regras, sem IA). Sempre entrega um resultado.
// ============================================================

import { detectarSuporteLocal } from './deviceDetector.js';
import * as agenteLocal from './agenteLocal.js';
import { gerarOffline } from './agenteOffline.js';
import { SYSTEM_PROMPT, montarPromptUsuario } from './prompts.js';

export async function gerarDiagnosticoHibrido(periodo, dados, onProgress) {
  const emit = (msg) => { try { onProgress?.(msg); } catch (e) {} };

  emit('Verificando o melhor modo de análise para este dispositivo...');
  let deteccao;
  try {
    deteccao = await detectarSuporteLocal();
  } catch (e) {
    deteccao = { compativel: false, motivo: 'Falha na detecção' };
  }

  if (deteccao.compativel) {
    try {
      emit(`🏠 IA Local disponível (${deteccao.navegador}, ~${deteccao.memoriaGB}GB RAM) — preparando modelo...`);
      const modeloId = agenteLocal.selecionarModelo(deteccao.memoriaGB);
      await agenteLocal.inicializar(modeloId, emit);
      emit('Gerando diagnóstico localmente, no seu dispositivo...');
      const conteudo = await agenteLocal.analisar(SYSTEM_PROMPT, montarPromptUsuario(periodo, dados));
      if (conteudo && conteudo.trim().length > 50) {
        return { conteudo, modo: 'local' };
      }
      throw new Error('Resposta local vazia ou incompleta');
    } catch (err) {
      console.warn('[Diagnóstico] IA local falhou, tentando API:', err.message);
      emit('IA local indisponível — tentando via nuvem (API Claude)...');
    }
  } else {
    emit(`Dispositivo sem suporte a IA local (${deteccao.motivo}) — usando API Claude...`);
  }

  // Camada 2: API Claude (serverless, salva automaticamente no servidor)
  try {
    const resp = await fetch(`/api/diagnostico?periodo=${periodo}`, { method: 'POST' });
    const json = await resp.json();
    if (!resp.ok || !json.ok) throw new Error(json.error || 'Erro na API');
    return { conteudo: json.conteudo, modo: 'api' };
  } catch (err) {
    console.warn('[Diagnóstico] API falhou, usando modo offline:', err.message);
    emit('Sem conexão com a IA — gerando diagnóstico offline por regras...');
  }

  // Camada 3: Offline (sempre funciona, sem rede e sem IA)
  const conteudo = gerarOffline(periodo, dados);
  return { conteudo, modo: 'offline' };
}
