// SETS LIVE operator panel. STOP posts to a webhook saved in this browser.
// No Coinbase API keys. Strategy ARM is not implemented. Query strings are ignored.

import { drawLogo, sized } from './ui/draw.js';
import {
  CONNECTED_BANNER, CONFIRM_TEXT, KEYS, MODE, OFFLINE_BANNER, PLACEHOLDER, PORTFOLIO, PORTFOLIO_ID,
  RESET_DISCLAIMER, RESET_LABEL, STOP_SENT,
  canArm, formatBtc, formatUsd, isHttpsUrl, killFraction, loadState, parseStatus, reduce,
  saveSettings, shouldDrawMark, stopRequest, webhookReady, writeStore,
} from './live/state.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const STATUS_MS = 15000;

const memory = new Map();
const store = {
  getItem(k) {
    try { return localStorage.getItem(k); } catch { return memory.has(k) ? memory.get(k) : null; }
  },
  setItem(k, v) {
    const value = String(v);
    memory.set(k, value);
    try { localStorage.setItem(k, value); } catch { /* private mode: keep the session copy */ }
  },
  removeItem(k) {
    memory.delete(k);
    try { localStorage.removeItem(k); } catch { /* private mode: session copy already dropped */ }
  },
};

let state = loadState(store, location.search, new Date().toISOString());
writeStore(store, state);

const logo = sized($('logo'));
const kill = sized($('kill'));
const modal = $('modal');
let dialogKind = null;
let posting = false;

function commit(next) {
  state = next;
  writeStore(store, state);
  render();
}

function money(n) {
  return formatUsd(n);
}

function render() {
  const panic = state.stopSent;
  const wired = webhookReady(state.settings);
  document.body.classList.toggle('is-panic', panic);

  const readout = $('armReadout');
  readout.dataset.mode = MODE.DISARMED;
  $('armMode').textContent = MODE.DISARMED;
  $('pillText').textContent = panic ? MODE.PANIC : MODE.DISARMED;
  const pill = $('pill');
  pill.classList.toggle('panic', panic);
  pill.classList.toggle('idle', !panic);

  $('connA').textContent = wired ? 'LIVE' : OFFLINE_BANNER;
  $('connB').textContent = wired ? 'STOP WIRED' : 'STOP OFF';
  $('connC').textContent = 'STRATEGY DISARMED';
  $('connText').textContent = wired
    ? CONNECTED_BANNER + '. STOP posts to the saved webhook for ' + PORTFOLIO + ' only. Balances stay UNKNOWN until the status URL answers. Strategy ARM stays off.'
    : 'NOT CONNECTED. Paste the Trade Oversight webhook and sender key, then save. STOP does not send until then. Strategy ARM stays off.';
  $('subLine').textContent = (wired ? CONNECTED_BANNER : OFFLINE_BANNER + ' · STOP OFF · STRATEGY DISARMED')
    + ' · ' + PORTFOLIO + ' · BTC-USD SPOT';

  $('banner').hidden = !panic;
  $('bannerWord').textContent = 'AWAIT CONFIRMATION';
  $('bannerNote').textContent = STOP_SENT + '. ' + RESET_DISCLAIMER;

  const bal = state.balances;
  $('genome').textContent = bal.genome || PLACEHOLDER.genome;
  $('genomeNote').textContent = bal.genome ? 'STATUS FEED' : PLACEHOLDER.genomeNote;
  $('mCash').textContent = money(bal.cash);
  $('mBtc').textContent = Number.isFinite(bal.btc) ? formatBtc(bal.btc) : PLACEHOLDER.btc;
  $('mEq').textContent = money(bal.equity);
  $('mPnl').textContent = money(bal.pnl);
  $('balanceTag').textContent = state.settings.statusUrl ? (bal.error ? 'STATUS FAILED' : (bal.updatedAt || bal.cash != null ? 'STATUS FEED' : 'WAITING')) : 'UNKNOWN';
  $('asOf').textContent = bal.error
    ? bal.error + ' Balances are UNKNOWN.'
    : (bal.updatedAt ? 'Status updated ' + bal.updatedAt + '.' : 'Account fields stay UNKNOWN until a status URL answers. This page does not call Coinbase.');

  const marked = shouldDrawMark(bal.pnl);
  $('killHead').textContent = marked ? money(bal.pnl) : 'UNKNOWN';
  $('killNote').textContent = marked
    ? 'P&L is from the status feed. The marker is that reading, not a guess. Losses may exceed the intervention threshold.'
    : 'Account data is unavailable. P&L is UNKNOWN. No marker is drawn.';
  kill.el.dataset.frac = marked ? String(killFraction(bal.pnl)) : 'none';

  const orders = $('orders');
  orders.replaceChildren();
  const rows = bal.orders;
  if (!rows) {
    orders.append(orderRow([PLACEHOLDER.orders, PLACEHOLDER.orders, PLACEHOLDER.orders, PLACEHOLDER.orders], true));
  } else if (!rows.length) {
    orders.append(orderRow(['NONE', 'NONE', 'NONE', 'NONE'], true));
  } else {
    for (const row of rows) orders.append(orderRow([row.side, row.price, row.size, row.status], false));
  }

  const log = $('log');
  log.replaceChildren();
  for (const entry of state.log.slice(-12)) {
    const line = document.createElement('div');
    const kind = document.createElement('b');
    kind.textContent = entry.kind;
    if (entry.kind === 'STOP') kind.className = 'panic';
    else if (entry.kind === 'SYS') kind.className = 'ev';
    const when = document.createElement('span');
    when.textContent = entry.t ? entry.t.slice(11, 19) + 'Z' : '';
    line.append(kind, document.createTextNode(entry.text + ' '), when);
    log.append(line);
  }

  const arm = $('bArm');
  arm.disabled = true;
  arm.classList.toggle('on', false);
  $('bDisarm').disabled = true;
  $('bClear').disabled = !panic;
  $('bStop').disabled = !wired || posting;
  $('bStop').setAttribute('aria-pressed', panic ? 'true' : 'false');
  $('stopHint').textContent = wired
    ? 'Sends STOP to the saved Trade Oversight webhook for SETS-500. Asks before it sends. Strategy ARM stays off.'
    : 'STOP is off until a webhook and sender key are saved in this browser. Nothing is sent.';
  $('settingsNote').textContent = wired
    ? 'Webhook saved in this browser. Query strings are ignored. The sender key is not written to the repo.'
    : 'Not saved. STOP stays off until you save an https webhook and sender key here.';
  drawKill(bal.pnl);
}

