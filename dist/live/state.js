// SETS LIVE operator state.
// STOP can post only to a webhook saved in this browser. Query strings are ignored.
// Strategy ARM is not implemented. This module never holds Coinbase API keys.

export const PORTFOLIO = 'SETS-500';
export const PORTFOLIO_ID = '04309540-7942-460f-8509-151565372f5b';
export const FORBIDDEN_PORTFOLIO_ID = 'fec63e7b-dccd-5b1f-9ae1-0700e22e92db';
export const PAIR = 'BTC-USD';
export const MARKET = 'SPOT';
export const MAX_LOSS_USD = 75;
export const THRESHOLD_COPY = 'Loss intervention threshold -$75; losses may exceed this.';
export const LIVE_MONITOR_BANNER = 'LIVE MONITOR · COINBASE READ · STRATEGY DISARMED';
export const CONNECTED_BANNER = LIVE_MONITOR_BANNER;
export const OFFLINE_BANNER = 'NOT CONNECTED';
export const STATUS_SCHEMA = 'sets-live-status/v1';
export const STATUS_FILE = 'status.json';
export const CONFIRM_TEXT = 'Send STOP for SETS-500 to the saved Trade Oversight webhook?';
export const STOP_SENT = 'STOP sent — await Trade Oversight confirmation';
export const RESET_LABEL = 'ACKNOWLEDGE LATCH';
export const RESET_DISCLAIMER = 'There is no claim that orders or exposure are resolved.';
export const UNKNOWN = 'UNKNOWN';
export const LEGACY_WEBHOOK_KEY = 'sets.live.webhook';

export const MODE = {
  DISARMED: 'DISARMED',
  ARMED: 'ARMED',
  PANIC: 'PANIC',
};

export const KEYS = {
  stopSent: 'sets.live.stopSent',
  stopSentAt: 'sets.live.stopSentAt',
  arm: 'sets.live.arm',
  panic: 'sets.live.panic',
  webhookUrl: 'sets.live.stopUrl',
  webhookKey: 'sets.live.stopKey',
  statusUrl: 'sets.live.statusUrl',
};

export const PLACEHOLDER = {
  cash: UNKNOWN,
  btc: UNKNOWN,
  equity: UNKNOWN,
  pnl: UNKNOWN,
  genome: UNKNOWN,
  genomeNote: 'UNAVAILABLE',
  orders: UNKNOWN,
};

const LOG_MAX = 40;

export function canArm() {
  return false;
}

export function shouldDrawMark(pnl) {
  return Number.isFinite(pnl);
}

export function killFraction(pnl, maxLoss = MAX_LOSS_USD) {
  if (!shouldDrawMark(pnl) || maxLoss <= 0) return null;
  const loss = Math.max(0, -pnl);
  return Math.max(0, Math.min(1, loss / maxLoss));
}

export function containsForbidden(value) {
  return String(value == null ? '' : value).toLowerCase().includes(FORBIDDEN_PORTFOLIO_ID);
}

export function isHttpsUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || containsForbidden(trimmed)) return false;
  let parsed;
  try { parsed = new URL(trimmed); } catch { return false; }
  if (parsed.username || parsed.password) return false;
  return parsed.protocol === 'https:';
}

function safeKey(key) {
  if (typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 500 || /[\r\n]/.test(trimmed) || containsForbidden(trimmed)) return '';
  return trimmed;
}

export function emptySettings() {
  return { webhookUrl: '', webhookKey: '', statusUrl: '' };
}

export function webhookReady(settings) {
  return !!(settings && isHttpsUrl(settings.webhookUrl) && safeKey(settings.webhookKey));
}

export function stopBody(now, key) {
  return {
    action: 'STOP',
    portfolio: PORTFOLIO,
    portfolio_id: PORTFOLIO_ID,
    ts: now,
    key,
  };
}

export function stopRequest(settings, now) {
  const webhookUrl = (settings && settings.webhookUrl || '').trim();
  const key = safeKey(settings && settings.webhookKey);
  if (!webhookUrl || !key) {
    return { post: false, reason: 'unconfigured', detail: 'Save the Trade Oversight webhook URL and sender key first. Nothing was posted.' };
  }
  if (!isHttpsUrl(webhookUrl) || containsForbidden(webhookUrl)) {
    return { post: false, reason: 'rejected', detail: 'The saved webhook must be an https URL for SETS-500. The default portfolio is refused. Nothing was posted.' };
  }
  return {
    post: true,
    url: webhookUrl,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer ' + key,
      'X-Webhook-Key': key,
    },
    body: stopBody(now, key),
  };
}

