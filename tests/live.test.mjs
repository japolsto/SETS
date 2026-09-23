import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BANNER_TEXT, CONFIRM_TEXT, DEMO_LABEL, KEYS, LEGACY_WEBHOOK_KEY, MODE, PLACEHOLDER,
  RESET_DISCLAIMER, RESET_LABEL, THRESHOLD_COPY, UNKNOWN,
  canArm, killFraction, loadState, reduce, writeStore,
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
  assert.match(state.log.at(-1).text, /Dry-run demo armed/);
  assert.match(state.log.at(-1).text, /not an operational arm/);
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

test('STOP copy latches a local flag and does not describe an execution', () => {
  assert.equal(DEMO_LABEL, 'DEMO · NOT CONNECTED · UI ONLY');
  assert.equal(CONFIRM_TEXT, 'Latch a local PANIC flag for SETS-500 in this browser only?');
  assert.equal(BANNER_TEXT, 'PANIC LATCHED');
  const stopped = reduce(arm(loadState(mem(), '', T)), { type: 'stop' }, T);
  assert.match(stopped.log.at(-1).text, /Liquidation is not wired/);
  assert.match(stopped.log.at(-1).text, /No order was sent/);
});

test('only an explicit clear returns the panel to disarmed', () => {
  let state = reduce(arm(loadState(mem(), '', T)), { type: 'stop' }, T);
  const cleared = reduce(state, { type: 'clear-panic' }, '2026-09-23T19:10:00.000Z');
  assert.equal(cleared.mode, MODE.DISARMED);
  assert.equal(cleared.panicAt, null);
  assert.match(cleared.log.at(-1).text, /Local demo reset/);
  assert.match(cleared.log.at(-1).text, /no claim that orders or exposure are resolved/i);
  assert.equal(reduce(cleared, { type: 'clear-panic' }, T), cleared);
});

test('panic flag survives localStorage and outranks a stored arm', () => {
  const store = mem();
  const state = reduce(arm(loadState(store, '', T)), { type: 'stop' }, '2026-09-23T19:05:00.000Z');
  store.setItem(LEGACY_WEBHOOK_KEY, 'https://ops.example/sets');
  writeStore(store, state);
  assert.equal(store.getItem(LEGACY_WEBHOOK_KEY), null);
  assert.equal(store.getItem(KEYS.panic), '1');
  assert.equal(store.getItem(KEYS.panicAt), '2026-09-23T19:05:00.000Z');
  assert.equal(store.getItem(KEYS.arm), null);
  store.setItem(KEYS.arm, MODE.ARMED);
  const restored = loadState(store, '', '2026-09-23T19:06:00.000Z');
  assert.equal(restored.mode, MODE.PANIC);
  assert.equal(restored.panicAt, '2026-09-23T19:05:00.000Z');
  assert.equal(restored.webhookUrl, undefined);
  assert.match(restored.log.map((row) => row.text).join('\n'), /restored from this browser/);
  const cleared = reduce(restored, { type: 'clear-panic' }, T);
  writeStore(store, cleared);
  assert.equal(store.getItem(KEYS.panic), '0');
  assert.equal(store.getItem(KEYS.panicAt), null);
  assert.equal(loadState(store, '', T).mode, MODE.DISARMED);
});

test('reload never restores an ARMED display', () => {
  const store = mem();
  store.setItem(KEYS.arm, MODE.ARMED);
  store.setItem(KEYS.dryRunAck, '1');
  assert.equal(loadState(store, '', T).mode, MODE.DISARMED);
  const armed = arm(loadState(store, '', T));
  assert.equal(armed.mode, MODE.ARMED);
  writeStore(store, armed);
  assert.equal(store.getItem(KEYS.arm), null);
  assert.equal(loadState(store, '?panicWebhook=https://evil.example/arm', T).mode, MODE.DISARMED);
});

test('a query string cannot set a STOP destination', () => {
  const store = mem({ [LEGACY_WEBHOOK_KEY]: 'https://stored.example/a' });
  const next = loadState(store, '?panicWebhook=https://from-query.example/b', T);
  assert.equal(next.webhookUrl, undefined);
  assert.equal(store.getItem(LEGACY_WEBHOOK_KEY), null);
  const ignored = reduce(next, { type: 'webhook', url: 'https://typed.example/hook' }, T);
  assert.equal(ignored, next);
  const cleared = loadState(mem(), '?panicWebhook=', T);
  assert.equal(cleared.webhookUrl, undefined);
  assert.equal(Object.hasOwn(KEYS, 'webhook'), false);
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
  const stateSrc = read('../dist/live/state.js');
  const root = read('../live.html');
  const index = read('../dist/index.html');
  const readme = read('../README.md');
  assert.match(index, /href="live\.html"/);
  assert.match(html, /href="index\.html"/);
  assert.match(html, /id="bStop"/);
  assert.match(html, /LOCAL DEMO RESET/);
  assert.ok(html.includes(THRESHOLD_COPY));
  assert.ok(html.includes(RESET_DISCLAIMER));
  assert.equal(PLACEHOLDER.cash, UNKNOWN);
  assert.equal(PLACEHOLDER.pnl, UNKNOWN);
  assert.doesNotMatch(html, /max loss/i);
  assert.doesNotMatch(html, /\$0/);
  assert.doesNotMatch(page, /\.arc\(|\.fill\(/);
  assert.match(html, /id="ack"/);
  assert.match(html, /id="bArm"/);
  assert.match(root, /dist\/live\.html/);
  assert.ok(html.includes(DEMO_LABEL));
  assert.ok(html.includes('DEMO'));
  assert.ok(html.includes('NOT CONNECTED'));
  assert.ok(html.includes('UI ONLY'));
  assert.ok(html.includes(CONFIRM_TEXT));
  assert.ok(html.includes(BANNER_TEXT));
  assert.match(html, /Liquidation is not wired/);
  assert.match(html, /not an emergency exit/i);
  assert.match(page, /CONFIRM_TEXT/);
  assert.match(page, /localStorage/);
  assert.doesNotMatch(page, /\bfetch\s*\(|sendBeacon|XMLHttpRequest|new WebSocket|sessionStorage/);
  const src = [html, page, css, stateSrc, readme].join('\n');
  assert.doesNotMatch(src, /cb-access|api[_-]?secret|private[_-]?key|BEGIN [A-Z ]*PRIVATE|COINBASE_API/i);
  assert.doesNotMatch(src, /Trade Oversight executes/i);
  assert.doesNotMatch([page, stateSrc].join('\n'), /panicWebhook|URLSearchParams|\bfetch\s*\(/);
  assert.match(html, /ignores/);
  assert.match(readme, /not an emergency exit/i);
  assert.match(readme, /do not establish Coinbase isolation/i);
  assert.match(readme, /fixed, authenticated destination/);
  assert.match(readme, /session id/);
});
