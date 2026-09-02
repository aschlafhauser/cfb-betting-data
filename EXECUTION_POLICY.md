# 2026 CFB Execution Policy

This is an execution/pricing layer applied only after the underlying model signal qualifies. It does not change the quantitative-model weights or manufacture a fair line.

## Official Bet Activation Gate v1.1

Beginning prospectively on September 2, 2026, every evaluated betting signal must resolve to exactly one of three states:

1. **OFFICIAL BET** — the final executable edge, information-quality/confidence gates, Expert Intelligence residual review, and verified live-price requirements qualify. Assign positive units and immediately append an immutable row to `data/bet-recommendations.json` before kickoff.
2. **WATCH / PRICE TARGET** — the underlying thesis is viable but the current verified price, information state, edge tier, or threshold does not qualify. Do not add an official ledger row.
3. **PASS** — the underlying model/information gates do not qualify. Do not add an official ledger row.

`OFFICIAL BET` means the system issued a prospective betting recommendation; it does not require confirmation that the user personally placed the wager.

### Two edge measures

Track these separately whenever the underlying model can emit both without reconstruction or hindsight:

- **Independent Football Edge** — the difference between the model's football-derived price before the current-market anchor is blended back into the quantitative estimate and the verified live market.
- **Final Executable Edge** — the difference between the final fair line/total after validated quantitative market anchoring plus explicit preseason/current-game intelligence adjustments and the verified live executable market.

Never reverse-engineer or fabricate the Independent Football Edge from the final fair line. If the underlying engine does not emit a clean independent fair value, store it as unavailable and use the Final Executable Edge for production qualification.

### Prospective unit tiers

These are prospective Bet Activation Gate v1.1 rules, not a change to the underlying model weights. Track performance and CLV by tier separately.

| Final executable edge | Minimum information state | Default action | Units |
| --- | --- | --- | --- |
| **3.0+** | Medium or better, no material unresolved high-risk flag | Strong Bet | **0.75–1.0u** |
| **2.0–2.99** | Medium-high information quality or better, medium confidence or better | Bet | **0.5u** |
| **1.5–1.99** | High information quality, no material contradictory residual, and Independent Football Edge support when available | Small Bet | **0.25u** |
| **1.0–1.49** | Any | Watch / Price Target | **0u** |
| **<1.0** | Any | Pass unless a clearly documented special-strategy rule applies | **0u** |

Additional discipline:

- A target portfolio size is **not** an activation criterion. A normal full week may naturally produce roughly 4–8 positions, but never force enough bets to hit a quota.
- High information risk (unresolved starting QB, major injury/depth-chart uncertainty, material weather, suspension/coaching uncertainty) can veto any tier pending resolution.
- Expert Intelligence v1 remains a qualitative residual. Expert agreement cannot manufacture edge; materially contradictory expert evidence can reduce confidence or keep a marginal 1.5–1.99 position on WATCH.
- Correlated positions may both qualify, but record the correlation and avoid automatically increasing total exposure because two markets in the same game qualify.
- Totals and spreads use the same initial tiers prospectively, but their performance is tracked separately and may receive different validated thresholds later.
- Preserve Bet Activation Gate v1.0 history. Do not relabel prior WATCH/PASS observations as bets using v1.1 after their original timestamp.

### Required official-ledger fields

Each newly activated official wager must preserve at minimum:

- season and week
- game/matchup and scheduled kickoff
- market type and selection
- exact line and odds
- sportsbook/source and verification timestamp
- positive unit size and activation tier
- Independent Football Fair/Edge when genuinely emitted; otherwise null/unavailable
- quantitative/final fair line or total and Final Executable Edge at activation
- confidence/grade and information quality
- model snapshot/version identifier
- concise thesis/rationale
- execution choice (`main`, `key-number-alt`, or other approved production construction)
- activation timestamp and status `OFFICIAL BET`
- any same-game/portfolio correlation note

The activation record is immutable historical evidence. Later market/model changes may add observations, closing line, CLV, result, units won/lost and review fields, but must never overwrite the original activation price, model edge, timestamp, units, or thesis.

A recommendation, watchlist item, model signal, confidence grade, or 0u row is **not** an official wager. Never retroactively promote a wager after kickoff or after its result is known.

### Prospective timing / CLV chain

For every official wager preserve the chain:

`first qualifying model observation -> official activation price -> subsequent market observations -> closing price -> result`

This supports the 2026 execution-timing experiment and separates model identification, recommendation execution, CLV and game outcome.

## Underdog Special activation

Underdog Special v1.1 remains a separate strategy ledger and is not replaced by the general tiered Bet Activation Gate. For the selected upcoming week, a +3.5-to-+7 dog becomes an `OFFICIAL SPECIAL` only when it clears at least 2 of the 3 frozen football-profile advantages and a verified live sportsbook ML is better than the frozen fair-ML estimate. Spread-model edge remains confidence/context, not a hard veto. Freeze the qualifying profile flags, fair probability/fair ML, verified ML/source/timestamp, value gap, risks and confidence at activation. Do not retroactively promote Specials. Preserve v1.0 history and version all future rule changes.

## Key-number alternate spread rules

Use the current main spread and the actual offered alternate spread price. The alternate must move the selected side one full point through the specified key number.

- Through 3: target price **-134 or better**.
- Through 7: strongest validated candidate; target price **-138 or better**.
- Through 14: experimental/smaller sample; target price **-122 or better**.
- Through 10: **do not buy** under the current evidence.

These target prices preserve approximately a 3% historical ROI cushion against the stricter of the 2024 and 2025 holdout seasons. Historical alt-line menus were not available, so these are prospective price-discipline rules derived from observed spread outcomes rather than fully observed sportsbook alt-price backtests.

## Runtime game schema

Weekly-board entries should preserve `finalExecutableEdge` and, when genuinely available, `independentFootballFair` / `independentFootballEdge`. Until the underlying engine emits the latter directly, use `null` plus an explanatory note rather than reverse-engineering it.

When a game has a relevant live alternate, `data/weekly-board.json` may include:

```json
"execution": {
  "type": "key-number-alt",
  "key": 7,
  "main": "Team +6.5 -110",
  "alt": "Team +7.5 -135",
  "ceiling": "-138",
  "qualifies": true,
  "action": "ALT PRICE QUALIFIES",
  "source": "Sportsbook / timestamp",
  "note": "Model signal must independently qualify; execution layer does not create the edge."
}
```

If the alternate is worse than the ceiling, set `qualifies:false` and use an action such as `MAIN LINE PREFERRED` or `ALT TOO EXPENSIVE`. Do not fabricate an alternate price when none has been verified.
