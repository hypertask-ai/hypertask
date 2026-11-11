# Auto model pilot: Jev's shadow level (HTPR-9048)

Auto is our model picker: the person picks Auto and our rule chooses the model
from the feature, the thread length, a resent message and a code block. Nothing
in the app measures whether that rule picks the right effort level. This pilot
adds a second opinion without changing the answer.

Flag: `htpr-9048-jev-auto-model-shadow`, kind feature, on for Everyone.

## What a shadow turn does

On every Auto chat turn, after our rule has already picked the model for this
reply, we send the person's message to Jev (`typesafe/jev-1.14` on the gateway,
the model the other Jev pilots use) and ask one question: which effort level fits
this request, light, standard or high, with a confidence.

- The reply is already on its way with Auto's model. The guess cannot change it,
  cannot delay it and cannot fail the turn.
- One row lands in `AutoModelShadow`: the level Auto chose (`autoTier`, built from
  the feature tier plus the step-up), the model Auto picked, Jev's level, its
  confidence, its latency, the three step-up signals (`longThread`, `resent`,
  `codeFence`), the comparison (`agree`, `jev-higher`, `jev-lower`) and the raw
  error when Jev gave no usable answer.
- The message text is sent to Jev but not stored. The row keeps the level, the
  signals and the timings only.
- No call when the flag is off, when the turn is not an Auto turn, when a person
  saved their own model, or when the team funds AI with its own gateway key. The
  same rule the other Jev pilots use.
- A 900 ms deadline. Past it the row records no answer, and nothing else happens.

## Reading the log

`scripts/jev-auto-model-shadow-report.cjs` reads the table and prints the report
that decides keep or drop:

```sh
DATABASE_URL=... node scripts/jev-auto-model-shadow-report.cjs --limit=1000 --out=.evidence/auto-model-shadow
```

`--rows=<file>` reads a saved JSON array instead, which is how the scoring is
tested without a database. `--since=<iso date>` starts the window later.

Retries are the only live signal of a wrong level, because AI chat has no thumbs
down today. A turn counts as retried when the next turn in the same chat session
is the same message sent again (`resent`), which is the signal Auto itself already
steps up on. A thumbs-down signal, when chat gets one, would be a third column on
the same row.

## Keep or drop

The report prints four bars and a verdict. Jev stays only when all four pass:

1. 1000 Auto turns logged.
2. Jev answered at least 95% of them with a level.
3. Jev disagrees with Auto's level on at least 10% of them, or it is never a
   different chooser.
4. On turns the person retried, Jev wanted more effort at least 60% of the time
   and more often than less.

Until then the verdict is drop. The decision on the whole Jev pilot belongs to
HTPR-9048's sibling pilots, which compare Jev against the model it would replace.
