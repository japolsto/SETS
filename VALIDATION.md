# Verification

## Automated tests

`node --test tests/*.test.mjs` passes all 11 tests (Node 22+):

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

## Browser checks

- Served with `python -m http.server --directory dist`. All modules, data, fonts and icons return 200. The root `index.html` forwards to `dist/` for GitHub Pages.
- Desktop, 1280 × 900: all panels render. Evolution, paper trading, inspect-on-click (node g12 → "GENOME · INSPECTING"), pause, step and speed were exercised. No console errors.
- Phone, 390 × 844: panels stack and `scrollWidth` equals the viewport (390 px), so nothing scrolls sideways.
- The README screenshots and GIFs were captured from the running app (seed 2026, 40 generations warmed up) with headless Chrome. No page errors were reported during capture.

## Performance

One generation (88 new configs, each backtested on train and out-of-sample) takes about 10 ms in Node. Fifty generations take about 0.5 s.

## What is not claimed

- The results table in the README comes from one 30-day out-of-sample window. It is not evidence of a durable edge, and on that window buy & hold returned more.
- No live exchange connectivity exists or was tested. The app is paper trading on historical candles.
- Multitouch gestures on physical devices were not tested.
