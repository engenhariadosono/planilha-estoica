export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

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

  const today = new Date();
  const in30 = new Date(today); in30.setDate(today.getDate() + 30);
  const defaultVenc = in30.toISOString().split('T')[0];

  const prompt = `Você é um assistente financeiro. Analise este documento (boleto, conta, fatura, extrato ou nota fiscal) e extraia as informações.

Retorne SOMENTE um JSON válido com esta estrutura:
{
  "descricao": "nome do estabelecimento ou tipo de conta (ex: Conta de Luz, Aluguel, Cartão Nubank)",
  "valor": 0.00,
  "vencimento": "YYYY-MM-DD",
  "categoria": "Moradia|Alimentação|Transporte|Saúde|Lazer|Serviços|Educação|Outros"
}

Regras:
- valor: número decimal sem R$ (ex: 1800.00). Se não encontrar, use 0.
- vencimento: formato YYYY-MM-DD. Se não encontrar, use ${defaultVenc}.
- Retorne APENAS o JSON, sem markdown, sem texto adicional.`;

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }]
  };

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: fetchHeaders,
    body: JSON.stringify(body)
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    return res.status(502).json({ error: 'Erro na API Claude', detail: err });
  }

  const claudeData = await claudeRes.json();
  const text = (claudeData.content?.[0]?.text || '').replace(/```json\n?|\n?```/g, '').trim();

  try {
    const parsed = JSON.parse(text);
    return res.json({ ok: true, data: parsed });
  } catch {
    return res.json({ ok: false, raw: text, error: 'Não foi possível extrair os dados' });
  }
}
