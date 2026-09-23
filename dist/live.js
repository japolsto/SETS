// SETS LIVE demonstration. STOP latches a local panic flag.
// No Coinbase credentials, no webhook destination, no orders.

import { drawLogo, sized } from './ui/draw.js';
import {
  BANNER_TEXT, CONFIRM_TEXT, KEYS, MAX_LOSS_USD, MODE, PLACEHOLDER, PORTFOLIO,
  canArm, killFraction, loadState, reduce, writeStore,
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
    ? 'Local PANIC flag only. There is still no live mark, and liquidation is not wired. Kill stays at −$' + MAX_LOSS_USD + '.'
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
      ? 'PANIC is already a local flag. Confirming again changes nothing on an exchange. Liquidation is not wired. No order is sent.'
      : 'This latches PANIC in this browser and nothing else. It does not cancel orders, sell BTC, or convert to USDC. Liquidation is not wired.';
    $('modalOk').textContent = 'LATCH PANIC';
  } else {
    $('modalTitle').textContent = 'CLEAR PANIC (OPERATOR)';
    $('modalBody').textContent = 'Clear the local panic flag for ' + PORTFOLIO + '?';
    $('modalWarn').textContent = 'Clears the local flag only. This page never sent a cancel, sell, or convert. The panel returns to DISARMED.';
    $('modalOk').textContent = 'CLEAR PANIC';
  }
  if (!modal.open) modal.showModal();
  $('modalCancel').focus();
}

function confirmStop() {
  commit(reduce(state, { type: 'stop' }, new Date().toISOString()));
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
