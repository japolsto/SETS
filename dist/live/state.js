// SETS LIVE operator state. This module never talks to an exchange and never
// holds credentials. Panic is a flag for the operator, plus an optional webhook.

export const PORTFOLIO = 'SETS-500';
export const PAIR = 'BTC-USD';
export const MARKET = 'SPOT';
export const MAX_LOSS_USD = 75;
export const STOP_ACTION = 'STOP_LIQUIDATE_USDC';
export const CONFIRM_TEXT = 'Cancel all SETS orders and liquidate SETS-owned BTC to USDC in SETS-500 only?';
export const BANNER_TEXT = 'LIQUIDATE→USDC';

export const MODE = {
  DISARMED: 'DISARMED',
  ARMED: 'ARMED',
  PANIC: 'PANIC',
};

export const KEYS = {
  panic: 'sets.live.panic',
  panicAt: 'sets.live.panicAt',
  arm: 'sets.live.arm',
  dryRunAck: 'sets.live.dryRunAck',
  webhook: 'sets.live.webhook',
};

export const PLACEHOLDER = {
  cash: '—',
  btc: '—',
  equity: '—',
  pnl: '—',
  genome: '—',
  genomeNote: 'NOT FROZEN',
  orders: 'NONE REPORTED',
};

const LOG_MAX = 40;

export function panicPayload() {
  return { action: STOP_ACTION, portfolio: PORTFOLIO };
}

export function isHttpUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  let parsed;
  try { parsed = new URL(trimmed); } catch { return false; }
  if (parsed.username || parsed.password) return false;
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

// What STOP should do with the optional webhook. Panic is latched either way.
export function webhookPlan(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    return { post: false, reason: 'skipped', detail: 'No webhook URL. Panic is latched in this browser only.' };
  }
  if (!isHttpUrl(trimmed)) {
    return { post: false, reason: 'rejected', detail: 'Webhook must be an http(s) URL without embedded credentials. Nothing was sent.' };
  }
  return { post: true, reason: 'post', url: trimmed, body: panicPayload() };
}

export function canArm(state) {
  return !!state.dryRunAck && state.mode !== MODE.PANIC;
}

// 0 at a flat or winning mark, 1 at the −$75 kill. Null means there is no mark.
export function killFraction(pnl, maxLoss = MAX_LOSS_USD) {
  if (pnl == null || !Number.isFinite(pnl) || maxLoss <= 0) return null;
  const loss = Math.max(0, -pnl);
  return Math.max(0, Math.min(1, loss / maxLoss));
}

export function webhookFromSearch(search) {
  const raw = search == null ? '' : String(search);
  const q = new URLSearchParams(raw.charAt(0) === '?' ? raw.slice(1) : raw);
  if (!q.has('panicWebhook')) return undefined;
  return (q.get('panicWebhook') || '').trim().slice(0, 2000);
}

function stamp(now, kind, text) {
  return { t: now, kind, text };
}

function pushLog(state, row) {
  const log = state.log.length >= LOG_MAX ? state.log.slice(state.log.length - (LOG_MAX - 1)) : state.log.slice();
  log.push(row);
  return log;
}

export function readStore(storage) {
  const panic = storage.getItem(KEYS.panic) === '1';
  const dryRunAck = storage.getItem(KEYS.dryRunAck) === '1';
  const arm = storage.getItem(KEYS.arm);
  const webhookUrl = storage.getItem(KEYS.webhook) || '';
  const panicAt = storage.getItem(KEYS.panicAt) || null;
  let mode = MODE.DISARMED;
  if (panic) mode = MODE.PANIC;
  else if (arm === MODE.ARMED && dryRunAck) mode = MODE.ARMED;
  return {
    mode,
    dryRunAck,
    webhookUrl,
    panicAt: mode === MODE.PANIC ? panicAt : null,
  };
}

