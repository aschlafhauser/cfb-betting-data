# 2026 CFB Execution Policy

This is an execution/pricing layer applied only after the underlying model signal qualifies. It does not change the fair line or create a bet by itself.

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
