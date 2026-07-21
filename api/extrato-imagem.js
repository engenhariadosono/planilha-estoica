export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

// Extrai TODAS as transações visíveis num print de extrato bancário (ou PDF).
// Diferente de api/analyze.js (um único boleto/conta -> um valor), aqui a
// imagem tem várias linhas — usa structured outputs (output_config.format)
// para garantir um array JSON válido em vez de confiar em regex sobre texto
// solto, que não escala para N itens por resposta.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no Vercel' });

  const { base64, mediaType } = req.body || {};
  if (!base64 || !mediaType) return res.status(400).json({ error: 'base64 e mediaType são obrigatórios' });

  const isPDF = mediaType === 'application/pdf';
  const contentBlock = isPDF
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

  const fetchHeaders = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (isPDF) fetchHeaders['anthropic-beta'] = 'pdfs-2024-09-25';

  const hoje = new Date().toISOString().split('T')[0];

  const prompt = `Você é um assistente financeiro. Esta imagem é um print (ou PDF) de extrato bancário/fatura, com uma lista de transações — pode misturar recebimentos (Pix recebido, depósitos) e saídas (compra no cartão, Pix enviado, pagamentos).

Extraia TODAS as transações visíveis, uma por uma. Não resuma, não pule nenhuma linha.

Para a data de cada transação: use a data que aparece junto ao detalhe daquela transação específica (formato DD/MM ou DD/MM HH:MM ao lado da descrição) — NÃO o cabeçalho de dia que agrupa a lista visualmente, pois eles podem divergir (o app pode agrupar pela data de exibição enquanto a linha mostra a data real da transação). Converta para YYYY-MM-DD. As datas não têm ano explícito: use o ano corrente, e se a data resultante cair no futuro em relação a hoje (${hoje}), use o ano anterior.

Para cada transação, classifique "tipo":
- "rec" (receita/entrada): Pix recebido, depósito, estorno a seu favor — normalmente exibido em azul/verde ou com sinal "+".
- "desp" (despesa/saída): compra no cartão, Pix enviado, pagamento, débito — normalmente exibido em vermelho ou com sinal "-".

"valor" é sempre um número positivo (o sinal já é dado pelo campo "tipo", não repita o sinal no valor).

"desc" é o nome do estabelecimento/destinatário da transação (ex: "BURGER KING", "MATHEUS NOGUEIRA"), sem o rótulo genérico ("Compra com Cartão", "Pix - Enviado") e sem o valor.

Retorne a lista completa via a estrutura de saída, sem comentários adicionais.`;

  const body = {
    model: 'claude-opus-4-8',
    max_tokens: 8192,
    messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            transacoes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  data: { type: 'string', description: 'YYYY-MM-DD' },
                  desc: { type: 'string' },
                  valor: { type: 'number' },
                  tipo: { type: 'string', enum: ['rec', 'desp'] },
                },
                required: ['data', 'desc', 'valor', 'tipo'],
                additionalProperties: false,
              },
            },
          },
          required: ['transacoes'],
          additionalProperties: false,
        },
      },
    },
  };

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: fetchHeaders,
    body: JSON.stringify(body),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    return res.status(502).json({ error: 'Erro na API Claude', detail: err });
  }

  const claudeData = await claudeRes.json();
  const text = claudeData.content?.[0]?.text || '';

  try {
    const parsed = JSON.parse(text);
    const transacoes = Array.isArray(parsed.transacoes) ? parsed.transacoes : [];
    return res.json({ ok: true, transacoes });
  } catch {
    return res.json({ ok: false, raw: text, error: 'Não foi possível extrair as transações' });
  }
}
