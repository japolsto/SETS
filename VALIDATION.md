# Verification

## Automated tests

`node --test tests/*.test.mjs` passes all 23 tests (Node 22+):

- **Bundled data:** 2 399 candles, all exactly one hour apart, every row satisfies low ≤ open/close ≤ high.
- **Indicators:** rolling mean and breakout high are causal. A spike at bar 30 is invisible at bar 29, and the breakout high excludes the current bar.
- **Grid mechanics:** L1–L3 fill in order; the take-profit fills at exactly `avg × (1 + tp)` with fees applied; cash ends between the start and +2%.
- **Stop loss:** closes the whole position at `deepest level × (1 − stop)` and records one losing trade.
- **No look-ahead:** changing candle 501 does not change the signal computed at candle 500.
- **Genome bounds:** 500 heavy mutations never leave a gene's range; integer genes stay integers.
- **Determinism:** two runs with the same seed produce identical histories. All four species survive 12 generations, and best fitness never decreases.
- **Reproducibility:** re-running the leader's backtest gives exactly the stored out-of-sample metrics.
- **Gate:** out-of-sample return must be above 1%, drawdown under 10%, at least 3 trades, win rate at least 50%. A loss, a 10% drawdown, 2 trades, or a 49.9% win rate fails.
- **Generation shape:** 8 genes, 4 species, 96 configs, 8 immigrants. Generation 0 has not killed anyone. The deployed leader passes the gate.
- **Published sample:** after 50 generations, seeds 2026, 7 and 42 match the README table, and buy & hold on that window is +11.4% / 7.7% drawdown.
- **LIVE operator state:** strategy ARM is impossible. The published `dist/status.json` is schema `sets-live-status/v1` for SETS-500 only: cash 495.33, BTC 0, equity 495.33, BTC-USD mid 84454.17, P&L absent so no marker. A feed that says ARMED still parses as DISARMED. `?panicWebhook=` and `?panic=` cannot change the saved webhook. STOP does not post without a saved https webhook and sender key. With both saved, STOP posts `action`, SETS-500, portfolio id `04309540-7942-460f-8509-151565372f5b`, `ts`, and `key`, plus `Authorization: Bearer` and `X-Webhook-Key`. The default portfolio id is refused. A failed post is not marked sent. After a successful post the latch says to await Trade Oversight confirmation, and acknowledging it does not claim exposure is resolved. The page contains no Coinbase credentials.

## Browser checks

- Served with `python -m http.server --directory dist`. All modules, data, fonts and icons return 200. The root `index.html` forwards to `dist/` for GitHub Pages.
- Desktop, 1280 × 900: all panels render. Evolution, paper trading, inspect-on-click (node g12 → "GENOME · INSPECTING"), pause, step and speed were exercised. No console errors.
- Phone, 390 × 844: panels stack and `scrollWidth` equals the viewport (390 px), so nothing scrolls sideways.
- The README screenshots and GIFs were captured from the running app (seed 2026, 40 generations warmed up) with headless Chrome. No page errors were reported during capture.
- SETS LIVE, desktop 1280 × 900: with no webhook saved the banner reads NOT CONNECTED, STOP is disabled, balances read UNKNOWN, and ARM stays disabled. After a webhook and sender key are saved in the page, the banner reads LIVE · STOP WIRED · STRATEGY DISARMED. Confirming STOP against a stubbed response shows “STOP sent — await Trade Oversight confirmation” and does not enable ARM. The paper dashboard still renders and its LIVE link returns to the panel.
- SETS LIVE, 390 × 844: `scrollWidth` equals the viewport (390 px) and the red STOP stays inside the viewport.

## Performance

One generation (88 new configs, each backtested on train and out-of-sample) takes about 10 ms in Node. Fifty generations take about 0.5 s.

## What is not claimed

- The results table in the README comes from one 30-day out-of-sample window. It is not evidence of a durable edge, and on that window buy & hold returned more.
- The paper dashboard has no exchange connectivity. SETS LIVE was not tested against Coinbase. Browser checks do not establish Coinbase isolation. The panel posts STOP only to a webhook saved in the browser, and it cannot arm a strategy.
- Multitouch gestures on physical devices were not tested.
