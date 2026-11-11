# Brain tag eval (Jev against Haiku)

HTPR-9044 is the first Jev pilot. Jev is TypeSafe's decision model on OpenRouter
(`typesafe/jev-1.14`): it answers a fixed set of questions about one piece of text
and returns a choice with a confidence, in a few hundred milliseconds, with no
output tokens to pay for. The brain tag is a four-level decision
(`brain-light`, `brain-medium`, `brain-hard`, `brain-extra-hard`), so it is the
cheapest honest test of whether Jev can replace a prompt model for one decision.

## What the eval measures

`scripts/brain-tag-eval.cjs` sends the same ticket to both models:

- **Haiku** (`claude-haiku-5-5`, adaptive thinking, effort medium, the Task Writer
  default) gets the four level definitions as prose and answers with one word.
- **Jev** gets the same four definitions as a `choice` question's criteria, and
  answers with a label and a confidence.

It scores exact match, macro exact over the four classes, within-one-level,
exact match on the confident subset (confidence 0.7 or higher, the threshold the
live step would use), latency p50 and p90, cost, and errors. It also scores
**always brain-medium**, which is what the product does today when it has no
brain rule at all, and a paired comparison (how many tickets each model got
right that the other missed, with a bootstrap interval and an exact test).

The corpus is 200 board 15 tickets that already carry a brain label, set before
2026-11-10 so no label could have come from the Task Writer itself. It is
stratified: 57 light, 105 medium, 36 hard, 2 extra-hard. Client names are
redacted and each note is cut to 1000 characters.

## How to run it

The eval needs two keys and makes about 400 model calls (under one cent of Jev):

```sh
OPENROUTER_EVAL_KEY=<capped eval key> ANTHROPIC_API_KEY=<key> \
  node scripts/brain-tag-eval.cjs --out=.evidence/brain-tag-eval
```

`--limit=5` runs the plumbing in seconds. `--replay=<scores.json>` rebuilds the
report from a saved run without calling a model. The output is `scores.json`
(every row, every probability) and `report.md`.

Refresh the corpus only when the board moves:

```sh
node scripts/brain-tag-eval-corpus.cjs
```

## The bar

Valentin's bar: keep Jev only if it wins by 5 points or more of exact match, and
drafts never get slower. The running is done when the report either keeps Jev
for the shadow run or drops it, and the scores are on the ticket.

## Result of the first run, 2026-11-10

Three runs over 200 cases each, 600 comparisons. Jev was right 373 times, Haiku
353, the always-medium default 315. The gap was +4.0, +3.0 and +3.0 points, mean
+3.3, and every interval crossed zero, so Jev is not clearly better at the label
and the brain tag stays with Haiku.

What Jev is clearly better at: speed (314 ms p50 against 1180 ms), cost
($0.0152 for 600 calls) and its own confidence. It was right on 77% of the 294
tickets it answered with confidence 0.7 or higher, which is where a
confidence-gated design would look strong. It also nearly doubles the hit rate on
`brain-light` (26% against 15%), the class the default gets wrong most.

Full report, confusion tables and every row: HTPR-9044.

## Jev Router against Grok (HYCI-246)

`scripts/brain-tag-grok-eval.cjs` runs the same four level definitions through
two OpenRouter chat models on a 40 ticket stratified sample of the frozen corpus:
`typesafe/jev-router` and `x-ai/grok-4.7`. Both get the identical system prompt,
the identical ticket text and a one word answer, so the only difference is the
model. It scores exact match, macro exact, within one level, latency p50 and p90,
real cost per tag from the reported usage, and a paired bootstrap against the
always-medium default. `--budget-usd` stops the run before it can overspend, and
the default is 2 dollars.

```sh
OPENROUTER_EVAL_KEY=<capped key> node scripts/brain-tag-grok-eval.cjs --cases=40 --out=.evidence/brain-tag-grok
```

Two runs on 2026-11-11, 40 tickets each, $0.31 of credit for every run including
the smoke tests. Grok was right on 63% of tickets, Jev Router on 55%, the
always-medium default on 53%. Jev answered every ticket in 2.2 s p50 against
Grok's 6.0 s, and cost $0.0001 per tag against Grok's $0.0043, about 43 times
cheaper. The gap of -7.5 points with a 95% interval of -17.5 to 0 does not clear
the 5 point bar, so the brain tag stays on Grok. At the volume we tag, the saving
is a few cents a month.