export async function deliverStop(settings, now, fetchImpl) {
  const plan = stopRequest(settings, now);
  if (!plan.post) return plan;
  const res = await fetchImpl(plan.url, {
    method: 'POST',
    headers: plan.headers,
    body: JSON.stringify(plan.body),
  });
  return { post: true, ok: !!(res && res.ok), status: res && res.status, url: plan.url, body: plan.body };
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function portfolioIdOf(json) {
  if (json.portfolio && typeof json.portfolio === 'object') return json.portfolio.uuid || json.portfolio.id || '';
  return json.portfolio_id || json.portfolioId || '';
}

function portfolioNameOf(json) {
  if (json.portfolio && typeof json.portfolio === 'object') return json.portfolio.name || '';
  if (typeof json.portfolio === 'string') return json.portfolio;
  return '';
}

export function parseStatus(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, reason: 'invalid' };
  if (containsForbidden(JSON.stringify(json))) return { ok: false, reason: 'forbidden-portfolio' };
  if (json.schema && json.schema !== STATUS_SCHEMA) return { ok: false, reason: 'schema' };
  const id = portfolioIdOf(json);
  if (json.schema === STATUS_SCHEMA && id !== PORTFOLIO_ID) return { ok: false, reason: 'wrong-portfolio' };
  if (id && id !== PORTFOLIO_ID) return { ok: false, reason: 'wrong-portfolio' };
  const name = portfolioNameOf(json);
  if (name && name !== PORTFOLIO) return { ok: false, reason: 'wrong-portfolio' };
  const bal = json.balances && typeof json.balances === 'object' ? json.balances : json;
  const market = json.market && typeof json.market === 'object' ? json.market : {};
  const genome = json.genome && typeof json.genome === 'object' ? json.genome.label : json.genome_id;
  const orders = Array.isArray(json.orders) ? json.orders.slice(0, 8).map((row) => ({
    side: row && row.side ? String(row.side) : UNKNOWN,
    price: row && row.price != null ? String(row.price) : UNKNOWN,
    size: row && (row.size != null ? String(row.size) : UNKNOWN) || UNKNOWN,
    status: row && row.status ? String(row.status) : UNKNOWN,
  })) : null;
  return {
    ok: true,
    snapshot: {
      cash: num(bal.cash_usd != null ? bal.cash_usd : bal.cash),
      btc: num(bal.btc),
      equity: num(bal.equity_usd != null ? bal.equity_usd : bal.equity),
      pnl: num(bal.pnl_usd != null ? bal.pnl_usd : bal.pnl),
      mid: num(market.mid != null ? market.mid : json.mid),
      genome: genome ? String(genome) : null,
      orders,
      updatedAt: json.updated_at ? String(json.updated_at) : (json.as_of ? String(json.as_of) : null),
      strategy: 'DISARMED',
      live: true,
    },
  };
}

export function formatUsd(n) {
  if (!Number.isFinite(n)) return UNKNOWN;
  const sign = n < 0 ? '−$' : '$';
  return sign + Math.abs(n).toFixed(2);
}

export function formatBtc(n) {
  if (!Number.isFinite(n)) return UNKNOWN;
  return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' BTC';
}

function stamp(now, kind, text) {
  return { t: now, kind, text };
}

function pushLog(state, row) {
  const log = state.log.length >= LOG_MAX ? state.log.slice(state.log.length - (LOG_MAX - 1)) : state.log.slice();
  log.push(row);
  return log;
}

function scrubLegacy(storage) {
  storage.removeItem(LEGACY_WEBHOOK_KEY);
  storage.removeItem(KEYS.arm);
  storage.removeItem('sets.live.panicAt');
}

export function loadSettings(storage, _search) {
  scrubLegacy(storage);
  const webhookUrl = storage.getItem(KEYS.webhookUrl) || '';
  const webhookKey = storage.getItem(KEYS.webhookKey) || '';
  const statusUrl = storage.getItem(KEYS.statusUrl) || '';
  return {
    webhookUrl: isHttpsUrl(webhookUrl) ? webhookUrl : '',
    webhookKey: safeKey(webhookKey),
    statusUrl: statusUrl && isHttpsUrl(statusUrl) ? statusUrl : '',
  };
}

