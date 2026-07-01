import { PERIODOS, SYSTEM_PROMPT, montarPromptUsuario } from '../agents/prompts.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const SUPABASE_URL = 'https://hryoghxhqiyrqmppimcy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_aPq6AgF3lnUqDv3_ROMfbQ_vOCSy-XT';
const MAX_HISTORICO = 10;

async function buscarEstadoCompleto() {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/planilha_dados?id=eq.1&select=conteudo_json`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!resp.ok) throw new Error('Erro ao buscar dados financeiros no Supabase');
  const rows = await resp.json();
  const dados = rows?.[0]?.conteudo_json;
  if (!dados) throw new Error('Nenhum dado financeiro encontrado — abra o app pelo menos uma vez antes de gerar um diagnóstico');
  return dados;
}

async function salvarEstadoCompleto(dados) {
  const { _sid, ...semSid } = dados;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/planilha_dados?id=eq.1`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ conteudo_json: semSid }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Erro ao salvar diagnóstico no Supabase: ${err}`);
  }
}

async function gerarConteudo(periodo, dados, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: montarPromptUsuario(periodo, dados) }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API erro (${periodo}): ${err}`);
  }
  const data = await response.json();
  return data.content?.[0]?.text || '';
}

function anexarDiagnostico(dados, periodo, conteudo) {
  if (!dados.diagnosticos || typeof dados.diagnosticos !== 'object') dados.diagnosticos = {};
  const lista = Array.isArray(dados.diagnosticos[periodo]) ? dados.diagnosticos[periodo] : [];
  lista.unshift({ gerado_em: new Date().toISOString(), conteudo, modo: 'api' });
  dados.diagnosticos[periodo] = lista.slice(0, MAX_HISTORICO);
}

// Busca a versao MAIS RECENTE (nao a que foi lida no inicio, antes da chamada
// a IA) antes de gravar. A chamada ao Claude leva 10-20s; se o usuario editar
// algo no app durante esse tempo, gravar por cima do snapshot antigo apagaria
// essa edicao. Reduz a janela de corrida para o intervalo minimo entre este
// fetch e o PATCH, em vez do tempo inteiro da geracao.
async function salvarDiagnosticos(pares) {
  const fresco = await buscarEstadoCompleto();
  pares.forEach(([periodo, conteudo]) => anexarDiagnostico(fresco, periodo, conteudo));
  await salvarEstadoCompleto(fresco);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada' });

  let dados;
  try {
    dados = await buscarEstadoCompleto();
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }

  const periodoManual = (req.query?.periodo || req.body?.periodo || '').toLowerCase();

  try {
    if (periodoManual) {
      if (!PERIODOS[periodoManual]) return res.status(400).json({ error: 'periodo inválido' });
      const conteudo = await gerarConteudo(periodoManual, dados, apiKey);
      await salvarDiagnosticos([[periodoManual, conteudo]]);
      return res.json({ ok: true, periodo: periodoManual, conteudo });
    }

    // Disparo automático via cron diário: decide quais períodos estão "devidos" hoje (horário de Brasília, UTC-3)
    const brasilia = new Date(Date.now() - 3 * 3600000);
    const diaSemana = brasilia.getUTCDay(); // 1 = segunda-feira
    const diaMes = brasilia.getUTCDate();
    const mes = brasilia.getUTCMonth(); // 0 = janeiro

    const devidos = ['diario'];
    if (diaSemana === 1) devidos.push('semanal');
    if (diaMes === 1 || diaMes === 15) devidos.push('quinzenal');
    if (diaMes === 1) devidos.push('mensal');
    if (diaMes === 1 && mes === 0) devidos.push('anual');

    const gerados = await Promise.all(devidos.map(p => gerarConteudo(p, dados, apiKey)));
    await salvarDiagnosticos(devidos.map((p, i) => [p, gerados[i]]));

    return res.json({ ok: true, gerados: devidos });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
