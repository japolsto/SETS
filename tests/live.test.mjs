import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BANNER_TEXT, CONFIRM_TEXT, KEYS, MODE, PORTFOLIO, STOP_ACTION,
  canArm, killFraction, loadState, panicPayload, reduce, webhookFromSearch, webhookPlan, writeStore,
} from '../dist/live/state.js';

const T = '2026-09-23T19:00:00.000Z';

function mem(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function arm(state, now = T) {
  return reduce(reduce(state, { type: 'ack', value: true }, now), { type: 'arm' }, now);
}

test('panel boots disarmed and will not arm without the dry-run acknowledgement', () => {
  const state = loadState(mem(), '', T);
  assert.equal(state.mode, MODE.DISARMED);
  assert.equal(canArm(state), false);
  assert.equal(reduce(state, { type: 'arm' }, T), state);
  assert.equal(reduce(state, { type: 'disarm' }, T), state);
  assert.equal(reduce(state, { type: 'clear-panic' }, T), state);
});

test('dry-run acknowledgement arms, and clearing it disarms', () => {
  let state = loadState(mem(), '', T);
  state = reduce(state, { type: 'ack', value: true }, T);
  assert.equal(canArm(state), true);
  state = reduce(state, { type: 'arm' }, T);
  assert.equal(state.mode, MODE.ARMED);
  assert.match(state.log.at(-1).text, /armed SETS-500/);
  state = reduce(state, { type: 'disarm' }, T);
  assert.equal(state.mode, MODE.DISARMED);
  state = arm(loadState(mem(), '', T));
  state = reduce(state, { type: 'ack', value: false }, T);
  assert.equal(state.mode, MODE.DISARMED);
  assert.equal(state.dryRunAck, false);
});

test('STOP latches panic, keeps the first timestamp, and DISARM cannot clear it', () => {
  let state = arm(loadState(mem(), '', T));
  state = reduce(state, { type: 'stop' }, '2026-09-23T19:05:00.000Z');
  assert.equal(state.mode, MODE.PANIC);
  assert.equal(state.panicAt, '2026-09-23T19:05:00.000Z');
  assert.equal(canArm(state), false);
  assert.equal(reduce(state, { type: 'arm' }, T).mode, MODE.PANIC);
  assert.equal(reduce(state, { type: 'disarm' }, T), state);
  const again = reduce(state, { type: 'stop' }, '2026-09-23T19:09:00.000Z');
  assert.equal(again.mode, MODE.PANIC);
  assert.equal(again.panicAt, '2026-09-23T19:05:00.000Z');
  assert.match(again.log.at(-1).text, /stays latched/);
});

test('panic payload is the operator ping and the confirm copy is exact', () => {
  assert.equal(CONFIRM_TEXT, 'Cancel all SETS orders and liquidate SETS-owned BTC to USDC in SETS-500 only?');
  assert.equal(BANNER_TEXT, 'LIQUIDATE→USDC');
  assert.deepEqual(panicPayload(), { action: STOP_ACTION, portfolio: PORTFOLIO });
  assert.deepEqual(Object.keys(panicPayload()), ['action', 'portfolio']);
  assert.equal(STOP_ACTION, 'STOP_LIQUIDATE_USDC');
  assert.equal(PORTFOLIO, 'SETS-500');
});

test('only an explicit clear returns the panel to disarmed', () => {
  let state = reduce(arm(loadState(mem(), '', T)), { type: 'stop' }, T);
  const cleared = reduce(state, { type: 'clear-panic' }, '2026-09-23T19:10:00.000Z');
  assert.equal(cleared.mode, MODE.DISARMED);
  assert.equal(cleared.panicAt, null);
  assert.match(cleared.log.at(-1).text, /does not undo a liquidation/);
  assert.equal(reduce(cleared, { type: 'clear-panic' }, T), cleared);
});

test('panic flag survives localStorage and outranks a stored arm', () => {
  const store = mem();
  let state = reduce(arm(loadState(store, '', T)), { type: 'stop' }, '2026-09-23T19:05:00.000Z');
  state = reduce(state, { type: 'webhook', url: 'https://ops.example/sets' }, T);
  writeStore(store, state);
  assert.equal(store.getItem(KEYS.panic), '1');
  assert.equal(store.getItem(KEYS.panicAt), '2026-09-23T19:05:00.000Z');
  assert.equal(store.getItem(KEYS.arm), MODE.DISARMED);
  const restored = loadState(store, '', '2026-09-23T19:06:00.000Z');
  assert.equal(restored.mode, MODE.PANIC);
  assert.equal(restored.panicAt, '2026-09-23T19:05:00.000Z');
  assert.equal(restored.webhookUrl, 'https://ops.example/sets');
  assert.match(restored.log.map((row) => row.text).join('\n'), /restored from this browser/);
  const cleared = reduce(restored, { type: 'clear-panic' }, T);
  writeStore(store, cleared);
  assert.equal(store.getItem(KEYS.panic), '0');
  assert.equal(store.getItem(KEYS.panicAt), null);
  assert.equal(loadState(store, '', T).mode, MODE.DISARMED);
});

test('armed state restores only when the dry-run acknowledgement is still stored', () => {
  const store = mem();
  writeStore(store, arm(loadState(store, '', T)));
  assert.equal(loadState(store, '', T).mode, MODE.ARMED);
  store.setItem(KEYS.dryRunAck, '0');
  assert.equal(loadState(store, '', T).mode, MODE.DISARMED);
});

test('?panicWebhook= overrides the stored URL without writing until asked', () => {
  const store = mem();
  writeStore(store, { ...arm(loadState(store, '', T)), webhookUrl: 'https://stored.example/a' });
  assert.equal(webhookFromSearch(''), undefined);
  assert.equal(webhookFromSearch('?seed=1'), undefined);
  const next = loadState(store, '?panicWebhook=https://from-query.example/b', T);
  assert.equal(next.webhookUrl, 'https://from-query.example/b');
  assert.equal(store.getItem(KEYS.webhook), 'https://stored.example/a');
  assert.match(next.log.at(-1).text, /panicWebhook/);
  const cleared = loadState(store, '?panicWebhook=', T);
  assert.equal(cleared.webhookUrl, '');
});

test('webhook plan posts the panic JSON only for a bare http(s) URL', () => {
  assert.equal(webhookPlan('').post, false);
  assert.equal(webhookPlan('   ').reason, 'skipped');
  assert.equal(webhookPlan('javascript:alert(1)').post, false);
  assert.equal(webhookPlan('https://user:pass@ops.example/hook').reason, 'rejected');
  assert.equal(webhookPlan('/relative').post, false);
  const plan = webhookPlan('https://ops.example/sets-panic');
  assert.equal(plan.post, true);
  assert.equal(plan.url, 'https://ops.example/sets-panic');
  assert.deepEqual(plan.body, { action: 'STOP_LIQUIDATE_USDC', portfolio: 'SETS-500' });
});

test('kill bar has no mark until a finite P&L exists, then measures distance to −$75', () => {
  assert.equal(killFraction(null), null);
  assert.equal(killFraction(undefined), null);
  assert.equal(killFraction(Number.NaN), null);
  assert.equal(killFraction(0), 0);
  assert.equal(killFraction(12), 0);
  assert.equal(killFraction(-37.5), 0.5);
  assert.equal(killFraction(-75), 1);
  assert.equal(killFraction(-150), 1);
});

test('live page is linked from the paper dashboard and contains no credentials', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const html = read('../dist/live.html');
  const page = read('../dist/live.js');
  const css = read('../dist/live.css');
  const root = read('../live.html');
  const index = read('../dist/index.html');
  assert.match(index, /href="live\.html"/);
  assert.match(html, /href="index\.html"/);
  assert.match(html, /id="bStop"/);
  assert.match(html, /CLEAR PANIC \(OPERATOR\)/);
  assert.match(html, /id="ack"/);
  assert.match(html, /id="bArm"/);
  assert.match(root, /dist\/live\.html/);
  assert.ok(html.includes(CONFIRM_TEXT));
  assert.ok(html.includes(BANNER_TEXT));
  assert.match(page, /CONFIRM_TEXT/);
  assert.match(page, /localStorage/);
  const src = [html, page, css, read('../dist/live/state.js')].join('\n');
  assert.doesNotMatch(src, /cb-access|api[_-]?secret|private[_-]?key|BEGIN [A-Z ]*PRIVATE|COINBASE_API/i);
});
