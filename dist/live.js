// SETS LIVE controller. Raises a panic flag and optionally POSTs it.
// No Coinbase credentials. No orders are placed from this page.

import { drawLogo, sized } from './ui/draw.js';
import {
  BANNER_TEXT, CONFIRM_TEXT, KEYS, MAX_LOSS_USD, MODE, PLACEHOLDER, PORTFOLIO,
  canArm, killFraction, loadState, reduce, webhookPlan, writeStore,
} from './live/state.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

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

function commit(next) {
  state = next;
  writeStore(store, state);
  render();
}

function render() {
  const panic = state.mode === MODE.PANIC;
  document.body.classList.toggle('is-panic', panic);

  const readout = $('armReadout');
  readout.dataset.mode = state.mode;
  $('armMode').textContent = state.mode;
  $('pillText').textContent = state.mode;
  const pill = $('pill');
  pill.classList.toggle('panic', panic);
  pill.classList.toggle('idle', state.mode === MODE.DISARMED);

  $('banner').hidden = !panic;
  $('bannerWord').textContent = BANNER_TEXT;

  $('genome').textContent = PLACEHOLDER.genome;
  $('genomeNote').textContent = PLACEHOLDER.genomeNote;
  $('mCash').textContent = PLACEHOLDER.cash;
  $('mBtc').textContent = PLACEHOLDER.btc;
  $('mEq').textContent = PLACEHOLDER.equity;
  $('mPnl').textContent = PLACEHOLDER.pnl;

  const frac = killFraction(null, MAX_LOSS_USD);
  $('killNote').textContent = panic
    ? 'PANIC IS OPERATOR-RAISED. There is still no live mark. Kill stays at −$' + MAX_LOSS_USD + '.'
    : 'PLACEHOLDER. No account feed, so the marker stays at $0. Kill is −$' + MAX_LOSS_USD + '.';
  kill.el.dataset.frac = frac == null ? 'none' : String(frac);

  const orders = $('orders');
  orders.replaceChildren();
  const row = document.createElement('div');
  row.className = 'grow2 ghost';
  for (const [cls, text] of [['l', '—'], ['', '—'], ['', '—'], ['s', PLACEHOLDER.orders]]) {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    row.append(span);
  }
  orders.append(row);

  const log = $('log');
  log.replaceChildren();
  for (const entry of state.log.slice(-12)) {
    const line = document.createElement('div');
    const kind = document.createElement('b');
    kind.textContent = entry.kind;
    if (entry.kind === 'PANIC') kind.className = 'panic';
    else if (entry.kind === 'SYS') kind.className = 'ev';
    const when = document.createElement('span');
    when.textContent = entry.t ? entry.t.slice(11, 19) + 'Z' : '';
    line.append(kind, document.createTextNode(entry.text + ' '), when);
    log.append(line);
  }

  $('ack').checked = state.dryRunAck;
  const arm = $('bArm');
  arm.disabled = !canArm(state);
  arm.classList.toggle('on', state.mode === MODE.ARMED);
  $('bDisarm').disabled = state.mode !== MODE.ARMED;
  $('bClear').disabled = !panic;

  const hook = $('webhook');
  if (document.activeElement !== hook && hook.value !== state.webhookUrl) hook.value = state.webhookUrl;
  $('hookState').textContent = state.webhookNote
    || (state.webhookUrl
      ? 'Webhook ready. It sends only after STOP is confirmed.'
      : 'No webhook. STOP latches panic on this browser only.');

  $('bStop').setAttribute('aria-pressed', panic ? 'true' : 'false');
  drawKill();
}

