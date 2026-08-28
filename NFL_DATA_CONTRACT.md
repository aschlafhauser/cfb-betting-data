# NFL Runtime Data Contract

Staging specification for the future `aschlafhauser/nfl-betting-data` repository.

## Design principles
- Frequently changing football data lives in the public runtime-data repo so routine refreshes do not trigger portal deploys.
- Every record should include source/freshness metadata where practical.
- Model inputs and model outputs remain distinguishable.
- Historical model snapshots are append-only/immutable after publication.
- Player and team identifiers should use stable canonical IDs/abbreviations, not display-name matching alone.

## Core files

### `data/weekly-board.json`
Top-level: `week`, `updatedAt`, `marketSource`, `games[]`.

Each game should support:
- `gameId`, `season`, `week`, `dateTime`, `away`, `home`, `neutral`
- `openingSpread`, `currentSpread`, `consensusSpread`, `modelSpread`, `spreadEdge`, `spreadLean`
- `openingTotal`, `currentTotal`, `consensusTotal`, `modelTotal`, `totalEdge`, `totalLean`
- `moneylineAway`, `moneylineHome`, `modelWinProbAway`, `modelWinProbHome`
- `priority`, `stage`, `confidence`, `uncertainty`
- `weatherStatus`, `injuryStatus`, `notes`
- `modelVersion`, `marketTimestamp`

### `data/markets.json`
Retain book-level snapshots where available rather than only one current number:
- game/book/timestamp
- spread side/price
- total/over-under prices
- moneyline
- opener/current/close flags
This supports executable-price checks and CLV.

### `data/injuries.json`
NFL-specific fields:
- `playerId`, `player`, `team`, `position`, `role`
- practice status by day (`DNP`, `LIMITED`, `FULL`)
- game designation (`OUT`, `DOUBTFUL`, `QUESTIONABLE`, none)
- expected availability / snap limitation
- `unitImpact`, `replacementQuality`, `estimatedPointRange`
- `matchupImpact`, `modelStatus` (`incorporated`, `monitor`, `context`)
- source and timestamp

### `data/game-intelligence.json`
Factual developments only. Suggested categories:
- Availability
- QB
- OL / personnel
- Suspension / transaction
- Coaching / scheme
- Weather / environment
- Travel / schedule
- Workload / role
Each item should include `impact`, `status`, `modelTreatment`, source/date, and concise betting relevance.

### `data/live-team-stats.json`
Store raw and opponent-adjusted values with sample windows where possible:
- EPA/play offense/defense
- dropback EPA offense/defense
- rush EPA offense/defense
- success rate
- early-down efficiency
- explosive-play rate
- pressure/sack rates
- red-zone and third/fourth-down metrics
- neutral pass rate / pace
- special teams
- strength of schedule
- season / last4 / last6 splits
- data-through week/date

### `data/live-player-stats.json`
Player-level performance and usage. Position-dependent fields can be nested.
QB examples: EPA/dropback, CPOE, success rate, pressure splits, sack rate, explosive pass rate, scramble contribution.
Skill examples: routes, route participation, targets, target share, air-yard share, carries, usage, explosive rate.
OL examples: snaps, starts, continuity, pressure/sack attribution where reliable.
Defense examples: snaps, pressure/pass-rush production, coverage role/usage where reliable.

### `data/player-values.json`
Model-facing player value table:
- `playerId`, `team`, `position`, `starterValue`, `replacementValue`, `dropoff`
- confidence interval/range
- reason/source inputs
- effective dates
QB values receive explicit point-scale treatment. Other positions should generally be modeled through unit and matchup effects rather than pretending every player has a precise standalone point value.

### `data/power-ratings.json`
Per-team current rating and components:
- overall point rating
- offense
- defense
- special teams
- QB
- unit/availability adjustment
- recent-form adjustment
- preseason-prior weight
- uncertainty
- version/timestamp

### `data/expert-weekly.json`
Extend the CFB concept with:
- `sourceFamily`
- `analyst`
- `evidenceTags[]` (`Scheme`, `Personnel`, `Efficiency`, `Matchup`, `Coaching`, `Situational`, `Market/Price`, `Injury/Availability`, `Betting Lean`, `Total`, `Side`, `Prop/Fantasy Context`)
- `independenceKey` to prevent correlated evidence from being overcounted
- `explicit`, `direction`, `conviction`
- `sourceAnalysis`, `bettingImplication`, `sourceUrl`, `sourceDate`

### `data/expert-source-audit.json`
For every source family:
- source/family
- access type (public/premium/user-uploaded)
- last checked
- latest content date
- teams/games covered
- evidence extracted
- coverage gaps
- source health/status

### `data/model-snapshots.json`
Append-only production predictions:
- timestamp/model version
- game + market at prediction time
- raw model line/total
- player/injury adjustment
- situational adjustment
- final fair line/total
- edge/confidence
This is the canonical basis for measuring out-of-sample performance.

### `data/results-2026.json`
Game result, closing market, ATS/total outcome, model error, and closing-line metadata.

### `data/bet-recommendations.json`
Official card only. Include executable price/time, stake, model edge at bet, rationale, close, CLV, result, units.

## Data-source priority
1. Structured play-by-play/weekly stats suitable for reproducible model inputs.
2. Official NFL availability/injury reporting and authoritative team reporting.
3. Multi-book/consensus betting markets with timestamps.
4. High-quality analytical context, tracked separately from numeric model inputs unless explicitly incorporated.

## Refresh cadence
- Markets: opening capture + multiple week-of snapshots + close.
- Team/player stats: after every game slate, with corrections if source data changes.
- Injuries: Wednesday/Thursday/Friday plus game-day inactives.
- Game Intelligence: event-driven during the week.
- Expert analysis: preseason source pass, then daily/weekly matchup coverage.
- Power ratings/model snapshots: after statistical refreshes and material availability changes.
