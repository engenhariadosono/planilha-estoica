export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada' });

  const { dados } = req.body || {};
  if (!dados) return res.status(400).json({ error: 'Dados financeiros não enviados' });

  const systemPrompt = `Você é um consultor financeiro pessoal especializado em finanças brasileiras e metodologia FIRE (Financial Independence, Retire Early).
Analise os dados financeiros do usuário com precisão matemática e linguagem direta, sem enrolação.
Use R$ para valores. Use formato brasileiro (vírgula para decimais).
Seja específico com números: calcule exatamente, não estime vagamente.
Responda em português brasileiro.
Estruture sua resposta com seções claras usando emojis como marcadores.`;

  const userMessage = `Analise minha situação financeira atual e faça cálculos precisos:

${JSON.stringify(dados, null, 2)}

Quero que você:
1. 💰 FLUXO DE CAIXA: Calcule entradas vs saídas, saldo mensal real, se estou no positivo ou negativo
2. 📊 DESPESAS: Identifique as maiores, percentual de cada uma na renda, onde estou gastando mais
3. 💳 DÍVIDAS: Para cada dívida, calcule: total em aberto, meses para quitar no ritmo atual, juros estimados acumulados
4. ⚡ CONTAS URGENTES: Some o total a pagar nos próximos 30, 60 e 90 dias. Avise se vai faltar dinheiro
5. 📈 PROJEÇÃO FIRE: Com o saldo mensal atual, quando atingirei independência financeira? (meta: 25x despesas anuais)
6. 🎯 TOP 3 AÇÕES: As 3 ações concretas mais importantes que devo tomar agora para melhorar minha situação

Seja direto e use números exatos em todos os cálculos.`;

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
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    return res.status(502).json({ error: 'Erro na API Claude', detail: err });
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  return res.json({ ok: true, analise: text });
}