function orderRow(cells, ghost) {
  const row = document.createElement('div');
  row.className = ghost ? 'grow2 ghost' : 'grow2';
  cells.forEach((text, i) => {
    const span = document.createElement('span');
    if (i === 0) span.className = 'l';
    if (i === 3) span.className = 's';
    span.textContent = text;
    row.append(span);
  });
  return row;
}

function drawKill(pnl) {
  const { g, w, h } = kill;
  g.clearRect(0, 0, w, h);
  const x0 = 2;
  const x1 = Math.max(x0 + 4, w - 2);
  const y = 8;
  const barH = Math.max(16, h - 16);
  const radius = barH / 2;
  g.beginPath();
  g.moveTo(x0 + radius, y);
  g.arcTo(x1, y, x1, y + barH, radius);
  g.arcTo(x1, y + barH, x0, y + barH, radius);
  g.arcTo(x0, y + barH, x0, y, radius);
  g.arcTo(x0, y, x1, y, radius);
  g.closePath();
  g.strokeStyle = state.stopSent ? '#fecaca' : '#d6e1f0';
  g.lineWidth = 1.5;
  g.stroke();
  if (!shouldDrawMark(pnl)) return;
  const frac = killFraction(pnl);
  const inner0 = x0 + radius;
  const inner1 = x1 - radius;
  const x = inner0 + (inner1 - inner0) * frac;
  const cy = y + barH / 2;
  g.beginPath();
  g.arc(x, cy, 7, 0, Math.PI * 2);
  g.fillStyle = '#e11d2e';
  g.fill();
}

function fillSettingsForm() {
  if (document.activeElement !== $('webhookUrl')) $('webhookUrl').value = state.settings.webhookUrl;
  if (document.activeElement !== $('webhookKey')) $('webhookKey').value = state.settings.webhookKey;
  if (document.activeElement !== $('statusUrl')) $('statusUrl').value = state.settings.statusUrl;
}

function openModal(kind) {
  dialogKind = kind;
  modal.returnValue = '';
  if (kind === 'stop') {
    if (!webhookReady(state.settings)) return;
    $('modalTitle').textContent = state.stopSent ? 'SEND STOP AGAIN' : 'CONFIRM STOP';
    $('modalBody').textContent = CONFIRM_TEXT;
    $('modalWarn').textContent = 'This posts STOP for ' + PORTFOLIO + ' (' + PORTFOLIO_ID + ') to the saved webhook. It does not place strategy orders. ARM stays off. After a successful post the latch stays until you acknowledge it. ' + RESET_DISCLAIMER;
    $('modalOk').textContent = 'SEND STOP';
  } else {
    $('modalTitle').textContent = RESET_LABEL;
    $('modalBody').textContent = 'Acknowledge the local STOP latch for ' + PORTFOLIO + '?';
    $('modalWarn').textContent = RESET_LABEL + '. ' + RESET_DISCLAIMER + ' This does not say Coinbase exposure is resolved.';
    $('modalOk').textContent = RESET_LABEL;
  }
  if (!modal.open) modal.showModal();
  $('modalCancel').focus();
}

