import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSeries, rolling, zscore, buyAndHold } from '../dist/engine/series.js';
import { GridBot, backtest, signal, FEE, FAMILIES } from '../dist/engine/bot.js';
import { Evolution, GENES, randomGenome, mutate, passesGate } from '../dist/engine/evolution.js';
import { mulberry32 } from '../dist/engine/rng.js';
import { CANDLES, META } from '../dist/data/candles.js';

const flat = (n, p = 100) => Array.from({ length: n }, (_, i) => [i * 3600, p, p, p, p, 1]);

test('bundled data is sane', () => {
  assert.equal(CANDLES.length, META.count);
  for (let i = 1; i < CANDLES.length; i++) assert.equal(CANDLES[i][0] - CANDLES[i - 1][0], 3600, `gap at ${i}`);
  for (const [, o, h, l, c] of CANDLES) { assert.ok(h >= Math.max(o, c) && l <= Math.min(o, c) && l > 0); }
});

test('rolling stats are causal and correct', () => {
  const c = flat(50); c[30][4] = 130; c[30][2] = 130;
  const s = makeSeries(c), r = rolling(s, 10);
  assert.ok(Number.isNaN(r.mean[8]));
  assert.equal(r.mean[29], 100);            // bar 30 not visible yet
  assert.equal(r.mean[30], 103);            // (9*100 + 130) / 10
  assert.equal(r.hh[30], 100);              // breakout high excludes the current bar
  assert.equal(r.hh[31], 130);
  assert.ok(zscore(s, 10, 30) > 2.9);
});

test('grid bot: fills levels, takes profit, pays fees', () => {
  // price opens at 100, dips to 98 (fills L2 at 99, L3 at 98), then rallies to 110
  const c = flat(40);
  const path = [100, 99.5, 98.8, 98, 98.5, 100, 103, 110];
  path.forEach((p, k) => { const i = 20 + k; c[i] = [i * 3600, p, Math.max(p, path[k - 1] ?? p), Math.min(p, path[k - 1] ?? p), p, 1]; });
  const s = makeSeries(c);
  const g = { family: 1, lookback: 5, entryZ: 99, levels: 3, spacing: 0.01, mult: 1, tp: 0.02, stop: 0.1 };
  const bot = new GridBot(g, 3000);
  const ev = [];
  bot._open(100, 20, ev);                   // force an entry to test mechanics only
  for (let i = 21; i < 40; i++) ev.push(...bot.step(s, i));
  const buys = ev.filter((e) => e.type === 'BUY').map((e) => e.level);
  assert.deepEqual(buys, ['L1', 'L2', 'L3']);
  const tp = ev.find((e) => e.type === 'TP');
  assert.ok(tp, 'take profit hit');
  const avg = 3000 / ((1000 / 100 + 1000 / 99 + 1000 / 98) * (1 - FEE));
  assert.ok(Math.abs(tp.price - avg * 1.02) < 1e-6);
  assert.ok(bot.cash > 3000 && bot.cash < 3000 * 1.02);
  assert.equal(bot.qty, 0);
});

test('grid bot: stop loss closes the whole position', () => {
  const c = flat(30);
  for (let i = 21; i < 30; i++) { const p = 100 - (i - 20) * 3; c[i] = [i * 3600, p + 3, p + 3, p, p, 1]; }
  const s = makeSeries(c);
  const g = { family: 1, lookback: 5, entryZ: 99, levels: 2, spacing: 0.02, mult: 1, tp: 0.05, stop: 0.05 };
  const bot = new GridBot(g, 1000), ev = [];
  bot._open(100, 20, ev);
  for (let i = 21; i < 30; i++) ev.push(...bot.step(s, i));
  const st = ev.find((e) => e.type === 'STOP');
  assert.ok(st);
  assert.ok(Math.abs(st.price - 98 * 0.95) < 1e-9);
  assert.ok(bot.cash < 1000);
  assert.equal(bot.trades.length, 1);
});

test('signals only use closed bars', () => {
  const s = makeSeries(CANDLES);
  const g = { family: 1, lookback: 48, entryZ: 1, levels: 4, spacing: 0.01, mult: 1.3, tp: 0.01, stop: 0.05 };
  const before = signal(g, s, 500);
  const copy = CANDLES.map((r) => r.slice()); copy[501][4] *= 0.5; copy[501][3] *= 0.5;
  assert.deepEqual(signal(g, makeSeries(copy), 500), before);
});

