#!/usr/bin/env node
'use strict';
// ══════════════════════════════════════════════════════════════════
// Testes de regressão das fórmulas financeiras centrais.
//
// Roda direto contra o texto de index.html (extrai as funções puras da
// seção "CÁLCULOS BASE" e dos helpers de Empréstimos via casamento de
// chaves/marcadores) — testa o código real que vai pro ar, não uma cópia
// que pode divergir do original. Sem dependências: `node tests/formulas.test.js`.
//
// Cada atualização que mexer nessas fórmulas deve rodar isto antes do
// commit. Casos aqui travam bugs que já aconteceram em produção:
//   - patrimônio líquido não descontava empréstimos (commit 8151db6)
//   - vencimento do empréstimo ignorava a data contratada (commit 7a775eb)
//   - card de Reserva na aba Metas usava patrimônio líquido em vez do
//     valor acumulado, divergindo do resto do app (corrigido nesta sessão)
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX_PATH = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(INDEX_PATH, 'utf8');

function mainScriptSource() {
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const main = blocks.find(b => b.includes('CÁLCULOS BASE') && b.includes('_empTaxa'));
  if (!main) throw new Error('Não encontrei o bloco <script> principal em index.html (procurei por "CÁLCULOS BASE" e "_empTaxa").');
  return main;
}

// Extrai uma função `function NAME(...) { ... }` por casamento de chaves —
// robusto a mudança de linha, já que não depende de números de linha fixos.
function extractFunction(src, name) {
  const m = src.match(new RegExp(`function\\s+${name}\\s*\\(`));
  if (!m) throw new Error(`function ${name} não encontrada no script principal.`);
  const start = m.index;
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error(`Chaves desbalanceadas extraindo ${name}.`);
  return src.slice(start, i + 1);
}

// Extrai o conteúdo entre o cabeçalho "// <TITLE>" (ladeado por linhas de
// "// ══...") e o próximo cabeçalho de seção do mesmo formato.
function extractSection(src, title) {
  const headerIdx = src.indexOf('// ' + title);
  if (headerIdx === -1) throw new Error(`Seção "${title}" não encontrada.`);
  const afterHeaderLine = src.indexOf('\n', headerIdx) + 1;
  const closingSepIdx = src.indexOf('\n', afterHeaderLine) + 1; // pula a linha "// ══...══" de fechamento
  const nextSepIdx = src.indexOf('\n// ══', closingSepIdx);
  if (nextSepIdx === -1) throw new Error(`Fim da seção "${title}" não encontrado.`);
  return src.slice(closingSepIdx, nextSepIdx);
}

const mainSrc = mainScriptSource();

// CÁLCULOS BASE: totalRec, totalDesp, totalDiv, saldoMes, taxaPoupa,
// totalEmp, patriLiq, reservaMeta, reservaPct, reservaMesesCobertos.
// São `const NAME = () => ...`; viram `var` para existir como propriedade
// do objeto global do sandbox (top-level `const`/`let` via vm não aparecem
// em `sandbox.NAME`, só `var` e `function` aparecem).
const calcBaseSrc = extractSection(mainSrc, 'CÁLCULOS BASE').replace(/^const /gm, 'var ');

const empFns = ['_empTaxa', '_empSaldo', '_empProgresso', '_empDiaVenc', '_empProxVenc', '_empDataQuitacao']
  .map(name => extractFunction(mainSrc, name)).join('\n\n');

const integridadeFns = ['_numOk', '_integridadeOk'].map(name => extractFunction(mainSrc, name)).join('\n\n');

const mesesPtMatch = mainSrc.match(/const MESES_PT = \[.*?\];/);
if (!mesesPtMatch) throw new Error('MESES_PT não encontrado.');
const mesesPtSrc = mesesPtMatch[0].replace(/^const /, 'var ');
const fmtDateSrc = extractFunction(mainSrc, 'fmtDate');

function makeSandbox(S) {
  const sandbox = { S, console };
  vm.createContext(sandbox);
  vm.runInContext(mesesPtSrc + '\n' + fmtDateSrc + '\n' + empFns + '\n' + calcBaseSrc + '\n' + integridadeFns, sandbox, { filename: 'formulas-extract.js' });
  return sandbox;
}

function estadoBase(overrides) {
  return Object.assign({
    receitas: [], despesas: [], dividas: [], emprestimos: [],
    ativos: 0, reserva: { acumulado: 0, metaCustom: 0, prazo: 12 },
  }, overrides);
}

