# 2026 CFB Execution Policy

This is an execution/pricing layer applied only after the underlying model signal qualifies. It does not change the fair line or create a bet by itself.

## Official Bet Activation Gate

Beginning with Week 1, every evaluated betting signal must resolve prospectively to exactly one of three states:

1. **OFFICIAL BET** — the established quantitative model, information-quality gate, Expert Intelligence residual review, and live-price/execution requirements all qualify. Assign positive units and immediately append an immutable row to `data/bet-recommendations.json` before kickoff.
2. **WATCH / PRICE TARGET** — the underlying thesis is viable but the current verified price, information state, or threshold does not qualify. Do not add an official ledger row.
3. **PASS** — the underlying model/information gates do not qualify. Do not add an official ledger row.

`OFFICIAL BET` means the system issued a prospective betting recommendation; it does not require confirmation that the user personally placed the wager.

### Required official-ledger fields

Each newly activated official wager must preserve at minimum:

- season and week
- game/matchup and scheduled kickoff
- market type and selection
- exact line and odds
- sportsbook/source and verification timestamp
- positive unit size
- quantitative fair line/total and edge at activation
- confidence/grade and information quality
- model snapshot/version identifier
- concise thesis/rationale
- execution choice (`main`, `key-number-alt`, or other approved production construction)
- activation timestamp and status `OFFICIAL BET`

The activation record is immutable historical evidence. Later market/model changes may add observations, closing line, CLV, result, units won/lost and review fields, but must never overwrite the original activation price, model edge, timestamp, units, or thesis.

A recommendation, watchlist item, model signal, confidence grade, or 0u row is **not** an official wager. Never retroactively promote a wager after kickoff or after its result is known.

### Prospective timing / CLV chain

For every official wager preserve the chain:

`first qualifying model observation -> official activation price -> subsequent market observations -> closing price -> result`

This supports the 2026 execution-timing experiment and separates model identification, recommendation execution, CLV and game outcome.

## Underdog Special activation

Underdog Special v1.1 remains a separate strategy ledger but follows the same prospective persistence principle. For the selected upcoming week, a +3.5-to-+7 dog becomes an `OFFICIAL SPECIAL` only when it clears at least 2 of the 3 frozen football-profile advantages and a verified live sportsbook ML is better than the frozen fair-ML estimate. Spread-model edge remains confidence/context, not a hard veto. Freeze the qualifying profile flags, fair probability/fair ML, verified ML/source/timestamp, value gap, risks and confidence at activation. Do not retroactively promote Specials. Preserve v1.0 history and version all future rule changes.

## Key-number alternate spread rules

Use the current main spread and the actual offered alternate spread price. The alternate must move the selected side one full point through the specified key number.

- Through 3: target price **-134 or better**.
- Through 7: strongest validated candidate; target price **-138 or better**.
- Through 14: experimental/smaller sample; target price **-122 or better**.
- Through 10: **do not buy** under the current evidence.

These target prices preserve approximately a 3% historical ROI cushion against the stricter of the 2024 and 2025 holdout seasons. Historical alt-line menus were not available, so these are prospective price-discipline rules derived from observed spread outcomes rather than fully observed sportsbook alt-price backtests.

## Runtime game schema

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
