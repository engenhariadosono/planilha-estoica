// ============================================================
// AGENTE OFFLINE — 4 vozes estoicas, cálculo puro (sem IA)
// Funciona sempre, em qualquer dispositivo, sem internet.
// Adaptado ao formato real de dados do app (S.receitas, S.despesas,
// S.dividas, S.ativos, S.reserva, S.marcos, S.orcamentoCats).
// ============================================================

function fmtR(v) {
  return 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function transacoesUnificadas(dados) {
  const receitas = (dados.receitas || []).map(r => ({ tipo: 'receita', categoria: 'Renda', desc: r.desc, valor: r.valor || 0, data: r.data }));
  const despesas = (dados.despesas || []).map(d => ({ tipo: 'despesa', categoria: d.cat || 'Outros', desc: d.desc, valor: d.valor || 0, data: d.data }));
  return [...receitas, ...despesas];
}

// ═══════════════════════════════════════════
// SÊNECA — Fluxo de Caixa Diário
// ═══════════════════════════════════════════
function analisarSeneca(dados) {
  const insights = [];
  const transacoes = transacoesUnificadas(dados);
  const despesas = transacoes.filter(t => t.tipo === 'despesa');

  // Recorrências (mesma descrição aparecendo 2+ vezes)
  const agrupadas = {};
  despesas.forEach(d => {
    const chave = (d.desc || '').toLowerCase().trim() || d.categoria;
    (agrupadas[chave] = agrupadas[chave] || []).push(d);
  });
  const recorrencias = Object.values(agrupadas)
    .filter(l => l.length >= 2)
    .map(l => ({ valorMedio: l.reduce((s, t) => s + t.valor, 0) / l.length, frequencia: l.length }))
    .sort((a, b) => b.valorMedio - a.valorMedio);

  if (recorrencias.length > 0) {
    const totalMensal = recorrencias.reduce((s, r) => s + r.valorMedio, 0);
    insights.push(`**Recorrências:** ${recorrencias.length} gastos que se repetem somam ${fmtR(totalMensal)}/mês (${fmtR(totalMensal * 12)}/ano). Cada um é essencial ou apenas conveniente?`);
  }

  // Maior categoria
  const byCat = {};
  despesas.forEach(d => { byCat[d.categoria] = (byCat[d.categoria] || 0) + d.valor; });
  const categorias = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const totalDespesas = categorias.reduce((s, [, v]) => s + v, 0);
  if (categorias.length > 0) {
    const [cat, val] = categorias[0];
    const pct = totalDespesas > 0 ? Math.round((val / totalDespesas) * 100) : 0;
    insights.push(`**Maior categoria:** "${cat}" representa ${pct}% das suas despesas (${fmtR(val)}). Reflete seus valores ou é hábito automático?`);
  }

  // Gastos pequenos (< R$50) que somam
  const pequenos = despesas.filter(d => d.valor < 50);
  if (pequenos.length > 0) {
    const total = pequenos.reduce((s, d) => s + d.valor, 0);
    insights.push(`**Gastos invisíveis:** ${pequenos.length} pequenas compras somam ${fmtR(total)}. Pequenos valores, grande impacto somado.`);
  }

  const totalRenda = transacoes.filter(t => t.tipo === 'receita').reduce((s, t) => s + t.valor, 0);
  const taxaPoupanca = totalRenda > 0 ? ((totalRenda - totalDespesas) / totalRenda) * 100 : 0;
  if (taxaPoupanca < 20 && totalRenda > 0) {
    insights.push(`**Taxa de poupança:** ${taxaPoupanca.toFixed(1)}% — abaixo do ideal estoico de 20%. Qual pequeno luxo deste mês você trocaria por liberdade futura?`);
  } else if (totalRenda > 0) {
    insights.push(`**Taxa de poupança:** ${taxaPoupanca.toFixed(1)}% — acima do recomendado. A virtude da temperança está presente.`);
  }

  return insights.length > 0
    ? insights.map(i => `- ${i}`).join('\n')
    : 'Sem dados suficientes ainda para uma leitura do fluxo diário — continue registrando.';
}

// ═══════════════════════════════════════════
// MARCO AURÉLIO — Dívidas & Metas (O Resgate)
// ═══════════════════════════════════════════
function simulaQuitacao(saldoInicial, taxaMensalPct, parcela) {
  let saldo = saldoInicial, meses = 0, jurosTotal = 0;
  while (saldo > 0.01 && meses < 600) {
    const juros = saldo * (taxaMensalPct / 100);
    jurosTotal += juros;
    saldo = saldo + juros - parcela;
    if (saldo < 0) saldo = 0;
    meses++;
  }
  return { meses, jurosTotal: +jurosTotal.toFixed(2) };
}

function analisarMarcoAurelio(dados) {
  const dividas = dados.dividas || [];
  const marcos = dados.marcos || [];
  const ativos = dados.ativos || 0;
  const totalDividas = dividas.reduce((s, d) => s + (d.saldo || 0), 0);
  const patrimonioLiquido = ativos - totalDividas;

  let txtDividas;
  let alvo = null;
  if (dividas.length === 0) {
    txtDividas = 'Nenhuma dívida registrada — a liberdade já é sua neste front.';
  } else {
    const porJuros = [...dividas].sort((a, b) => (b.taxa || 0) - (a.taxa || 0));
    const porSaldo = [...dividas].sort((a, b) => (a.saldo || 0) - (b.saldo || 0));
    const maiorJuros = porJuros[0]?.taxa || 0;
    const menorSaldo = porSaldo[0]?.saldo || 0;

    let metodo, justificativa;
    if (menorSaldo < 500 && dividas.length > 1) {
      metodo = 'Bola de Neve';
      alvo = porSaldo[0];
      justificativa = `dívida pequena de ${fmtR(menorSaldo)} — quite-a primeiro para ganhar impulso motivacional.`;
    } else {
      metodo = 'Avalanche';
      alvo = porJuros[0];
      justificativa = `maior taxa de juros (${maiorJuros}% a.m.) — elimine-a primeiro, é matematicamente superior.`;
    }
    const sim = simulaQuitacao(alvo.saldo || 0, alvo.taxa || 0, alvo.parcela || 0);
    txtDividas = `Método **${metodo}** recomendado: ataque "${alvo.nome || alvo.desc || 'esta dívida'}" — ${justificativa} No ritmo da parcela atual (${fmtR(alvo.parcela)}/mês), a quitação leva **${sim.meses} meses**, com **${fmtR(sim.jurosTotal)}** em juros acumulados.`;
  }

  let txtMetas;
  if (marcos.length === 0) {
    txtMetas = 'Nenhuma meta/marco definido — sem direção não há progresso mensurável.';
  } else {
    txtMetas = marcos.map(m => {
      const pct = m.valor > 0 ? Math.min(100, Math.max(0, (patrimonioLiquido / m.valor) * 100)) : 0;
      return `"${m.titulo}" (${fmtR(m.valor)}) — ${pct.toFixed(1)}% do caminho percorrido pelo patrimônio atual.`;
    }).join('\n- ');
    txtMetas = '- ' + txtMetas;
  }

  const ordemSemana = alvo
    ? `Ligue para o credor de "${alvo.nome || alvo.desc || 'sua dívida'}" e negocie um desconto para quitação à vista.`
    : marcos.length > 0
      ? `Revise o aporte mensal destinado à meta "${marcos[0].titulo}".`
      : 'Revise suas categorias de orçamento e identifique uma despesa redutível em 10%.';

  return `${txtDividas}\n\n**Metas:**\n${txtMetas}\n\n**Ordem da semana:** ${ordemSemana}`;
}

// ═══════════════════════════════════════════
// EPICTETO — A Liberdade (Projeção FIRE)
// ═══════════════════════════════════════════
function analisarEpicteto(dados) {
  const despesas = dados.despesas || [];
  const receitas = dados.receitas || [];
  const ativos = dados.ativos || 0;
  const dividas = dados.dividas || [];

  const despesaMensal = despesas.reduce((s, d) => s + (d.valor || 0), 0);
  const rendaMensal = receitas.reduce((s, r) => s + (r.valor || 0), 0);
  const totalDividas = dividas.reduce((s, d) => s + (d.saldo || 0), 0);
  const patrimonioLiquido = ativos - totalDividas;
  const saldoMes = rendaMensal - despesaMensal;
  const taxaPoupanca = rendaMensal > 0 ? (saldoMes / rendaMensal) * 100 : 0;

  const despesaAnual = despesaMensal * 12;
  const numeroFire = despesaAnual * 25;
  const progressoFire = numeroFire > 0 ? Math.min(100, (ativos / numeroFire) * 100) : 0;

  const aporteMensal = Math.max(0, saldoMes);
  function anosAte(taxaMensal) {
    let p = ativos, m = 0;
    while (p < numeroFire && m < 600) { p = p * (1 + taxaMensal) + aporteMensal; m++; }
    return (m / 12).toFixed(1);
  }
  const cenarios = numeroFire > 0
    ? `Otimista (10% a.a.): ${anosAte(0.10 / 12)} anos · Realista (7% a.a.): ${anosAte(0.07 / 12)} anos · Conservador (4% a.a.): ${anosAte(0.04 / 12)} anos`
    : 'Registre despesas para calcular a projeção.';

  const rendaPassivaDiaria = (patrimonioLiquido * 0.07) / 365;

  const mesesReserva = despesaMensal > 0 ? (dados.reserva?.acumulado || 0) / despesaMensal : 0;
  const avaliacaoEstresse = mesesReserva >= 6
    ? 'Margem de segurança robusta — a tranquilidade estoica está bem construída.'
    : mesesReserva >= 1
      ? 'Margem razoável, mas abaixo do ideal de 6-12 meses. Continue construindo.'
      : 'Margem baixa. Priorize a reserva de emergência antes de acelerar investimentos.';

  return `**Número FIRE:** ${fmtR(numeroFire)} (despesas anuais × 25). Você está em **${progressoFire.toFixed(1)}%** do caminho — faltam ${fmtR(Math.max(0, numeroFire - ativos))}.

**Cenários de projeção:** ${cenarios}

**Liberdade por hora:** seu patrimônio líquido gera hoje ~${fmtR(rendaPassivaDiaria)}/dia em renda passiva estimada (7% a.a.).

**Teste de estresse (reserva):** ${mesesReserva.toFixed(1)} meses de cobertura. ${avaliacaoEstresse}

**A única variável que importa:** aumentar a taxa de poupança atual (${taxaPoupanca.toFixed(1)}%) é o alavancador mais forte da sua liberdade — cada ponto percentual a mais antecipa meses de independência.`;
}

// ═══════════════════════════════════════════
// ATENA — Visão Sistêmica (Score Integral)
// ═══════════════════════════════════════════
function analisarAtena(dados) {
  const despesas = dados.despesas || [];
  const receitas = dados.receitas || [];
  const ativos = dados.ativos || 0;
  const dividas = dados.dividas || [];
  const totalDividas = dividas.reduce((s, d) => s + (d.saldo || 0), 0);

  const despesaMensal = despesas.reduce((s, d) => s + (d.valor || 0), 0);
  const rendaMensal = receitas.reduce((s, r) => s + (r.valor || 0), 0);
  const saldoMes = rendaMensal - despesaMensal;
  const taxaPoupanca = rendaMensal > 0 ? (saldoMes / rendaMensal) * 100 : 0;
  const numeroFire = despesaMensal * 12 * 25;
  const mesesReserva = despesaMensal > 0 ? (dados.reserva?.acumulado || 0) / despesaMensal : 0;

  const scoreFluxo = taxaPoupanca >= 30 ? 100 : taxaPoupanca >= 20 ? 80 : taxaPoupanca >= 10 ? 60 : taxaPoupanca >= 0 ? 40 : 20;

  let scoreDividas = 100;
  if (dividas.length > 0) {
    const razao = totalDividas / Math.max(rendaMensal * 12, 1);
    scoreDividas = razao < 0.1 ? 90 : razao < 0.3 ? 70 : razao < 0.5 ? 50 : razao < 1 ? 30 : 10;
  }

  const scoreReserva = mesesReserva >= 12 ? 100 : mesesReserva >= 6 ? 80 : mesesReserva >= 3 ? 60 : mesesReserva >= 1 ? 40 : 0;
  const scoreFire = numeroFire > 0 ? Math.min(100, Math.round((ativos / numeroFire) * 100)) : 0;
  const scoreHabitos = Object.keys(dados.orcamentoCats || {}).length > 0 ? 70 : 40;

  const scoreTotal = Math.round(scoreFluxo * 0.30 + scoreDividas * 0.25 + scoreReserva * 0.20 + scoreFire * 0.15 + scoreHabitos * 0.10);

  const avaliacao = scoreTotal >= 90 ? 'Excelência estoica — suas finanças refletem virtude e disciplina.'
    : scoreTotal >= 70 ? 'Bom caminho — base sólida, com espaço para aprimoramento.'
    : scoreTotal >= 50 ? 'Atenção necessária — algumas áreas pedem foco imediato.'
    : 'Alerta — reavalie suas prioridades financeiras com urgência.';

  const recomendacao = scoreTotal >= 90 ? 'Mantenha a disciplina — você está no caminho da excelência.'
    : scoreTotal >= 70 ? 'Foque em aumentar a taxa de poupança nos próximos meses.'
    : scoreTotal >= 50 ? 'Priorize quitação de dívidas caras e construção da reserva.'
    : 'Volte ao básico: registre cada gasto por 30 dias. A consciência é o primeiro passo.';

  return `| Área | Score |
|---|---|
| Fluxo de Caixa | ${scoreFluxo}/100 |
| Dívidas | ${scoreDividas}/100 |
| Reserva | ${scoreReserva}/100 |
| Progresso FIRE | ${scoreFire}/100 |
| Hábitos | ${scoreHabitos}/100 |

**Score Integral: ${scoreTotal}/100** — ${avaliacao}

**Recomendação estratégica:** ${recomendacao}`;
}

// ═══════════════════════════════════════════
// Combinação das 4 vozes em um único diagnóstico markdown
// ═══════════════════════════════════════════
export function gerarOffline(periodo, dados) {
  return `## 🕯️ Sêneca — Fluxo de Caixa Diário

${analisarSeneca(dados)}

## ⚔️ Marco Aurélio — Dívidas & Metas (O Resgate)

${analisarMarcoAurelio(dados)}

## 🏛️ Epicteto — A Liberdade (Projeção FIRE)

${analisarEpicteto(dados)}

## 🦉 Atena — Visão Sistêmica (Score Integral)

${analisarAtena(dados)}

---
*Diagnóstico ${periodo} gerado offline, sem IA — 4 vozes, cálculo direto sobre seus dados.*`;
}
