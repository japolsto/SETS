import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONNECTED_BANNER, CONFIRM_TEXT, FORBIDDEN_PORTFOLIO_ID, KEYS, LEGACY_WEBHOOK_KEY, LIVE_MONITOR_BANNER, MODE,
  OFFLINE_BANNER, PLACEHOLDER, PORTFOLIO_ID, RESET_DISCLAIMER, RESET_LABEL, STATUS_SCHEMA, STOP_SENT,
  THRESHOLD_COPY, UNKNOWN,
  canArm, deliverStop, formatUsd, isHttpsUrl, killFraction, loadSettings, loadState,
  parseStatus, reduce, saveSettings, shouldDrawMark, stopRequest, webhookReady, writeStore,
} from '../dist/live/state.js';

const T = '2026-09-23T19:00:00.000Z';
const WEBHOOK = 'https://ops.example/sets-500-stop';

function mem(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('strategy ARM is impossible', () => {
  const state = loadState(mem(), '', T);
  assert.equal(state.mode, MODE.DISARMED);
  assert.equal(canArm(state), false);
  assert.equal(canArm({ dryRunAck: true, mode: MODE.DISARMED }), false);
  assert.equal(reduce(state, { type: 'arm' }, T), state);
  assert.equal(reduce(state, { type: 'ack', value: true }, T), state);
  assert.equal(reduce(state, { type: 'disarm' }, T), state);
});

test('reload never restores an ARMED display, even with an old panic flag', () => {
  const store = mem({ [KEYS.arm]: '1', [KEYS.panic]: '1' });
  const state = loadState(store, '', T);
  assert.equal(state.mode, MODE.DISARMED);
  assert.equal(state.stopSent, false);
  writeStore(store, state);
  assert.equal(store.getItem(KEYS.arm), null);
  assert.equal(store.getItem(KEYS.panic), '0');
});

test('query strings cannot set the webhook', () => {
  const fresh = loadSettings(mem(), '?panicWebhook=https://evil.example/arm&panic=https://evil.example/other');
  assert.deepEqual(fresh, { webhookUrl: '', webhookKey: '', statusUrl: '' });
  const store = mem();
  const saved = saveSettings(store, { webhookUrl: WEBHOOK, webhookKey: 'sender-key', statusUrl: '' });
  assert.equal(saved.ok, true);
  const loaded = loadSettings(store, '?panicWebhook=https://evil.example/arm&panic=https://evil.example/other');
  assert.equal(loaded.webhookUrl, WEBHOOK);
  assert.equal(loaded.webhookKey, 'sender-key');
  assert.equal(store.getItem(LEGACY_WEBHOOK_KEY), null);
});

test('STOP does not send without a saved webhook', () => {
  const plan = stopRequest({ webhookUrl: '', webhookKey: '' }, T);
  assert.equal(plan.post, false);
  assert.equal(webhookReady({ webhookUrl: '', webhookKey: '' }), false);
  const state = reduce(loadState(mem(), '', T), { type: 'stop', sent: false }, T);
  assert.equal(state.mode, MODE.DISARMED);
  assert.match(state.log.at(-1).text, /did not send/);
  assert.match(state.log.at(-1).text, /Nothing was posted/);
});

test('STOP posts the SETS-500 payload when a webhook is saved', async () => {
  const calls = [];
  const result = await deliverStop(
    { webhookUrl: WEBHOOK, webhookKey: 'sender-key' },
    T,
    async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 202 };
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, 202);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, WEBHOOK);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer sender-key');
  assert.equal(calls[0].opts.headers['X-Webhook-Key'], 'sender-key');
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.action, 'STOP');
  assert.equal(body.portfolio, 'SETS-500');
  assert.equal(body.portfolio_id, PORTFOLIO_ID);
  assert.equal(body.ts, T);
  assert.equal(body.key, 'sender-key');
  assert.equal(JSON.stringify(body).includes(FORBIDDEN_PORTFOLIO_ID), false);
  const latched = reduce(loadState(mem(), '', T), { type: 'stop', sent: true }, T);
  assert.equal(latched.mode, MODE.PANIC);
  assert.match(latched.log.at(-1).text, /STOP sent — await Trade Oversight confirmation/);
});

