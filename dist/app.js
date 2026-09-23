// SETS MACHINE controller: runs the evolution, animates each generation stage by stage,
// and paper-trades the current leader on the out-of-sample part of the tape.

import { CANDLES, META } from './data/candles.js';
import { makeSeries, volatility, buyAndHold } from './engine/series.js';
import { GridBot, signal, FAMILIES } from './engine/bot.js';
import { Evolution, GENES } from './engine/evolution.js';
import * as D from './ui/draw.js';

const { clamp, ease, fmt, money, hash } = D;
const $ = (id) => document.getElementById(id);
const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };
const setHTML = (el, s) => { if (el.__h !== s) { el.innerHTML = s; el.__h = s; } };
const pct = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%';
const tapeTime = (sec) => { const d = new Date(sec * 1000); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`; };

const STAGE = 0.8, CYCLE = STAGE * 6, BAR_T = 0.4, START_CASH = 10000;
const GI = Object.fromEntries(GENES.map((G) => [G.key, G]));
const norm = (key, v) => (v - GI[key].min) / (GI[key].max - GI[key].min);
const S = makeSeries(CANDLES);
const q = new URLSearchParams(location.search);

const cv = {};
['logo', 'spark', 'ring', 'fit', 'mesh', 'kelly', 'chart'].forEach((id) => { cv[id] = D.sized($(id)); });

let st; // whole simulation state; rebuilt on restart

function restart(seed, warm = 0) {
  const evo = new Evolution(S, { seed });
  for (let k = 0; k < warm; k++) evo.step();
  st = {
    seed, evo, ct: CYCLE * 0.999, t: 0, rep: evo.last,
    nodes: new Map(), edges: [], lineage: [],
    shown: null, pending: null, geneFlash: null,
    // Same slice the gate scored: first out-of-sample bar through the end of the tape.
    paper: { bot: null, i: evo.valFrom, frac: 0, realized: 0, queued: null },
    bench: buyAndHold(S, evo.valFrom, evo.valTo),
    log: [], marks: [], inspect: null, hover: null, P: new Map(),
  };
  evo.pop.forEach((ind) => addNode(ind, -1));
  rankNodes(); buildEdges();
  if (evo.leader) promote(evo.leader, true);
  $('seed').value = seed;
  syncUrl();
}

// ---------------- gene pool nodes ----------------
function addNode(ind, born) {
  const g = ind.genome, sp = D.SPECIES[g.family];
  const nx = norm('lookback', g.lookback) * 0.6 + norm('entryZ', g.entryZ) * 0.4 - 0.5;
  const ny = norm('spacing', g.spacing) * 0.5 + norm('tp', g.tp) * 0.5 - 0.5;
  st.nodes.set(ind.id, {
    id: ind.id, ind, fam: g.family, born, dies: null, ph: hash(ind.id) * 6.28,
    // genes set the neighbourhood, a stable per-id scatter keeps near-clones readable
    x: clamp(sp.cx + nx * 0.16 + (hash(ind.id * 3 + 1) - 0.5) * 0.22, 0.04, 0.96),
    y: clamp(sp.cy + ny * 0.18 + (hash(ind.id * 7 + 2) - 0.5) * 0.26, 0.07, 0.95),
    r: 3, halo: false, alpha: 1, scale: 1, dying: false,
  });
}

function rankNodes() {
  const N = st.evo.pop.length;
  st.evo.pop.forEach((ind, rank) => {
    const n = st.nodes.get(ind.id); if (!n) return;
    n.r = 2.6 + 8 * Math.pow(1 - rank / N, 2.5); n.halo = rank < st.evo.E;
  });
}

function buildEdges() {
  const list = [...st.nodes.values()], edges = [];
  list.forEach((n, i) => {
    const same = list.filter((m) => m !== n && m.fam === n.fam)
      .map((m) => [m.id, (m.x - n.x) ** 2 + (m.y - n.y) ** 2]).sort((a, b) => a[1] - b[1]);
    same.slice(0, 2).forEach(([id]) => { if (n.id < id || !same.length) edges.push([n.id, id, false]); });
    if (hash(n.id * 13) < 0.35) { const m = list[Math.floor(hash(n.id * 17 + i) * list.length)]; if (m && m.fam !== n.fam) edges.push([n.id, m.id, true]); }
  });
  st.edges = edges;
}

// ---------------- generations ----------------
function startGeneration() {
  for (const [id, n] of st.nodes) { if (n.dies !== null) st.nodes.delete(id); else n.born = -1; }
  const rep = st.evo.step();
  st.rep = rep; st.lineage = [];
  rep.immigrants.forEach((id) => addNode(st.evo.byId(id), STAGE * (1 + hash(id) * 0.85)));
  rep.offspring.forEach((id) => {
    const born = STAGE * (2 + hash(id) * 0.85), ind = st.evo.byId(id);
    addNode(ind, born);
    ind.parents.forEach((p, k) => { if (st.nodes.has(p)) st.lineage.push({ from: p, to: id, t0: born - 0.55 + k * 0.08 }); });
  });
  rep.died.forEach((id) => { const n = st.nodes.get(id); if (n) n.dies = STAGE * (4 + hash(id * 5) * 0.85); });
  if (st.inspect && rep.died.includes(st.inspect)) st.inspect = null;
  rankNodes(); buildEdges();
  st.pending = rep.promoted ? rep.leader : null;
  st.deployed = false;
  const vol = volatility(S, st.paper.i - 1) * 100;
  pushLog('SCAN', 'ev', `gen ${rep.gen} · tape σ ${vol.toFixed(2)}%/h · ${rep.immigrants.length + rep.offspring.length} new configs`);
}

function deploy() {
  st.deployed = true;
  const rep = st.rep;
  if (st.pending) { promote(st.pending, false); st.pending = null; }
  else if (rep.leader) pushLog('HOLD', 'ev', `gen ${rep.gen} · g${rep.leader.id} defends the title · ${rep.survivors}/${st.evo.N} pass gate`);
  else pushLog('HOLD', 'bad', `gen ${rep.gen} · nobody passed the gate · staying flat`);
}

function promote(leader, silent) {
  const prev = st.shown;
  st.shown = leader;
  if (prev) st.geneFlash = { keys: GENES.filter((G) => G.int ? prev.genome[G.key] !== leader.genome[G.key] : Math.abs(prev.genome[G.key] - leader.genome[G.key]) > 1e-9).map((G) => G.key), t: st.t };
  const p = st.paper;
  if (!p.bot) p.bot = new GridBot(leader.genome, START_CASH);
  else if (!p.bot.inPos) p.bot = swapBot(leader.genome);
  else { p.queued = leader.genome; if (!silent) pushLog('QUEUE', 'ev', `g${leader.id} waits for the open position to close`); }
  if (!silent) pushLog('EVOLVE', 'ev', `gen ${st.rep.gen} · g${leader.id} promoted · OOS ${pct(leader.val.ret)} · DD ${(leader.val.maxDD * 100).toFixed(1)}%`);
}

function swapBot(genome) {
  const b = new GridBot(genome, st.paper.bot.cash);
  b.start = START_CASH; b.peak = Math.max(b.peak, st.paper.bot.peak);
  return b;
}

// ---------------- paper trading ----------------
function advancePaper(dt) {
  const p = st.paper, evo = st.evo;
  p.frac += dt / BAR_T;
  while (p.frac >= 1) {
    p.frac -= 1;
    if (p.bot) {
      for (const e of p.bot.step(S, p.i)) {
        st.marks.push(e);
        if (e.type === 'BUY') pushLog('BUY', '', `${e.level} filled @ ${money(e.price)} · $${fmt(e.usd)}`, p.i);
        else { p.realized += e.pnl; pushLog(e.type === 'TP' ? 'TP' : 'STOP', e.type === 'TP' ? '' : 'bad', `closed @ ${money(e.price)} · ${e.pnl >= 0 ? '+' : '−'}$${Math.abs(e.pnl).toFixed(2)}`, p.i); }
        if (e.type !== 'BUY' && p.queued) { p.bot = swapBot(p.queued); p.queued = null; pushLog('SWAP', 'ev', 'queued leader takes over the grid', p.i); break; }
      }
    }
    p.i++;
    if (p.i >= evo.valTo) {
      if (p.bot && p.bot.inPos) { const cost = p.bot.cost; p.bot.flatten(S, evo.valTo - 1); const tr = p.bot.trades[p.bot.trades.length - 1]; p.realized += tr.pnl; pushLog('EOD', 'bad', `tape end · flattened $${fmt(cost)} · ${tr.pnl >= 0 ? '+' : '−'}$${Math.abs(tr.pnl).toFixed(2)}`, evo.valTo - 1); }
      p.i = evo.valFrom; st.marks = [];
      pushLog('REWIND', 'ev', 'out-of-sample tape restarts', p.i);
    }
  }
  if (st.marks.length > 60) st.marks = st.marks.slice(-60);
}

function pushLog(k, cls, txt, i = st.paper.i) {
  st.log.push({ k, cls, txt, time: S.time[Math.min(i, S.n - 1)], t: st.t });
  if (st.log.length > 30) st.log.shift();
}

// ---------------- frame ----------------
let running = !q.has('paused'), speed = [1, 2, 4, 8].includes(+q.get('speed')) ? +q.get('speed') : 1, last = performance.now();

function update(dt) {
  st.t += dt;
  st.ct += dt;
  if (st.ct >= STAGE * 5 && !st.deployed) deploy();
  if (st.ct >= CYCLE) { if (!st.deployed) deploy(); st.ct -= CYCLE; if (st.ct >= CYCLE) st.ct = 0; startGeneration(); }
  advancePaper(dt);
}

function nodeStates() {
  const ct = st.ct, births = [], deaths = [];
  for (const n of st.nodes.values()) {
    n.alpha = 1; n.scale = 1; n.dying = false;
    if (n.born >= 0) {
      const k = (ct - n.born) / 0.5;
      if (k < 0) { n.alpha = 0; continue; }
      n.scale = ease(k);
      if (ct - n.born < 1.2) births.push([n.id, (ct - n.born) / 1.2, hash(n.id * 11) < 0.22 ? '+g' + n.id : '']);
    }
    if (n.dies !== null && ct >= n.dies) {
      const k = (ct - n.dies) / 0.7;
      n.dying = true; n.alpha = clamp(1 - k, 0, 1); n.scale = 1 - 0.4 * clamp(k, 0, 1);
      if (k < 1.4) deaths.push([n.id, clamp((ct - n.dies) / 1.2, 0, 1), hash(n.id * 19) < 0.14 ? '✕ g' + n.id : '']);
    }
  }
  return { births, deaths };
}

function stageText(stage) {
  const r = st.rep, evo = st.evo, off = r.offspring[0] ? evo.byId(r.offspring[0]) : null;
  const vol = volatility(S, st.paper.i - 1) * 100;
  return [
    `tape σ ${vol.toFixed(2)}%/h · ${evo.split - evo.trainFrom} h train · ${evo.valTo - evo.valFrom} h out-of-sample`,
    `${r.immigrants.length} random immigrants injected into the pool`,
    off && off.parents.length ? `crossover g${off.parents[0]} × g${off.parents[1]} → ${r.offspring.length} offspring · p(mut) 0.18` : `${r.offspring.length} offspring bred`,
    `${r.immigrants.length + r.offspring.length} backtests on real ${META.symbol} ${META.interval} candles`,
    `gate passed ${r.survivors}/${evo.N} · ${r.died.length} killed · ${evo.N - r.died.length} elites kept`,
    r.leader ? (st.pending || r.promoted ? `g${r.leader.id} hot-swapped into the paper grid` : `leader g${r.leader.id} defends the title`) : 'no survivor yet · grid stays flat',
  ][stage];
}

const PHASES = [[1, 'SCAN', 'reading the tape'], [1, 'SCAN', 'injecting new ideas'], [2, 'BREED', 'crossover + mutation'], [3, 'TEST', 'backtesting offspring'], [3, 'SELECT', 'the gate kills the weak'], [4, 'DEPLOY', 'leader goes to the paper grid']];

function render() {
  const evo = st.evo, rep = st.rep, ct = st.ct, stage = Math.min(5, Math.floor(ct / STAGE)), sp = (ct - stage * STAGE) / STAGE;
  const t = st.t;
  // header
  setText($('sGen'), '#' + rep.gen);
  setText($('sTested'), fmt(evo.tested));
  setText($('sKill'), (evo.born ? (evo.killed / evo.born) * 100 : 0).toFixed(1) + '%');
  setText($('sSurv'), `${rep.survivors}/${evo.N}`);
  setText($('clock'), new Date().toLocaleTimeString('en-GB'));
  document.querySelector('.pill i').style.opacity = (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2))).toFixed(2);
  setText($('lat'), running ? `PAPER · ${speed}×` : 'PAUSED');
  D.drawLogo(cv.logo, t);
  D.drawSpark(cv.spark, evo.history.map((h) => h.survivors), evo.N);
  // ring + fitness
  D.drawRing(cv.ring, { stage, sp, pos: ct / CYCLE, gen: rep.gen, cycle: CYCLE / speed, flash: ct < 0.5 });
  const gf = Math.max(0, evo.history.length - 2 + clamp(ct / CYCLE, 0, 1));
  D.drawFitness(cv.fit, evo.history, gf);
  const H = evo.history, cur = H[H.length - 1], old = H[Math.max(0, H.length - 11)];
  setText($('fitNow'), 'BEST ' + cur.best.toFixed(4));
  setText($('fPop'), String(evo.N));
  setText($('fOff'), String(rep.offspring.length + rep.immigrants.length));
  setText($('fElite'), String(evo.N - rep.offspring.length - rep.immigrants.length));
  setText($('fDelta'), (cur.best - old.best >= 0 ? '+' : '−') + Math.abs(cur.best - old.best).toFixed(4));
  setText($('stName'), D.STAGES[stage]);
  setText($('stText'), stageText(stage));
  // mesh
  const ph = PHASES[stage];
  setText($('phaseA'), `PHASE ${ph[0]} / 4 · ${ph[1]}`);
  setText($('phaseB'), ph[2]);
  const { births, deaths } = nodeStates();
  const counts = [0, 0, 0, 0];
  for (const n of st.nodes.values()) if (!n.dying && n.alpha > 0) counts[n.fam]++;
  setHTML($('legend'), FAMILIES.map((f, i) => `<div><i style="background:${D.SPECIES[i].color}"></i>${f} <em>${counts[i]}</em></div>`).join(''));
  setText($('meshCount'), `GEN ${rep.gen} · BORN ${fmt(evo.born)} · KILLED ${fmt(evo.killed)}`);
  st.P = D.drawMesh(cv.mesh, { nodes: st.nodes, edges: st.edges, lineage: st.lineage, ct, t, leaderId: st.shown && st.shown.id, inspectId: st.inspect, hoverId: st.hover, births, deaths });
  renderGenome(); renderSelection(stage, sp); renderKelly(t); renderTrade();
}

function renderGenome() {
  const n = st.inspect && st.nodes.get(st.inspect);
  const ind = n ? n.ind : st.shown;
  setText($('genomeTitle'), n ? 'GENOME · INSPECTING' : 'GENOME · LIVE LEADER');
  setText($('genomeSub'), n ? 'CLICK EMPTY SPACE OR PRESS ESC TO RETURN TO THE LEADER' : 'DNA OF THE CONFIG THAT IS PAPER TRADING');
  if (!ind) { setHTML($('genes'), '<div class="sig">No config has passed the out-of-sample gate yet.</div>'); setText($('genomeId'), ''); setHTML($('genomeFoot'), ''); return; }
  setText($('genomeId'), `g${ind.id} · BORN GEN ${ind.gen}`);
  const flash = !n && st.geneFlash && st.t - st.geneFlash.t < 2.2 ? st.geneFlash.keys : [];
  setHTML($('genes'), GENES.map((G) => {
    const v = ind.genome[G.key], on = Math.round((G.key === 'family' ? (v + 1) / 4 : norm(G.key, v)) * 22);
    let segs = ''; for (let s = 0; s < 22; s++) segs += s < on ? '<i class="on"></i>' : '<i></i>';
    return `<div class="gene${flash.includes(G.key) ? ' mut' : ''}"><span class="n">${G.label}</span><span class="segs">${segs}</span><span class="v">${G.fmt(v)}</span></div>`;
  }).join(''));
  setHTML($('genomeFoot'), `<span>TRAIN <b>${pct(ind.train.ret)}</b> DD ${(ind.train.maxDD * 100).toFixed(1)}% · ${ind.train.trades}×</span><span>OOS <b>${pct(ind.val.ret)}</b> DD ${(ind.val.maxDD * 100).toFixed(1)}% · ${ind.val.trades}×</span>`);
}

function renderSelection(stage, sp) {
  const r = st.rep, N = st.evo.N, fresh = r.immigrants.length + r.offspring.length;
  const rows = [
    ['GENERATED', fresh, stage < 1 ? 0 : stage === 1 ? ease(sp) * (r.immigrants.length / fresh) : stage === 2 ? r.immigrants.length / fresh + ease(sp) * (r.offspring.length / fresh) : 1, stage === 1 || stage === 2],
    ['BACKTESTED', fresh, stage < 3 ? 0 : stage === 3 ? ease(sp) : 1, stage === 3],
    ['PASSED GATE', r.survivors, stage < 4 ? 0 : stage === 4 ? ease(sp / 0.6) : 1, stage === 4 && sp < 0.6],
    ['ELITE KEPT', N - fresh, stage < 4 ? 0 : stage === 4 ? ease((sp - 0.5) / 0.5) : 1, stage === 4 && sp >= 0.5],
    ['DEPLOYED', r.leader ? 1 : 0, stage < 5 ? 0 : ease(sp / 0.5), stage === 5],
  ];
  setHTML($('funnel'), rows.map(([name, v, f, act]) => {
    const wv = (Math.log(v + 1) / Math.log(N + 1)) * 100;
    return `<div class="fr${act ? ' act' : ''}"><span class="n">${name}</span><span class="v${f > 0 ? '' : ' dim'}">${fmt(f > 0 ? v * f : v)}</span>` +
      `<span class="bar"><i class="p" style="width:${wv.toFixed(1)}%"></i><i class="c" style="width:${(wv * f).toFixed(1)}%"></i></span></div>`;
  }).join(''));
  setText($('selGen'), 'GEN ' + r.gen);
}

// Small samples lie, so both inputs are shrunk: W towards 50% (Beta(2,2) prior) and, when a config
// has never lost, R falls back to what its own geometry implies (take-profit vs. a typical stopped loss).
function kellyInputs(ind) {
  const a = ind.train, b = ind.val, n = a.trades + b.trades, g = ind.genome;
  const wins = Math.round(a.winRate * a.trades) + Math.round(b.winRate * b.trades);
  const structural = g.tp / ((g.spacing * (g.levels - 1)) / 2 + g.stop);
  const seen = a.payoff > 0 && a.payoff < 9 ? a.payoff : b.payoff > 0 && b.payoff < 9 ? b.payoff : structural;
  return { W: (wins + 2) / (n + 4), R: clamp(Math.min(seen, Math.max(structural, seen * 0.5)), 0.2, 4), n };
}

function renderKelly(t) {
  const ind = st.shown;
  if (!ind) { setText($('kPct'), '—'); ['kW', 'kR', 'kH', 'kE'].forEach((id) => setText($(id), '—')); setText($('kN'), 'NO LEADER'); D.drawKelly(cv.kelly, { W: 0.5, R: 1, t }); return; }
  const { W, R, n } = kellyInputs(ind), f = Math.max(0, W - (1 - W) / R);
  setText($('kPct'), Math.round(f * 100) + '%');
  setText($('kW'), Math.round(W * 100) + '%'); setText($('kR'), R.toFixed(2));
  setText($('kH'), Math.round(f * 50) + '%'); setText($('kE'), (W * R - (1 - W) >= 0 ? '+' : '−') + Math.abs(W * R - (1 - W)).toFixed(2));
  setText($('kN'), `${n} TRADES · SHRUNK`);
  D.drawKelly(cv.kelly, { W, R, t });
}

function renderTrade() {
  const p = st.paper, bot = p.bot, g = bot ? bot.g : null, i = p.i;
  let preview = null;
  if (bot && !bot.inPos) {
    const px = S.close[i - 1];
    let w = 0; for (let k = 0; k < g.levels; k++) w += Math.pow(g.mult, k);
    preview = Array.from({ length: g.levels }, (_, k) => ({ name: 'L' + (k + 1), price: px * (1 - g.spacing * k), usd: (bot.cash / w) * Math.pow(g.mult, k), filled: false }));
  }
  const price = D.drawChart(cv.chart, { s: S, from: st.evo.valFrom, i, frac: p.frac, bot, preview, marks: st.marks, empty: bot ? '' : 'WAITING FOR THE FIRST SURVIVOR' });
  const o = S.open[i], c = price;
  setHTML($('ohlc'), `<em>${tapeTime(S.time[i])} UTC</em>  <em>O</em>${money(o)}  <em>C</em>${money(c)}  <em>Δ</em>${pct(c / o - 1, 2)}  <em>VOL</em>${fmt(S.volume[i] * p.frac)} BTC`);
  setText($('chSym'), META.symbol);
  setText($('chBench'), `BUY & HOLD · SAME OUT-OF-SAMPLE WINDOW ${pct(st.bench.ret)} · DD ${(st.bench.maxDD * 100).toFixed(1)}%`);
  if (!bot) { setText($('chCfg'), 'NO LEADER YET'); setText($('chState'), 'FLAT'); }
  else {
    setText($('chCfg'), `LEADER g${st.shown ? st.shown.id : '?'} · ${FAMILIES[g.family]} · ${g.levels} LEVELS · ${(g.spacing * 100).toFixed(2)}% SPACING · TP ${(g.tp * 100).toFixed(2)}%`);
    setText($('chState'), bot.inPos ? `IN POSITION · ${bot.levels.filter((L) => L.filled).length}/${bot.levels.length} FILLED` : 'FLAT · WAITING FOR SIGNAL');
  }
  const eq = bot ? bot.equity(price) : START_CASH;
  setText($('cAvg'), bot && bot.inPos ? money(bot.avg) : '—');
  setText($('cTp'), bot && bot.inPos ? money(bot.tp) : '—');
  setText($('cPos'), bot && bot.inPos ? money(bot.cost) : '$0');
  const unr = bot && bot.inPos ? bot.qty * price - bot.cost : 0;
  const u = $('cUnr'); setText(u, (unr >= 0 ? '+$' : '−$') + Math.abs(unr).toFixed(2)); u.style.color = unr > 0 ? D.C.royal : D.C.ink;
  const rl = $('cReal'); setText(rl, (p.realized >= 0 ? '+$' : '−$') + Math.abs(p.realized).toFixed(2)); rl.style.color = p.realized >= 0 ? D.C.royal : D.C.ink;
  setText($('cEq'), money(eq));
  // order grid
  const rows = [];
  if (bot && bot.inPos) {
    rows.push(`<div class="grow2 tp"><span class="l">TP</span><span>${money(bot.tp)}</span><span>100%</span><span class="s">${pct(bot.tp / price - 1, 2)} ↑</span></div>`);
    const next = bot.levels.find((L) => !L.filled);
    bot.levels.forEach((L) => {
      const flash = L.filled && L.t === i - 1 && p.frac < 0.8;
      const cls = flash ? ' flash f' : L.filled ? ' f' : L === next ? ' near' : '';
      const s = L.filled ? 'FILLED' : L === next ? ((price / L.price - 1) * 100).toFixed(2) + '% AWAY' : 'ARMED';
      rows.push(`<div class="grow2${cls}"><span class="l">${L.name}</span><span>${money(L.price)}</span><span>$${fmt(L.usd)}</span><span class="s">${s}</span></div>`);
    });
    rows.push(`<div class="grow2 ghost"><span class="l">SL</span><span>${money(bot.stop)}</span><span>ALL</span><span class="s">${pct(bot.stop / price - 1, 2)}</span></div>`);
  } else if (preview) {
    preview.forEach((L) => rows.push(`<div class="grow2 ghost"><span class="l">${L.name}</span><span>${money(L.price)}</span><span>$${fmt(L.usd)}</span><span class="s">PREVIEW</span></div>`));
  }
  setHTML($('grows'), rows.join(''));
  const badge = $('gridBadge');
  setText(badge, bot && bot.inPos ? 'PRE-COMMITTED' : 'ARMED'); badge.classList.toggle('off', !(bot && bot.inPos));
  if (bot && !bot.inPos) {
    const sg = signal(g, S, i - 1);
    setHTML($('sig'), `SIGNAL <b>${sg.ok ? 'FIRES NEXT BAR' : 'WAITING'}</b> · z ${sg.z.toFixed(2)} · need ${sg.need}`);
  } else if (bot) setHTML($('sig'), `IN TRADE <b>${i - bot.openedAt} h</b> · STOP ${money(bot.stop)}`);
  else setHTML($('sig'), '');
  setHTML($('log'), st.log.slice(-6).map((e) => `<div class="${st.t - e.t < 0.8 ? 'new' : ''}"><b class="${e.cls}">${e.k}</b>${tapeTime(e.time)} <span>${e.txt}</span></div>`).join(''));
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (running) update(dt * speed);
  render();
  requestAnimationFrame(frame);
}

// ---------------- controls ----------------
function syncUrl() {
  const u = new URL(location.href);
  u.searchParams.set('seed', st.seed);
  if (speed !== 1) u.searchParams.set('speed', speed); else u.searchParams.delete('speed');
  u.searchParams.delete('warm');
  history.replaceState(null, '', u);
}
function setRunning(v) { running = v; const b = $('bPlay'); b.textContent = v ? '❚❚ PAUSE' : '▶ RUN'; b.setAttribute('aria-label', v ? 'Pause' : 'Run'); }
function setSpeed(v) { speed = v; document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === v)); if (st) syncUrl(); }
function step() {
  if (!st.deployed) deploy();
  startGeneration();
  // Land on DEPLOY for this generation. CYCLE * 0.999 sits ~5 ms before the next
  // birth, which is less than one frame, so a running clock would immediately
  // start a second generation. A full stage of room (0.8 s) keeps one click = one gen.
  st.ct = STAGE * 5;
  deploy();
}

$('bPlay').onclick = () => setRunning(!running);
$('bStep').onclick = step;
document.querySelectorAll('[data-speed]').forEach((b) => { b.onclick = () => setSpeed(+b.dataset.speed); });
$('bSeed').onclick = () => restart(clamp(Math.round(+$('seed').value) || 1, 1, 999999));
$('bRand').onclick = () => restart(1 + Math.floor(Math.random() * 999999));
$('seed').onkeydown = (e) => { if (e.key === 'Enter') $('bSeed').click(); };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ') { e.preventDefault(); setRunning(!running); }
  else if (e.key === 'ArrowRight') step();
  else if (e.key === 'Escape') st.inspect = null;
  else if ('1234'.includes(e.key)) setSpeed([1, 2, 4, 8][+e.key - 1]);
});

function pick(e) {
  const r = cv.mesh.el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  let best = null, bd = Infinity;
  for (const [id, [px, py]] of st.P) {
    const n = st.nodes.get(id); if (!n || n.alpha < 0.3) continue;
    const d = Math.hypot(px - x, py - y);
    if (d < n.r * n.scale + 7 && d < bd) { bd = d; best = id; }
  }
  return best;
}
cv.mesh.el.addEventListener('pointermove', (e) => { st.hover = pick(e); cv.mesh.el.classList.toggle('hand', !!st.hover); });
cv.mesh.el.addEventListener('pointerleave', () => { st.hover = null; });
cv.mesh.el.addEventListener('click', (e) => { st.inspect = pick(e); });

setText($('meta'), `${META.symbol} ${META.interval} · ${fmt(META.count)} candles · ${tapeTime(META.from)} → ${tapeTime(META.to)} UTC · train 70% / out-of-sample 30%`);
$('sym').textContent = META.symbol;
setSpeed(speed);
setRunning(running);
restart(clamp(parseInt(q.get('seed'), 10) || 2026, 1, 999999), clamp(parseInt(q.get('warm'), 10) || 0, 0, 500));
requestAnimationFrame(frame);

// small read-only hook for debugging and automated checks
window.SETS = { get state() { return st; }, step, setSpeed, setRunning, restart, advance(dt) { update(dt); render(); } };
