<div align="center">

<img src="docs/images/logo.png" width="96" alt="SETS MACHINE pixel computer logo">

# SETS MACHINE
### Self Evolving Trading System

A genetic algorithm breeds grid-DCA trading strategies on real BTC candles, kills everything that fails on data it has never seen, and paper-trades the survivor. Live, in your browser.

[**Run it locally →**](#run-locally) · [How it works](#how-it-works) · [Honest results](#honest-results) · [Promo video](docs/media/sets-machine-promo.mp4)

![SETS MACHINE dashboard: evolution loop, fitness history and the live gene pool](docs/images/hero.png)

**96 configs per generation · 8 genes · 4 species · 2 399 real BTCUSDT hours · No build, no npm install, no API keys**

</div>

## Watch it evolve

Every 4.8 seconds a new generation is born. Immigrants and offspring appear in the gene pool, get backtested, face the out-of-sample gate, and everything that is not an elite dies. The best config that survives the gate takes over the paper grid.

![Gene pool during one generation: births, lineage pulses and deaths](docs/images/genepool.gif)

| Evolve | Select | Trade |
| --- | --- | --- |
| Crossover and mutation over 8 genes. Species quotas stop one lucky family from wiping out the rest. | Train on 70% of the tape, then gate on the unseen 30%. Only configs that stay profitable with low drawdown survive. | The leader runs a real grid-DCA bot on the out-of-sample candles: fills, take-profit, stop, fees. |

![Evolution loop and best-of-generation fitness](docs/images/evolution.gif)

![Genome of the leader, natural selection funnel and Kelly sizing](docs/images/selection.png)

![Paper grid engine with order levels and execution log](docs/images/trading.png)

## Explore your way

- **Run / Pause**, **Step** to the next generation, and **1× 2× 4× 8×** speed.
- **Click any node** in the gene pool to inspect its genome, train and out-of-sample results. Click empty space or press **Esc** to return to the leader.
- Change the **seed** to grow a completely different evolution. Same seed, same result, every time.
- Keyboard: **Space** pause, **→** step, **1–4** speed.
- URL options: `?seed=42`, `?speed=4`, `?warm=50` (evolve 50 generations instantly on load), `?paused`.
- Works on phones: panels stack, nothing scrolls sideways.
- **LIVE ›** opens the operator panel for the capped SETS-500 silo. It is not part of the paper loop.

<p align="center"><img src="docs/images/mobile.png" width="300" alt="SETS MACHINE on a 390 px wide phone screen"></p>

Full-page screenshot: [docs/images/dashboard.png](docs/images/dashboard.png)

## LIVE operator panel

Paper evolution stays paper. [SETS LIVE](dist/live.html) (`dist/live.html`, or `live.html` at the site root, which forwards there) is the operator UI for a separate capped Coinbase silo:

| | Paper machine | LIVE panel |
| --- | --- | --- |
| What it does | Breeds grid-DCA configs and paper-trades the leader on historical BTCUSDT | Shows the SETS-500 silo: BTC-USD spot, max loss −$75, arm state, placeholders for cash / BTC / equity / frozen genome |
| Orders | Simulated fills on the bundled tape | None. The page stores no Coinbase API keys and cannot cancel, sell, or convert |
| Stop | A strategy stop inside the paper bot | A red STOP that asks “Cancel all SETS orders and liquidate SETS-owned BTC to USDC in SETS-500 only?”, then latches PANIC |

STOP writes a panic flag to `localStorage`. The screen shows **LIQUIDATE→USDC**. If a webhook URL is set in the field or with `?panicWebhook=`, the page also POSTs `{ "action": "STOP_LIQUIDATE_USDC", "portfolio": "SETS-500" }`. That ping is optional. Static Pages cannot place the Coinbase order. Trade Oversight / the operator executes the cancel, the sell, and the USDC convert in SETS-500 only.

ARM stays disabled until the dry-run acknowledgement is checked, and it stays disabled while panic is latched. DISARM does not clear panic. The only reset is **CLEAR PANIC (OPERATOR)**, which warns that clearing the flag does not undo a liquidation.

## Promo

<p align="center"><a href="docs/media/sets-machine-promo.mp4"><img src="docs/images/promo-poster.jpg" width="360" alt="SETS MACHINE promo video: click to play"></a><br><sub>25 s promo video · click to play</sub></p>

## Run locally

Requires Python 3 (to serve the files) and any modern browser.

```bash
git clone https://github.com/japolsto/SETS.git
cd SETS
python -m http.server 8000 --directory dist
```

Open **http://localhost:8000**. The operator panel is **http://localhost:8000/live.html**. That is all: no npm install, no build step, no keys, no database. Everything runs client-side in plain ES modules. The hourly BTCUSDT tape is already in `dist/data/candles.js`.

**Run the tests** (Node 18+, no dependencies):

```bash
node --test tests/*.test.mjs
```

**Refresh the market data** from Binance's public API (standard library only, no key). This replaces the bundled tape, so the published-sample test will no longer match the table below until you update that table:

```bash
python tools/fetch_data.py --hours 2400
```

**Host it for free on GitHub Pages:** Settings → Pages → *Deploy from a branch* → `main` / `(root)`. The root `index.html` forwards visitors to `dist/`.

## How it works

### The genome

Each strategy is a long-only grid-DCA bot described by 8 genes:

| Gene | Range | What it does |
| --- | --- | --- |
| `family` | 4 species | Entry logic: **Momentum** (z-score above +Z), **Mean revert** (below −Z), **Vol breakout** (close above the previous N-bar high), **Range grid** (inside a quiet band) |
| `lookback` | 10–200 h | Window for the rolling mean, deviation and breakout high |
| `entryZ` | 0.2–2.5σ | How far price must stretch before the bot enters |
| `levels` | 2–8 | Number of buy orders in the grid |
| `spacing` | 0.3–3% | Distance between grid levels |
| `mult` | 1–2× | Size multiplier per deeper level |
| `tp` | 0.3–4% | Take-profit above the average entry |
| `stop` | 1–12% | Stop below the deepest level; closes everything |

### The loop

| Stage | In the code |
| --- | --- |
| **Observe** | Read volatility of the current tape window |
| **Hypothesize** | Inject 8 random immigrants |
| **Mutate** | Tournament selection inside each species, uniform crossover, Gaussian mutation (p = 0.18) |
| **Backtest** | Every newcomer is backtested on train (70%) and out-of-sample (30%) |
| **Select** | Keep the top 4 overall plus the best of each species; everyone else dies |
| **Deploy** | Best train fitness among configs that pass the gate becomes the paper-trading leader. The Kelly panel shows the optimal bet fraction; the paper grid stakes the full paper bankroll, so the fills match the backtest that was scored |

**Fitness:** `train return − 0.6 × max drawdown`, with a penalty below 4 trades.
**Gate:** out-of-sample return > 1%, drawdown < 10%, at least 3 trades, win rate ≥ 50%.

### No peeking

- Signals are computed on the **close of bar j** and executed at the **open of bar j + 1**. A test proves that changing a future candle cannot change a past signal.
- Inside a bar, fills are processed **adverse-first**: grid fills, then stop, then take-profit.
- Every fill and exit pays a **0.04%** fee. Open positions are marked out at the end of a test window.
- The paper-trading panel replays the out-of-sample candles with the **same `GridBot` class** that the backtests use, starting on the **first out-of-sample bar**, so what you see is what was scored. The chart also prints buy & hold over that same window.

## Honest results

A sample of runs after 50 generations on the bundled data (train 2026-06-23 → 08-23, out-of-sample 08-23 → 09-22):

| Seed | Leader species | Train return / DD | Out-of-sample return / DD | OOS trades | Buy & hold (same 30 days) |
| --- | --- | --- | --- | --- | --- |
| 2026 | Range grid | +28.8% / 4.5% | **+8.4% / 5.3%** | 5 | +11.4% / 7.7% |
| 7 | Vol breakout | +28.6% / 4.3% | **+8.3% / 7.7%** | 4 | +11.4% / 7.7% |
| 42 | Mean revert | +30.8% / 2.9% | **+7.3% / 3.9%** | 54 | +11.4% / 7.7% |

Read this before getting excited:

- On this window **buy & hold made more money**. The evolved grids made less, with a smaller drawdown in two of three runs.
- The out-of-sample window is 30 days with a handful of trades. That is a sanity check, not proof of an edge.
- Picking the leader from configs that passed the gate reuses the out-of-sample data, so its numbers are optimistic.
- High win rates come from wide stops that were never hit in this window. That is exactly the risk a grid carries.

SETS MACHINE is a transparent research toy for watching evolutionary search work. It is **not** a trading bot to connect to real money. The [LIVE operator panel](#live-operator-panel) is a switch for a separate capped silo. It still has no API keys and cannot send orders.

## Under the hood

```text
index.html            Redirects to dist/ (for GitHub Pages)
live.html             Redirects to dist/live.html
dist/
  index.html          Paper dashboard shell and controls. Links to LIVE
  live.html           SETS-500 operator panel: arm state, kill bar, red STOP
  live.js             Panic flag, confirm flow, optional webhook POST
  live.css            LIVE layout. The red STOP stays on screen
  live/state.js       Arm / panic state machine, no DOM and no credentials
  app.js              Controller: generation timeline, paper trading, UI state
  style.css           Responsive blue-and-white interface
  engine/
    series.js         Causal rolling mean / deviation / breakout high
    bot.js            GridBot: signals, grid fills, TP, stop, fees, metrics
    evolution.js      Genome, crossover, mutation, species quotas, gate
    rng.js            Seeded randomness
  ui/draw.js          Canvas painters: logo, ring, fitness, gene pool, Kelly, chart
  data/candles.js     2 399 hourly BTCUSDT candles from Binance
  assets/             Fonts, logo, favicon
tools/fetch_data.py   Refreshes dist/data/candles.js from Binance's public API
tests/                Node test runner: data, indicators, bot mechanics, GA, LIVE state
docs/                 README images, GIFs and the promo video
```

Built with plain HTML, CSS and JavaScript modules on `<canvas>`. No frameworks. The paper dashboard makes no external requests. SETS LIVE requests nothing until an operator confirms STOP with a webhook URL filled in.

## Credits & licence

- Market data: [Binance public market data API](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints), BTCUSDT 1h klines.
- Fonts: [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) and [Space Grotesk](https://github.com/floriankarsten/space-grotesk), both under the SIL Open Font License 1.1.
- Kelly criterion: J. L. Kelly Jr., *A New Interpretation of Information Rate* (1956).

Code is MIT licensed, see [LICENSE](LICENSE). Test results are in [VALIDATION.md](VALIDATION.md).

> **Not financial advice.** Paper trading on historical data only. SETS LIVE does not connect to Coinbase, holds no keys, and places no orders. Past performance, simulated or not, does not predict future results.