// ── mini test runner ──────────────────────────────────────────────
let pass = 0, fail = 0;
function close(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }
function check(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.error(`✗ FALHOU: ${desc}`); }
}

// ══ totais e patrimônio líquido ══
{
  const sb = makeSandbox(estadoBase({
    receitas: [{ valor: 5000 }, { valor: 300 }],
    despesas: [{ valor: 1200 }, { valor: 800 }],
    dividas: [{ saldo: 2000 }, { saldo: 500 }],
    ativos: 10000,
  }));
  check('totalRec soma receitas', sb.totalRec() === 5300);
  check('totalDesp soma despesas', sb.totalDesp() === 2000);
  check('totalDiv soma saldo das dívidas', sb.totalDiv() === 2500);
  check('saldoMes = receitas - despesas', sb.saldoMes() === 3300);
  check('taxaPoupa = saldoMes/receitas * 100', close(sb.taxaPoupa(), (3300 / 5300) * 100));
}

// Regressão do commit 8151db6: patrimônio líquido tem que descontar
// empréstimos, não só dívidas de rotativo.
{
  const semEmp = makeSandbox(estadoBase({ ativos: 10000, dividas: [{ saldo: 1000 }], emprestimos: [] }));
  const comEmp = makeSandbox(estadoBase({
    ativos: 10000, dividas: [{ saldo: 1000 }],
    emprestimos: [{ valor: 3000, parcelas: 12, parcela: 300, pagas: 0, data: '2026-01-05' }],
  }));
  check('patriLiq sem empréstimos = ativos - dívidas', semEmp.patriLiq() === 9000);
  check('patriLiq com empréstimo é MENOR que sem (empréstimo descontado)', comEmp.patriLiq() < semEmp.patriLiq());
  check('totalEmp > 0 quando há empréstimo com saldo devedor', comEmp.totalEmp() > 0);
  check('patriLiq = ativos - totalDiv - totalEmp', close(comEmp.patriLiq(), 10000 - comEmp.totalDiv() - comEmp.totalEmp()));
}

// Regressão desta sessão: a fórmula de reserva (meta/pct) precisa ser a
// MESMA em qualquer tela — não pode voltar a usar patrimônio líquido como
// numerador (era o bug do card da aba Metas).
{
  // ativos/dívidas grandes o suficiente para que patriLiq() dê um número bem
  // diferente de reserva.acumulado — se reservaPct() algum dia voltar a usar
  // patriLiq por engano, este teste denuncia.
  const sb = makeSandbox(estadoBase({
    despesas: [{ valor: 1000 }],
    ativos: 50000,
    dividas: [{ saldo: 20000 }],
    reserva: { acumulado: 3000, metaCustom: 0, prazo: 12 },
  }));
  const metaEsperada = 1000 * 12; // 12x despesas, sem metaCustom
  check('reservaMeta = 12x despesas quando não há metaCustom', sb.reservaMeta() === metaEsperada);
  check('reservaPct usa reserva.acumulado, não patrimônio líquido', close(sb.reservaPct(), (3000 / metaEsperada) * 100));
  check('reservaPct diverge do que daria usando patriLiq (prova que não é o bug antigo)', !close(sb.reservaPct(), (sb.patriLiq() / metaEsperada) * 100, 0.01));
  check('reservaMesesCobertos = acumulado / despesa mensal', close(sb.reservaMesesCobertos(), 3));

  const sbCustom = makeSandbox(estadoBase({
    despesas: [{ valor: 1000 }],
    reserva: { acumulado: 5000, metaCustom: 8000, prazo: 12 },
  }));
  check('reservaMeta respeita metaCustom quando definida (ignora 12x despesas)', sbCustom.reservaMeta() === 8000);
  check('reservaPct com metaCustom', close(sbCustom.reservaPct(), (5000 / 8000) * 100));
}

// ══ Empréstimos — tabela Price ══
// Round-trip: constrói o valor presente (PV) a partir de uma taxa mensal
// conhecida via fórmula direta da Price, depois verifica que _empTaxa
// recupera a mesma taxa por bisseção.
function pvPrice(pmt, i, n) { return pmt * (1 - Math.pow(1 + i, -n)) / i; }
{
  for (const iReal of [0.01, 0.025, 0.05]) {
    const pmt = 500, n = 12;
    const pv = pvPrice(pmt, iReal, n);
    const sb = makeSandbox(estadoBase());
    const iCalc = sb._empTaxa(pv, pmt, n);
    check(`_empTaxa recupera taxa ${iReal * 100}%/mês (round-trip Price)`, close(iCalc, iReal, 1e-6));
  }

  const sb = makeSandbox(estadoBase());
  check('_empTaxa = 0 quando não há juros embutidos (pmt*n <= pv)', sb._empTaxa(1200, 100, 12) === 0);
  check('_empTaxa = null acima do teto suportado (200%/mês)', sb._empTaxa(100, 500, 12) === null);
  check('_empTaxa = null com entrada inválida (pv/pmt/n <= 0)', sb._empTaxa(0, 100, 12) === null);
}

