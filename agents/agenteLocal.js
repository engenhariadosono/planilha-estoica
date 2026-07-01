// ============================================================
// AGENTE LOCAL — WebLLM (roda no navegador via WebGPU)
// Carregado via CDN (ESM) — sem npm/bundler neste projeto.
// ============================================================

const MODELOS = {
  'gemma-2-2b-it-q4f16_1-MLC': {
    nome: 'Gemma 2 2B', tamanhoGB: 1.5, ramMinima: 4, recomendado: true,
  },
  'Qwen2.5-3B-Instruct-q4f16_1-MLC': {
    nome: 'Qwen 2.5 3B', tamanhoGB: 2.8, ramMinima: 6, recomendado: false,
  },
  'Llama-3.2-3B-Instruct-q4f16_1-MLC': {
    nome: 'Llama 3.2 3B', tamanhoGB: 2.5, ramMinima: 6, recomendado: false,
  },
};

let engine = null;
let modeloAtual = null;
let carregando = null; // Promise em andamento, evita corrida se chamado 2x

export function selecionarModelo(memoriaGB) {
  const ram = memoriaGB || 4;
  const compativeis = Object.entries(MODELOS)
    .filter(([, cfg]) => cfg.ramMinima <= ram)
    .sort((a, b) => b[1].tamanhoGB - a[1].tamanhoGB);
  if (compativeis.length === 0) return 'gemma-2-2b-it-q4f16_1-MLC';
  const recomendado = compativeis.find(([, c]) => c.recomendado);
  return (recomendado || compativeis[0])[0];
}

export async function inicializar(modeloId, onProgress) {
  if (engine && modeloAtual === modeloId) return;
  if (carregando) return carregando;

  carregando = (async () => {
    const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm');
    const cfg = MODELOS[modeloId] || { nome: modeloId, tamanhoGB: '?' };
    onProgress?.(`Baixando ${cfg.nome} (~${cfg.tamanhoGB}GB) — só na primeira vez...`);
    engine = await CreateMLCEngine(modeloId, {
      initProgressCallback: (p) => onProgress?.(p.text || `Carregando ${cfg.nome}...`),
    });
    modeloAtual = modeloId;
  })();

  try {
    await carregando;
  } finally {
    carregando = null;
  }
}

export async function analisar(systemPrompt, userMessage, maxTokens = 1400) {
  if (!engine) throw new Error('Modelo local não inicializado');
  const resposta = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: maxTokens,
    temperature: 0.4,
  });
  return resposta.choices?.[0]?.message?.content || '';
}

export function descarregar() {
  if (engine) { engine.unload?.(); engine = null; modeloAtual = null; }
}
