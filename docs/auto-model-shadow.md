# Auto model pilot: Jev's shadow level (HTPR-9048)

Auto picks the model from the feature, the thread length, a resent message and a code block. Nothing measured whether that rule picks the right effort level, so this pilot adds a second opinion without changing the answer. Flag: `htpr-9048-jev-auto-model-shadow`, kind feature, on for Everyone.

After our rule has picked the model, we send the same message to Jev (`typesafe/jev-1.14` on the gateway) and ask which effort level fits it, light, standard or high, with a confidence. The reply already uses Auto's model, so the guess cannot change it, delay it or fail the turn. One `AutoModelShadow` row holds Auto's level, the model Auto picked, Jev's level, confidence and latency, the step-up signals (`longThread`, `resent`, `codeFence`), the comparison and the raw answer when Jev gave none. The message text goes to Jev and is not stored. No call when the flag is off, when the person saved their own model, or when the team funds AI with its own gateway key. A 900 ms deadline leaves the row with no answer and nothing else happens.

## Reading the log

```sh
psql "$DATABASE_URL" -c "\\copy (SELECT \"createdAt\", \"chatSessionId\", \"autoTier\", \"jevLevel\", \"jevTier\", \"jevConfidence\", \"jevLatencyMs\", \"resent\", \"error\" FROM \"AutoModelShadow\" ORDER BY \"createdAt\") TO 'rows.csv' WITH CSV HEADER"
node scripts/jev-auto-model-shadow-report.cjs --rows=rows.json --out=.evidence/auto-model-shadow
```

A turn counts as retried when the next turn in the same chat session is the same message sent again (`resent`), the signal Auto already steps up on. AI chat has no thumbs-down control today; that gap is named rather than invented.

## Keep or drop

Jev stays only when all four bars pass: 1,000 turns logged, a level on 95% of them, a disagreement on at least 10%, and on retried turns Jev wanting more effort at least 60% of the time and more often than less. Until then the verdict is drop.
