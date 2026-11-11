# Auto model pilot: Jev's shadow level (HTPR-9048)

Auto picks the model from the feature, the thread length, a resent message and a code block. Nothing measured whether that rule picks the right effort level. This pilot adds a second opinion without changing the answer.

Flag: `htpr-9048-jev-auto-model-shadow`, kind feature, on for Everyone.

After our rule has picked the model for a reply, we send the person's message to Jev (`typesafe/jev-1.14` on the gateway, the model the other Jev pilots use) and ask which effort level fits it: light, standard or high, with a confidence. Then:

- The reply is already on its way with Auto's model. The guess cannot change it, delay it or fail the turn.
- One `AutoModelShadow` row holds Auto's level (feature tier plus the existing step-up), the model Auto picked, Jev's level, confidence and latency, the step-up signals (`longThread`, `resent`, `codeFence`), the comparison and the raw answer when Jev gave no level. The message text goes to Jev and is not stored.
- No call when the flag is off, when the person saved their own model, or when the team funds AI with its own gateway key.
- A 900 ms deadline. Past it the row records no answer and nothing else happens.

## Reading the log

```sh
DATABASE_URL=... node scripts/jev-auto-model-shadow-report.cjs --limit=1000 --out=.evidence/auto-model-shadow
```

`--rows=<file>` reads a saved JSON array instead, which is how the scoring is tested without a database. Every Auto turn adds one row, so 1,000 rows is 1,000 turns.

Retries are the only live signal of a wrong level, because AI chat has no thumbs-down control today. A turn counts as retried when the next turn in the same chat session is the same message sent again (`resent`), the signal Auto already steps up on.

## Keep or drop

Jev stays only when all four bars pass: 1,000 turns logged, a level on at least 95% of them, a disagreement on at least 10%, and on retried turns Jev wanting more effort at least 60% of the time and more often than less. Until then the verdict is drop. The whole-pilot decision belongs to the sibling Jev tickets.
