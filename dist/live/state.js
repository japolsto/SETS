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
export const THRESHOLD_COPY = 'Loss intervention threshold -$75; losses may exceed this.';
export const RESET_LABEL = 'LOCAL DEMO RESET';
export const RESET_DISCLAIMER = 'There is no claim that orders or exposure are resolved.';
export const UNKNOWN = 'UNKNOWN';
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
  cash: UNKNOWN,
  btc: UNKNOWN,
  equity: UNKNOWN,
  pnl: UNKNOWN,
  genome: UNKNOWN,
  genomeNote: 'UNAVAILABLE',
  orders: UNKNOWN,
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
  const panicAt = storage.getItem(KEYS.panicAt) || null;
  // A stored arm flag is never shown. Reload starts DISARMED unless a local panic flag is set.
  const mode = panic ? MODE.PANIC : MODE.DISARMED;
  return {
    mode,
    dryRunAck,
    panicAt: mode === MODE.PANIC ? panicAt : null,
  };
}

export function writeStore(storage, state) {
  scrubDestination(storage);
  storage.removeItem(KEYS.arm);
  storage.setItem(KEYS.panic, state.mode === MODE.PANIC ? '1' : '0');
  if (state.mode === MODE.PANIC && state.panicAt) storage.setItem(KEYS.panicAt, String(state.panicAt));
  else storage.removeItem(KEYS.panicAt);
  storage.setItem(KEYS.dryRunAck, state.dryRunAck ? '1' : '0');
}

// `search` is accepted and ignored. A query string must not choose a destination.
export function loadState(storage, _search, now) {
  scrubDestination(storage);
  const saved = readStore(storage);
  const log = [stamp(now, 'SYS', 'Demonstration idle. Not connected. Cash, BTC, equity, genome, orders, and P&L are UNKNOWN. STOP only latches a local flag. A stored arm is not restored.')];
  if (saved.mode === MODE.PANIC) {
    log.push(stamp(now, 'PANIC', 'Local panic flag restored from this browser. Liquidation is not wired. Arm state was not restored.'));
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
        log: pushLog(state, stamp(now, 'ARM', 'Local demo reset. There is no claim that orders or exposure are resolved. Panel is DISARMED.')),
      };
    }
    default:
      return state;
  }
}