export function writeStore(storage, state) {
  storage.setItem(KEYS.panic, state.mode === MODE.PANIC ? '1' : '0');
  if (state.mode === MODE.PANIC && state.panicAt) storage.setItem(KEYS.panicAt, String(state.panicAt));
  else storage.removeItem(KEYS.panicAt);
  storage.setItem(KEYS.arm, state.mode === MODE.ARMED ? MODE.ARMED : MODE.DISARMED);
  storage.setItem(KEYS.dryRunAck, state.dryRunAck ? '1' : '0');
  storage.setItem(KEYS.webhook, state.webhookUrl || '');
}

export function loadState(storage, search, now) {
  const saved = readStore(storage);
  const fromQuery = webhookFromSearch(search);
  const webhookUrl = fromQuery === undefined ? saved.webhookUrl : fromQuery;
  const log = [stamp(now, 'SYS', 'Panel idle. No exchange connection. Cash, BTC, equity, genome, orders, and P&L are placeholders.')];
  if (saved.mode === MODE.PANIC) {
    log.push(stamp(now, 'PANIC', 'Panic flag restored from this browser. LIQUIDATE→USDC still waits on the operator.'));
  } else if (saved.mode === MODE.ARMED) {
    log.push(stamp(now, 'ARM', 'Armed state restored from this browser.'));
  }
  if (fromQuery !== undefined && fromQuery !== saved.webhookUrl) {
    log.push(stamp(now, 'HOOK', fromQuery ? 'Panic webhook set from ?panicWebhook=.' : 'Panic webhook cleared from ?panicWebhook=.'));
  }
  return {
    mode: saved.mode,
    dryRunAck: saved.dryRunAck,
    webhookUrl,
    panicAt: saved.panicAt,
    webhookNote: '',
    log,
  };
}

export function reduce(state, action, now = null) {
  switch (action.type) {
    case 'ack': {
      const dryRunAck = !!action.value;
      if (state.mode === MODE.PANIC) {
        if (state.dryRunAck === dryRunAck) return state;
        return { ...state, dryRunAck };
      }
      if (!dryRunAck && state.mode === MODE.ARMED) {
        return {
          ...state,
          dryRunAck: false,
          mode: MODE.DISARMED,
          log: pushLog(state, stamp(now, 'ARM', 'Dry-run acknowledgement cleared. SETS-500 disarmed.')),
        };
      }
      if (state.dryRunAck === dryRunAck) return state;
      return { ...state, dryRunAck };
    }
    case 'arm': {
      if (!canArm(state) || state.mode === MODE.ARMED) return state;
      return {
        ...state,
        mode: MODE.ARMED,
        log: pushLog(state, stamp(now, 'ARM', 'Operator armed SETS-500. This browser still cannot place orders.')),
      };
    }
    case 'disarm': {
      if (state.mode !== MODE.ARMED) return state;
      return {
        ...state,
        mode: MODE.DISARMED,
        log: pushLog(state, stamp(now, 'ARM', 'Operator disarmed SETS-500.')),
      };
    }
    case 'stop': {
      const already = state.mode === MODE.PANIC;
      return {
        ...state,
        mode: MODE.PANIC,
        panicAt: state.panicAt || now,
        log: pushLog(state, stamp(now, 'PANIC', already
          ? 'STOP confirmed again. Panic stays latched. LIQUIDATE→USDC.'
          : 'STOP confirmed. Panic latched. LIQUIDATE→USDC. Operator must cancel and sell in SETS-500 only.')),
      };
    }
    case 'webhook': {
      const url = typeof action.url === 'string' ? action.url.trim().slice(0, 2000) : '';
      if (url === state.webhookUrl) return state;
      return { ...state, webhookUrl: url };
    }
    case 'webhook-result': {
      return {
        ...state,
        webhookNote: action.text,
        log: pushLog(state, stamp(now, 'HOOK', action.text)),
      };
    }
    case 'clear-panic': {
      if (state.mode !== MODE.PANIC) return state;
      return {
        ...state,
        mode: MODE.DISARMED,
        panicAt: null,
        log: pushLog(state, stamp(now, 'ARM', 'Operator cleared the panic flag. This does not undo a liquidation. Panel is DISARMED.')),
      };
    }
    default:
      return state;
  }
}