test('the default portfolio is refused in the webhook and the status feed', () => {
  const url = 'https://ops.example/' + FORBIDDEN_PORTFOLIO_ID;
  assert.equal(stopRequest({ webhookUrl: url, webhookKey: 'sender-key' }, T).post, false);
  assert.equal(saveSettings(mem(), { webhookUrl: url, webhookKey: 'sender-key', statusUrl: '' }).ok, false);
  assert.equal(parseStatus({ portfolio_id: FORBIDDEN_PORTFOLIO_ID, cash_usd: 10, pnl_usd: 0 }).ok, false);
  assert.equal(parseStatus({ portfolio_id: PORTFOLIO_ID, note: FORBIDDEN_PORTFOLIO_ID }).ok, false);
  assert.notEqual(PORTFOLIO_ID, FORBIDDEN_PORTFOLIO_ID);
});

test('plain http and a query password cannot be the webhook', () => {
  assert.equal(isHttpsUrl('http://ops.example/stop'), false);
  assert.equal(isHttpsUrl('https://user:secret@ops.example/stop'), false);
  assert.equal(stopRequest({ webhookUrl: 'http://ops.example/stop', webhookKey: 'sender-key' }, T).post, false);
});

test('balances stay UNKNOWN when there is no status feed', () => {
  assert.equal(parseStatus(null).ok, false);
  assert.equal(formatUsd(null), UNKNOWN);
  assert.equal(shouldDrawMark(null), false);
  assert.equal(shouldDrawMark(0), true);
  assert.equal(PLACEHOLDER.cash, UNKNOWN);
  assert.equal(PLACEHOLDER.pnl, UNKNOWN);
  const bad = reduce(loadState(mem(), '', T), { type: 'status', ok: false, error: '' }, T);
  assert.equal(bad.balances.cash, null);
  assert.equal(bad.balances.pnl, null);
  const good = parseStatus({
    portfolio: 'SETS-500',
    portfolio_id: PORTFOLIO_ID,
    cash_usd: 12.5,
    btc: 0.01,
    equity_usd: 80,
    pnl_usd: -3.5,
    updated_at: T,
    orders: [{ side: 'BUY', price: '100', size: '0.01', status: 'OPEN' }],
  });
  assert.equal(good.ok, true);
  assert.equal(good.snapshot.pnl, -3.5);
  assert.equal(formatUsd(good.snapshot.pnl), '−$3.50');
  assert.equal(shouldDrawMark(good.snapshot.pnl), true);
  const published = parseStatus(JSON.parse(readFileSync(new URL('../dist/status.json', import.meta.url), 'utf8')));
  assert.equal(published.ok, true);
  assert.equal(published.snapshot.strategy, 'DISARMED');
  assert.equal(published.snapshot.cash, 495.33);
  assert.equal(published.snapshot.btc, 0);
  assert.equal(published.snapshot.equity, 495.33);
  assert.equal(published.snapshot.pnl, null);
  assert.equal(published.snapshot.mid, 84454.17);
  assert.equal(shouldDrawMark(published.snapshot.pnl), false);
  const armedFeed = parseStatus({
    schema: STATUS_SCHEMA,
    portfolio: { name: 'SETS-500', uuid: PORTFOLIO_ID },
    strategy: 'ARMED',
    balances: { cash_usd: 1, btc: 0, equity_usd: 1 },
  });
  assert.equal(armedFeed.ok, true);
  assert.equal(armedFeed.snapshot.strategy, 'DISARMED');
  assert.equal(canArm(), false);
});