export function saveSettings(storage, input) {
  const webhookUrl = (input && input.webhookUrl || '').trim();
  const webhookKey = (input && input.webhookKey || '').trim();
  const statusUrl = (input && input.statusUrl || '').trim();
  if (webhookUrl && !isHttpsUrl(webhookUrl)) {
    return { ok: false, error: 'Webhook URL must be https, without a password in the URL, and must not name the default portfolio.' };
  }
  if (webhookKey && !safeKey(webhookKey)) {
    return { ok: false, error: 'Sender key was refused. It cannot contain line breaks or the default portfolio id.' };
  }
  if ((webhookUrl && !webhookKey) || (!webhookUrl && webhookKey)) {
    return { ok: false, error: 'Save both the webhook URL and the sender key, or clear both.' };
  }
  if (statusUrl && !isHttpsUrl(statusUrl)) {
    return { ok: false, error: 'Status URL must be https and must not name the default portfolio.' };
  }
  if (!webhookUrl) storage.removeItem(KEYS.webhookUrl);
  else storage.setItem(KEYS.webhookUrl, webhookUrl);
  if (!webhookKey) storage.removeItem(KEYS.webhookKey);
  else storage.setItem(KEYS.webhookKey, webhookKey);
  if (!statusUrl) storage.removeItem(KEYS.statusUrl);
  else storage.setItem(KEYS.statusUrl, statusUrl);
  return { ok: true, settings: loadSettings(storage, ''), error: '' };
}

export function readStore(storage) {
  const stopSent = storage.getItem(KEYS.stopSent) === '1';
  const panicAt = storage.getItem(KEYS.stopSentAt) || null;
  return {
    mode: stopSent ? MODE.PANIC : MODE.DISARMED,
    stopSent,
    panicAt: stopSent ? panicAt : null,
  };
}

export function writeStore(storage, state) {
  scrubLegacy(storage);
  storage.setItem(KEYS.stopSent, state.stopSent ? '1' : '0');
  storage.setItem(KEYS.panic, state.stopSent ? '1' : '0');
  if (state.stopSent && state.panicAt) storage.setItem(KEYS.stopSentAt, String(state.panicAt));
  else storage.removeItem(KEYS.stopSentAt);
}

export function loadState(storage, search, now) {
  const saved = readStore(storage);
  const settings = loadSettings(storage, search);
  const log = [stamp(now, 'SYS', webhookReady(settings)
    ? 'STOP webhook is saved in this browser. Strategy ARM stays off. Balances stay UNKNOWN until the status URL answers.'
    : 'NOT CONNECTED. Save the Trade Oversight webhook before STOP can send. Strategy ARM stays off. Balances are UNKNOWN.')];
  if (saved.stopSent) {
    log.push(stamp(now, 'STOP', 'Previous STOP latch restored. ' + STOP_SENT + '. Acknowledge the latch when you have checked Trade Oversight.'));
  }
  return {
    mode: saved.mode,
    stopSent: saved.stopSent,
    panicAt: saved.panicAt,
    settings,
    balances: { cash: null, btc: null, equity: null, pnl: null, mid: null, genome: null, orders: null, updatedAt: null, strategy: 'DISARMED', live: false, error: '' },
    log,
  };
}

export function reduce(state, action, now = null) {
  switch (action.type) {
    case 'arm':
    case 'disarm':
    case 'ack':
      return state;
    case 'settings': {
      return { ...state, settings: action.settings };
    }
    case 'stop': {
      if (!action.sent) {
        return {
          ...state,
          log: pushLog(state, stamp(now, 'STOP', 'STOP did not send. Save the Trade Oversight webhook and sender key first. Nothing was posted.')),
        };
      }
      const already = state.stopSent;
      return {
        ...state,
        mode: MODE.PANIC,
        stopSent: true,
        panicAt: state.panicAt || now,
        log: pushLog(state, stamp(now, 'STOP', already
          ? 'STOP sent again. ' + STOP_SENT + '. The latch stays until you acknowledge it.'
          : STOP_SENT + '.')),
      };
    }
    case 'stop-result': {
      return { ...state, log: pushLog(state, stamp(now, 'STOP', action.text)) };
    }
    case 'status': {
      if (!action.ok) {
        return {
          ...state,
          balances: { cash: null, btc: null, equity: null, pnl: null, mid: null, genome: null, orders: null, updatedAt: null, strategy: 'DISARMED', live: false, error: action.error == null ? 'Status feed unavailable.' : action.error },
        };
      }
      return { ...state, balances: { ...action.snapshot, error: '' } };
    }
    case 'clear-panic': {
      if (!state.stopSent) return state;
      return {
        ...state,
        mode: MODE.DISARMED,
        stopSent: false,
        panicAt: null,
        log: pushLog(state, stamp(now, 'STOP', 'Latch acknowledged. ' + RESET_DISCLAIMER + ' Strategy stays disarmed.')),
      };
    }
    default:
      return state;
  }
}