async function confirmStop() {
  const now = new Date().toISOString();
  const plan = stopRequest(state.settings, now);
  if (!plan.post) {
    commit(reduce(state, { type: 'stop', sent: false }, now));
    return;
  }
  posting = true;
  render();
  try {
    const res = await fetch(plan.url, {
      method: 'POST',
      headers: plan.headers,
      body: JSON.stringify(plan.body),
      keepalive: true,
    });
    if (!res.ok) {
      commit(reduce(state, { type: 'stop-result', text: 'Webhook returned HTTP ' + res.status + '. STOP was not marked sent. Strategy stays disarmed.' }, now));
      return;
    }
    commit(reduce(state, { type: 'stop', sent: true }, now));
  } catch (err) {
    const message = err && err.message ? err.message : 'network error';
    commit(reduce(state, { type: 'stop-result', text: 'Webhook did not confirm (' + message + '). STOP was not marked sent. Strategy stays disarmed.' }, now));
  } finally {
    posting = false;
    render();
  }
}

function clearPanic() {
  commit(reduce(state, { type: 'clear-panic' }, new Date().toISOString()));
}

function saveFromForm() {
  const result = saveSettings(store, {
    webhookUrl: $('webhookUrl').value,
    webhookKey: $('webhookKey').value,
    statusUrl: $('statusUrl').value,
  });
  $('settingsError').textContent = result.ok ? '' : result.error;
  if (!result.ok) return;
  commit(reduce(state, { type: 'settings', settings: result.settings }, new Date().toISOString()));
  pollStatus();
}

function balancesUnknown(bal) {
  return !bal.updatedAt && !bal.error && bal.cash == null && bal.btc == null && bal.equity == null && bal.pnl == null && !bal.genome && !bal.orders;
}

async function pollStatus() {
  const url = state.settings.statusUrl;
  if (!url || !isHttpsUrl(url)) {
    if (!balancesUnknown(state.balances)) {
      commit(reduce(state, { type: 'status', ok: false, error: '' }, new Date().toISOString()));
    }
    return;
  }
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (state.settings.statusUrl !== url) return;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (state.settings.statusUrl !== url) return;
    const parsed = parseStatus(json);
    if (!parsed.ok) {
      commit(reduce(state, { type: 'status', ok: false, error: 'Status feed refused (' + parsed.reason + ').' }, new Date().toISOString()));
      return;
    }
    commit(reduce(state, { type: 'status', ok: true, snapshot: parsed.snapshot }, new Date().toISOString()));
  } catch (err) {
    if (state.settings.statusUrl !== url) return;
    const message = err && err.message ? err.message : 'failed';
    commit(reduce(state, { type: 'status', ok: false, error: 'Status feed failed (' + message + ').' }, new Date().toISOString()));
  }
}

$('bStop').addEventListener('click', () => openModal('stop'));
$('bClear').addEventListener('click', () => { if (state.stopSent) openModal('clear'); });
$('bArm').addEventListener('click', () => { if (!canArm(state)) return; });
$('settingsForm').addEventListener('submit', (e) => { e.preventDefault(); saveFromForm(); });

modal.addEventListener('click', (e) => { if (e.target === modal) modal.close('cancel'); });
modal.addEventListener('close', () => {
  const kind = dialogKind;
  dialogKind = null;
  if (modal.returnValue !== 'ok') return;
  if (kind === 'stop') confirmStop();
  else if (kind === 'clear') clearPanic();
});

function tickClock() {
  $('clock').textContent = new Date().toLocaleTimeString('en-GB');
}
tickClock();
setInterval(tickClock, 1000);
setInterval(pollStatus, STATUS_MS);

function frame(t) {
  drawLogo(logo, reduceMotion ? 0 : t / 1000);
  drawKill(state.balances.pnl);
  if (!reduceMotion) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (reduceMotion) new ResizeObserver(() => requestAnimationFrame(() => drawKill(state.balances.pnl))).observe(kill.el);

fillSettingsForm();
render();
pollStatus();

window.SETS_LIVE = {
  get state() { return state; },
  KEYS,
  PLACEHOLDER,
  CONFIRM_TEXT,
  CONNECTED_BANNER,
  OFFLINE_BANNER,
  STOP_SENT,
  PORTFOLIO_ID,
};
