// SETS LIVE demonstration state. This module never talks to an exchange,
// never holds credentials, and never chooses a STOP destination.
// Panic is a local flag. Liquidation is not wired.

export const PORTFOLIO = 'SETS-500';
export const PAIR = 'BTC-USD';
export const MARKET = 'SPOT';
export const MAX_LOSS_USD = 75;
export const DEMO_LABEL = 'DEMO · NOT CONNECTED · UI ONLY';
export const CONFIRM_TEXT = 'Latch a local PANIC flag for SETS-500 in this browser only?';
export const BANNER_TEXT = 'PANIC LATCHED';
export const LEGACY_WEBHOOK_KEY = 'sets.live.webhook';

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

export function canArm(state) {
  return !!state.dryRunAck && state.mode !== MODE.PANIC;
}

// 0 at a flat or winning mark, 1 at the −$75 kill. Null means there is no mark.
export function killFraction(pnl, maxLoss = MAX_LOSS_USD) {
  if (pnl == null || !Number.isFinite(pnl) || maxLoss <= 0) return null;
  const loss = Math.max(0, -pnl);
  return Math.max(0, Math.min(1, loss / maxLoss));
}

function stamp(now, kind, text) {
  return { t: now, kind, text };
}

function pushLog(state, row) {
  const log = state.log.length >= LOG_MAX ? state.log.slice(state.log.length - (LOG_MAX - 1)) : state.log.slice();
  log.push(row);
  return log;
}

function scrubDestination(storage) {
  storage.removeItem(LEGACY_WEBHOOK_KEY);
}

export function readStore(storage) {
  const panic = storage.getItem(KEYS.panic) === '1';
  const dryRunAck = storage.getItem(KEYS.dryRunAck) === '1';
  const arm = storage.getItem(KEYS.arm);
  const panicAt = storage.getItem(KEYS.panicAt) || null;
  let mode = MODE.DISARMED;
  if (panic) mode = MODE.PANIC;
  else if (arm === MODE.ARMED && dryRunAck) mode = MODE.ARMED;
  return {
    mode,
    dryRunAck,
    panicAt: mode === MODE.PANIC ? panicAt : null,
  };
}

export function writeStore(storage, state) {
  scrubDestination(storage);
  storage.setItem(KEYS.panic, state.mode === MODE.PANIC ? '1' : '0');
  if (state.mode === MODE.PANIC && state.panicAt) storage.setItem(KEYS.panicAt, String(state.panicAt));
  else storage.removeItem(KEYS.panicAt);
  storage.setItem(KEYS.arm, state.mode === MODE.ARMED ? MODE.ARMED : MODE.DISARMED);
  storage.setItem(KEYS.dryRunAck, state.dryRunAck ? '1' : '0');
}

// `search` is accepted and ignored. A query string must not choose a destination.
export function loadState(storage, _search, now) {
  scrubDestination(storage);
  const saved = readStore(storage);
  const log = [stamp(now, 'SYS', 'Demonstration idle. Not connected. Cash, BTC, equity, genome, orders, and P&L are placeholders. STOP only latches a local flag.')];
  if (saved.mode === MODE.PANIC) {
    log.push(stamp(now, 'PANIC', 'Local panic flag restored from this browser. Liquidation is not wired.'));
  } else if (saved.mode === MODE.ARMED) {
    log.push(stamp(now, 'ARM', 'Dry-run demo arm restored from this browser. Operational arm is not connected.'));
  }
  return {
    mode: saved.mode,
    dryRunAck: saved.dryRunAck,
    panicAt: saved.panicAt,
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
          log: pushLog(state, stamp(now, 'ARM', 'Dry-run acknowledgement cleared. Demo disarmed. Operational arm is not connected.')),
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
        log: pushLog(state, stamp(now, 'ARM', 'Dry-run demo armed. This is not an operational arm. This browser cannot place orders.')),
      };
    }
    case 'disarm': {
      if (state.mode !== MODE.ARMED) return state;
      return {
        ...state,
        mode: MODE.DISARMED,
        log: pushLog(state, stamp(now, 'ARM', 'Dry-run demo disarmed.')),
      };
    }
    case 'stop': {
      const already = state.mode === MODE.PANIC;
      return {
        ...state,
        mode: MODE.PANIC,
        panicAt: state.panicAt || now,
        log: pushLog(state, stamp(now, 'PANIC', already
          ? 'STOP confirmed again. Local panic flag stays latched. Nothing was sent.'
          : 'STOP confirmed. Local panic flag latched. Liquidation is not wired. No order was sent.')),
      };
    }
    case 'clear-panic': {
      if (state.mode !== MODE.PANIC) return state;
      return {
        ...state,
        mode: MODE.DISARMED,
        panicAt: null,
        log: pushLog(state, stamp(now, 'ARM', 'Local panic flag cleared. No liquidation was sent. Panel is DISARMED.')),
      };
    }
    default:
      return state;
  }
}