test('a failed webhook is not marked sent, and acknowledging the latch does not claim exposure is resolved', () => {
  let state = loadState(mem(), '', T);
  state = reduce(state, { type: 'stop-result', text: 'Webhook returned HTTP 500. STOP was not marked sent.' }, T);
  assert.equal(state.mode, MODE.DISARMED);
  state = reduce(state, { type: 'stop', sent: true }, T);
  assert.equal(state.panicAt, T);
  const again = reduce(state, { type: 'stop', sent: true }, '2026-09-23T19:09:00.000Z');
  assert.equal(again.panicAt, T);
  assert.match(again.log.at(-1).text, /latch stays/);
  const cleared = reduce(again, { type: 'clear-panic' }, '2026-09-23T19:10:00.000Z');
  assert.equal(cleared.mode, MODE.DISARMED);
  assert.equal(cleared.stopSent, false);
  assert.match(cleared.log.at(-1).text, /no claim that orders or exposure are resolved/i);
  assert.equal(reduce(cleared, { type: 'clear-panic' }, T), cleared);
});

test('a successful STOP latch survives reload and still ignores the query string', () => {
  const store = mem();
  let state = reduce(loadState(store, '', T), { type: 'stop', sent: true }, T);
  writeStore(store, state);
  const again = loadState(store, '?panic=https://evil.example/stop', T);
  assert.equal(again.stopSent, true);
  assert.equal(again.mode, MODE.PANIC);
  assert.equal(again.settings.webhookUrl, '');
  assert.match(again.log.map((row) => row.text).join('\n'), /STOP sent/);
});

test('kill fraction stays empty without a reading and reaches the threshold only on a real loss', () => {
  assert.equal(killFraction(null), null);
  assert.equal(killFraction(0), 0);
  assert.equal(killFraction(-75), 1);
  assert.equal(killFraction(-150), 1);
  assert.equal(CONFIRM_TEXT, 'Send STOP for SETS-500 to the saved Trade Oversight webhook?');
  assert.equal(STOP_SENT, 'STOP sent — await Trade Oversight confirmation');
  assert.equal(RESET_LABEL, 'ACKNOWLEDGE LATCH');
  assert.match(RESET_DISCLAIMER, /no claim that orders or exposure are resolved/i);
  assert.equal(LIVE_MONITOR_BANNER, 'LIVE MONITOR · COINBASE READ · STRATEGY DISARMED');
  assert.equal(CONNECTED_BANNER, LIVE_MONITOR_BANNER);
  assert.equal(OFFLINE_BANNER, 'NOT CONNECTED');
  assert.equal(THRESHOLD_COPY, 'Loss intervention threshold -$75; losses may exceed this.');
});

test('live page wires STOP to saved settings and leaves ARM off', () => {
  const html = readFileSync(new URL('../dist/live.html', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../dist/live.js', import.meta.url), 'utf8');
  const stateSrc = readFileSync(new URL('../dist/live/state.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(THRESHOLD_COPY));
  assert.ok(html.includes(RESET_DISCLAIMER));
  assert.ok(html.includes(PORTFOLIO_ID));
  assert.ok(html.includes(OFFLINE_BANNER));
  assert.ok(html.includes('ACKNOWLEDGE LATCH'));
  assert.ok(html.includes('id="bStop"'));
  assert.ok(html.includes('disabled'));
  assert.ok(stateSrc.includes(LIVE_MONITOR_BANNER));
  assert.ok(stateSrc.includes(STATUS_SCHEMA));
  assert.match(page, /STATUS_FILE/);
  assert.match(stateSrc, /status\.json/);
  assert.match(index, /href="live\.html"/);
  assert.match(html, /SETS-500 STOP liquidate/);
  assert.doesNotMatch(html, /\$0/);
  assert.doesNotMatch([html, page, stateSrc].join('\n'), /Trade Oversight executes|executes the actual Coinbase/);
  assert.doesNotMatch([page, stateSrc].join('\n'), /panicWebhook|URLSearchParams|COINBASE_API|cb-access|BEGIN (RSA |OPENSSH )?PRIVATE/);
  assert.match(page, /method:\s*'POST'/);
  assert.match(stateSrc, /Authorization/);
  assert.match(stateSrc, /X-Webhook-Key/);
});