test('genomes stay inside bounds after mutation', () => {
  const r = mulberry32(1);
  for (let k = 0; k < 500; k++) {
    const { genome } = mutate(randomGenome(r), r, 0.9, 0.5);
    for (const G of GENES) {
      assert.ok(genome[G.key] >= G.min && genome[G.key] <= G.max, G.key);
      if (G.int) assert.ok(Number.isInteger(genome[G.key]), G.key);
    }
  }
});

test('evolution is deterministic per seed and keeps every species alive', () => {
  const s = makeSeries(CANDLES);
  const a = new Evolution(s, { seed: 42 }), b = new Evolution(s, { seed: 42 });
  for (let k = 0; k < 12; k++) { a.step(); b.step(); }
  assert.deepEqual(a.history, b.history);
  assert.equal(a.pop.length, 96);
  for (let f = 0; f < 4; f++) assert.ok(a.pop.some((x) => x.genome.family === f), 'family ' + f);
  // elitism: the best train fitness never goes down
  for (let k = 1; k < a.history.length; k++) assert.ok(a.history[k].best >= a.history[k - 1].best - 1e-12);
  if (a.leader) assert.ok(passesGate(a.leader.val));
});

test('leader backtest is reproducible', () => {
  const s = makeSeries(CANDLES);
  const e = new Evolution(s, { seed: 3 });
  for (let k = 0; k < 5; k++) e.step();
  const L = e.leader;
  assert.ok(L);
  assert.deepEqual(backtest(L.genome, s, e.valFrom, e.valTo), L.val);
});

test('out-of-sample gate uses the published thresholds', () => {
  const ok = { ret: 0.010001, maxDD: 0.099, trades: 3, winRate: 0.5 };
  assert.equal(passesGate(ok), true);
  assert.equal(passesGate({ ...ok, ret: 0.01 }), false);       // return must be above 1%
  assert.equal(passesGate({ ...ok, ret: -0.05 }), false);      // losing the unseen window dies
  assert.equal(passesGate({ ...ok, maxDD: 0.1 }), false);      // 10% drawdown does not pass
  assert.equal(passesGate({ ...ok, trades: 2 }), false);       // fewer than 3 trades
  assert.equal(passesGate({ ...ok, winRate: 0.499 }), false);  // win rate under 50%
});

test('a generation keeps 96 configs, 8 genes, 8 immigrants and every species', () => {
  assert.equal(GENES.length, 8);
  assert.deepEqual(FAMILIES, ['MOMENTUM', 'MEAN REVERT', 'VOL BREAKOUT', 'RANGE GRID']);
  const e = new Evolution(makeSeries(CANDLES), { seed: 2026 });
  assert.equal(e.pop.length, 96);
  assert.equal(e.last.died.length, 0); // the initial population has not been culled
  const rep = e.step();
  assert.equal(rep.immigrants.length, 8);
  assert.equal(e.pop.length, 96);
  assert.equal(rep.immigrants.length + rep.offspring.length + (96 - rep.died.length), 96);
  for (let f = 0; f < 4; f++) assert.ok(e.pop.some((x) => x.genome.family === f), 'family ' + f);
  assert.ok(!e.leader || passesGate(e.leader.val));
  const bestTrain = e.pop[0];
  if (!bestTrain.pass) assert.ok(!e.leader || e.leader.id !== bestTrain.id);
});

test('published 50-generation sample matches the honest-results table', () => {
  const s = makeSeries(CANDLES);
  const pct1 = (x) => Number((x * 100).toFixed(1));
  const bh = buyAndHold(s, Math.floor(s.n * 0.7), s.n);
  assert.equal(pct1(bh.ret), 11.4);
  assert.equal(pct1(bh.maxDD), 7.7);
  const expect = {
    2026: { fam: 'RANGE GRID', train: [28.8, 4.5], oos: [8.4, 5.3], trades: 5 },
    7: { fam: 'VOL BREAKOUT', train: [28.6, 4.3], oos: [8.3, 7.7], trades: 4 },
    42: { fam: 'MEAN REVERT', train: [30.8, 2.9], oos: [7.3, 3.9], trades: 54 },
  };
  for (const [seed, want] of Object.entries(expect)) {
    const e = new Evolution(s, { seed: Number(seed) });
    for (let k = 0; k < 50; k++) e.step();
    const L = e.leader;
    assert.ok(L && passesGate(L.val), 'seed ' + seed);
    assert.equal(FAMILIES[L.genome.family], want.fam, 'seed ' + seed);
    assert.deepEqual([pct1(L.train.ret), pct1(L.train.maxDD)], want.train, 'train ' + seed);
    assert.deepEqual([pct1(L.val.ret), pct1(L.val.maxDD), L.val.trades], [...want.oos, want.trades], 'oos ' + seed);
  }
});
