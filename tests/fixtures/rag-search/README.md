# AI search test set (HTPR-9012)

`scripts/rag-eval.cjs` scores Hypertask AI search against this set and prints
recall@10, MRR@10, nDCG@10, how often a deleted ticket comes back, and how often
the deleted canary leaks. It measures only. Nothing here changes the product.

## What is in the set

- `corpus.json` — every ticket on board 15 (Hypertask Product), captured from
  `hypertask task list --project 15`: ticket number, title, status and the
  description as plain text, with links and email addresses removed and capped
  at 1,200 characters because this repository is public. Board 15 only, so no
  client text.
- `queries.json` — 153 query and answer pairs.
  - 2 duplicate pairs, taken from the board's own duplicate tickets: HTPR-8996
    against HTPR-8945, and HTPR-7844 against HTPR-8027.
  - 148 paraphrase pairs written from a ticket's title and body. The query is
    how a person would describe the problem, the answer is that ticket.
  - 3 deleted canary probes (below).
- `canaries` inside `corpus.json` — three synthetic rows marked `Deleted`
  (`CANARY-1` to `CANARY-3`). Real soft-deleted rows cannot be exported, so
  these probe whether a deleted row is ever returned. They contain no board or
  client content.
- `baseline.json` — the numbers recorded on the ticket. Scoring fails when a
  number falls below its floor.

Board 15 has no ticket whose comments cite a chat answer, and only two live
duplicate pairs, so those two sources are smaller than the ticket assumed. The
paraphrase pairs carry the set.

## How each mode mirrors production

The three modes are the three ways the app can retrieve past tickets:

- `keyword` — BM25 with the same field weights production uses in
  `buildTaskBm25RankBy` (`src/utils/controllers/turbopuffer/turbopufferHelper.ts`):
  title x4, ticket number x2, search text x1, k1 1.2, b 0.75, prefix match on
  the last query token.
- `semantic` — cosine over `text-embedding-3-small` vectors of the same search
  text production embeds, truncated at 4,000 characters.
- `hybrid` — reciprocal rank fusion (k 60, top 50 each) of the two lists above,
  the same shape as `rerank_by: ["RRF"]` in production.

`search` filters to status Normal, which is what `hypertask_search_tasks` does.
`rag` passes no status filter, which is what `rag_retrieval` does today, so the
deleted leak numbers show the real gap until HTPR-9014 lands.

## Run it

```bash
RAG_EVAL_EMBED_KEY=<openai key> node scripts/rag-eval.cjs            # table
RAG_EVAL_EMBED_KEY=<openai key> node scripts/rag-eval.cjs --json     # full numbers
RAG_EVAL_EMBED_KEY=<openai key> node scripts/rag-eval.cjs --write-baseline
node scripts/rag-eval.cjs --check-set                                # fixtures only, no key
```

CI runs the harness tests and `--check-baseline` on every change that touches
search, the RAG code, or this folder.

## Refresh the corpus

```bash
node scripts/rag-eval.cjs --capture
```

That re-reads board 15 and rewrites `corpus.json`, keeping the canaries. Re-run
`--write-baseline` afterwards so the floors follow the new corpus.