// _empSaldo / _empProgresso
{
  const sb = makeSandbox(estadoBase());
  const e = { valor: 3000, parcelas: 12, parcela: 300, pagas: 0, data: '2026-01-05' };
  check('_empSaldo com 0 parcelas pagas ≈ valor emprestado (mesma taxa embutida)', close(sb._empSaldo(e), 3000, 1));
  check('_empSaldo com todas as parcelas pagas = 0', sb._empSaldo({ ...e, pagas: 12 }) === 0);

  const prog = sb._empProgresso(e);
  check('_empProgresso.total = nº de parcelas', prog.total === 12);
  check('_empProgresso.totalGeral = parcela × parcelas', prog.totalGeral === 3600);
  check('_empProgresso.jurosTotal = totalGeral - valor emprestado', prog.jurosTotal === 600);
  check('_empProgresso.quitado = false quando restam parcelas', prog.quitado === false);
  check('_empProgresso de contrato quitado: quitado = true, saldo = 0', sb._empProgresso({ ...e, pagas: 12 }).quitado === true);
}

// Regressão do commit 7a775eb: dia de vencimento vem de e.data, não é
// cravado no dia 1; dia 31 recua para o último dia existente no mês/fevereiro.
{
  const sb = makeSandbox(estadoBase());
  check('_empDiaVenc lê o dia de e.data', sb._empDiaVenc({ data: '2026-03-17' }) === 17);
  check('_empDiaVenc cai no dia de hoje quando não há data', sb._empDiaVenc({}) === new Date().getDate());

  // Contrato com vencimento dia 31: quitação em mês de 30 dias recua pro
  // último dia existente (não pode gerar "31 de abril").
  const e31 = { valor: 1000, parcelas: 1, parcela: 1000, pagas: 0, data: '2026-01-31' };
  const quit31 = sb._empDataQuitacao(e31);
  check('quitação dia 31 nunca aparece em mês de 30 dias (regressão 7a775eb)', !/31 de abril|31 de junho|31 de setembro|31 de novembro/.test(quit31));

  check('_empDataQuitacao de contrato quitado retorna "Quitado"', sb._empDataQuitacao({ ...e31, pagas: 1 }) === 'Quitado');
}

// ══ Guard de integridade (loadFromCloud / realtime) ══
// Protege contra um payload da nuvem/tempo real com número corrompido
// sobrescrevendo o estado local bom — ver camada 6 do "SALVAMENTO BLINDADO".
{
  const sb = makeSandbox(estadoBase());
  check('_integridadeOk aceita estado vazio válido', sb._integridadeOk({ receitas: [], despesas: [] }) === true);
  check('_integridadeOk aceita payload sem os campos (undefined = ok)', sb._integridadeOk({}) === true);
  check('_integridadeOk rejeita não-objeto', sb._integridadeOk(null) === false && sb._integridadeOk(undefined) === false);
  check('_integridadeOk rejeita despesa com valor NaN', sb._integridadeOk({ despesas: [{ valor: NaN }] }) === false);
  check('_integridadeOk rejeita dívida com saldo Infinity', sb._integridadeOk({ dividas: [{ saldo: Infinity }] }) === false);
  check('_integridadeOk rejeita valor como string em vez de número', sb._integridadeOk({ receitas: [{ valor: '100' }] }) === false);
  check('_integridadeOk rejeita ativos inválido', sb._integridadeOk({ ativos: NaN }) === false);
  check('_integridadeOk rejeita reserva.acumulado inválido', sb._integridadeOk({ reserva: { acumulado: NaN, metaCustom: 0 } }) === false);
  check('_integridadeOk aceita payload real e íntegro', sb._integridadeOk({
    receitas: [{ valor: 100 }], despesas: [{ valor: 50 }], dividas: [{ saldo: 10 }],
    emprestimos: [{ valor: 200 }], ativos: 1000, reserva: { acumulado: 300, metaCustom: 0 },
  }) === true);
}

// ── resultado ──────────────────────────────────────────────────────
console.log(`\n${pass} passaram, ${fail} falharam.`);
if (fail > 0) process.exit(1);