function drawKill() {
  const { g, w, h } = kill;
  g.clearRect(0, 0, w, h);
  const x0 = 2;
  const x1 = w - 2;
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
  const grad = g.createLinearGradient(x0, y, x1, y);
  grad.addColorStop(0, '#dbeafe');
  grad.addColorStop(0.72, '#dbeafe');
  grad.addColorStop(1, '#fecaca');
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = state.mode === MODE.PANIC ? '#dc2626' : '#d6e1f0';
  g.lineWidth = 1;
  g.stroke();

  const killX = x1 - Math.max(18, (x1 - x0) * 0.02);
  g.strokeStyle = '#dc2626';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(killX, y + 2);
  g.lineTo(killX, y + barH - 2);
  g.stroke();

  const mark = x0 + radius;
  g.fillStyle = state.mode === MODE.PANIC ? '#dc2626' : '#2563eb';
  g.beginPath();
  g.arc(mark, y + barH / 2, 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(mark, y + barH / 2, 2.5, 0, Math.PI * 2);
  g.fill();
}

function openModal(kind) {
  dialogKind = kind;
  modal.returnValue = '';
  const panic = state.mode === MODE.PANIC;
  if (kind === 'stop') {
    $('modalTitle').textContent = panic ? 'PANIC ALREADY LATCHED' : 'CONFIRM STOP';
    $('modalBody').textContent = CONFIRM_TEXT;
    $('modalWarn').textContent = panic
      ? 'Confirming again keeps PANIC latched and resends the webhook if one is set. This page still cannot place the Coinbase order. Trade Oversight executes cancel, sell, and the USDC convert in SETS-500 only.'
      : 'Confirming latches PANIC in this browser and, if a webhook is set, POSTs the panic JSON. This page cannot place the Coinbase order. Trade Oversight executes cancel, sell, and the USDC convert in SETS-500 only.';
    $('modalOk').textContent = BANNER_TEXT;
  } else {
    $('modalTitle').textContent = 'CLEAR PANIC (OPERATOR)';
    $('modalBody').textContent = 'Clear the local panic flag for ' + PORTFOLIO + '?';
    $('modalWarn').textContent = 'This does not cancel orders, does not buy back BTC, and does not talk to Coinbase. Do it only after you have checked the SETS-500 silo. The panel returns to DISARMED.';
    $('modalOk').textContent = 'CLEAR PANIC';
  }
  if (!modal.open) modal.showModal();
  $('modalCancel').focus();
}

async function confirmStop() {
  const now = new Date().toISOString();
  state = reduce(state, { type: 'stop' }, now);
  writeStore(store, state);
  render();
  const plan = webhookPlan(state.webhookUrl);
  if (!plan.post) {
    commit(reduce(state, { type: 'webhook-result', text: plan.detail }, now));
    return;
  }
  state = reduce(state, { type: 'webhook-result', text: 'Posting STOP_LIQUIDATE_USDC…' }, now);
  render();
  try {
    const res = await fetch(plan.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(plan.body),
      keepalive: true,
    });
    const text = res.ok
      ? 'Webhook accepted (' + res.status + '). Operator still executes the Coinbase cancel and USDC convert.'
      : 'Webhook returned ' + res.status + '. Panic stays latched. Operator must still liquidate SETS-500.';
    commit(reduce(state, { type: 'webhook-result', text }, new Date().toISOString()));
  } catch (err) {
    const why = err && err.message ? err.message : 'network';
    commit(reduce(state, {
      type: 'webhook-result',
      text: 'Webhook failed (' + why + '). Panic stays latched. Operator must still liquidate SETS-500.',
    }, new Date().toISOString()));
  }
}

function clearPanic() {
  commit(reduce(state, { type: 'clear-panic' }, new Date().toISOString()));
}

$('bStop').addEventListener('click', () => openModal('stop'));
$('bClear').addEventListener('click', () => { if (state.mode === MODE.PANIC) openModal('clear'); });
$('bArm').addEventListener('click', () => {
  if (!canArm(state)) return;
  commit(reduce(state, { type: 'arm' }, new Date().toISOString()));
});
$('bDisarm').addEventListener('click', () => {
  commit(reduce(state, { type: 'disarm' }, new Date().toISOString()));
});
$('ack').addEventListener('change', () => {
  commit(reduce(state, { type: 'ack', value: $('ack').checked }, new Date().toISOString()));
});
$('webhook').addEventListener('input', () => {
  commit(reduce(state, { type: 'webhook', url: $('webhook').value }, new Date().toISOString()));
});

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

function frame(t) {
  drawLogo(logo, reduceMotion ? 0 : t / 1000);
  drawKill();
  if (!reduceMotion) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (reduceMotion) new ResizeObserver(() => requestAnimationFrame(drawKill)).observe(kill.el);

render();

window.SETS_LIVE = {
  get state() { return state; },
  KEYS,
  PLACEHOLDER,
  CONFIRM_TEXT,
  BANNER_TEXT,
};
