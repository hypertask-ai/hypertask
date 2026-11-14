# AI search test set (HTPR-9012)

This is a report-only, offline replay of production retrieval code. It is not a
live Turbopuffer benchmark or a measurement of production embedding quality.

## Dataset

The original board-15 snapshot is unchanged: 173 tickets, 150 answer queries
(2 duplicate links and 148 paraphrases), plus 3 synthetic deleted-ticket probes.
Titles and capped descriptions came from board 15 only; links and email addresses
were removed. No client boards are exported. The board had insufficient duplicate,
comment-reference and chat-citation examples, so paraphrases supplement them.
The canaries contain invented text, not exported deleted tickets.

`vectors.json` contains saved, quantized `Xenova/all-MiniLM-L6-v2` vectors, not
production OpenAI embeddings. Its fixture hash must match corpus and queries;
missing or stale vectors are errors. The harness never calls a paid model.

## Production code, fixture-backed boundaries

`scripts/rag-eval/production.cjs` transpiles and executes the current repository's
complete production modules, without extracting or rewriting their functions:

- `rag`: `retrieveBoardKnowledge`, including metadata filtering, result assembly,
  limits, and its calls to `searchTasks` and `searchComments`.
- `search`: `searchTasks` with Normal status, the underlying ticket search
  retrieval primitive. This is not the full MCP HTTP handler.
- Both execute production ticket parsing, status exclusion, exact-ticket lookup,
  exact-hit pinning, normalization and Turbopuffer query construction.

Only external boundaries are substituted: the board lookup returns board 15,
usage logging does nothing, the embedding HTTP boundary returns saved vectors,
and Turbopuffer executes plans against the snapshot. Unknown dependencies, filter
operators and ranking operators throw rather than connect to a real service.
The replay has no production credentials or database connection.

The fixture backend interprets production Sum/Product/BM25 weights and filters.
It approximates Turbopuffer BM25 (k1 1.2, b 0.75), cosine ANN and RRF (k 60).
These backend algorithms are approximations; production field weights, status
policy, candidate limits and exact-match behavior are not duplicated.

Modes:

- `keyword`: production's keyword spending route, without embeddings.
- `hybrid`: production's ANN + BM25 plan and fusion.
- `semantic`: diagnostic ablation of that same plan, executing only its ANN
  branch. Production exact-ticket lookup/pinning still applies.

Saved 384-dimensional query vectors are zero-padded at the embedding boundary
so production's 1536-dimensional response validation runs unchanged. Zero padding
does not change cosine similarity. This does not make them OpenAI embeddings.

Mutation controls change the actual production source in memory: removing RAG
status exclusions must expose a deleted canary; zeroing production task-search
weights must lose a known keyword answer. A detached copy of retrieval policy
would fail these controls.

## Pages (HTPR-9017)

`pages.json` holds real page titles and capped plain text exported from project 15
through the `hypertask pages` CLI, with links and email addresses removed. Two
invented pages with id 9001 and 9002 belong to a different project: they are
access probes, never exported client content. `page-queries.json` holds 28
natural-language questions written from the page text with different words, plus
two probes that name the outside-board pages.

`scripts/rag-eval/pages.cjs` replays the production `searchPages` entry point. The
real page service and the real page reader run with only their external
boundaries substituted: `prisma.page.findMany` filters the fixture rows through
the same access, archive and Normal-board conditions, the Turbopuffer namespace
interprets production BM25 weights and the project filter, and the flag resolves
from the fixture. Two page modes are measured:

- `literal`: today's whole-string match, reached by the production code path when
the page search flag is off. The query must appear as one substring.
- `index`: the page index branch of the new reader, with embeddings unavailable so
it measures the BM25 arm of the same request. This is lexical, not a measurement
of embedding quality.

The page section reports recall@10, reciprocal rank and how many pages outside
the board came back. No vectors are used for pages.

## Reports and limitations

```bash
node --test tests/rag-search-eval.test.cjs tests/htpr-9017-page-eval.test.cjs
node scripts/rag-eval.cjs --check-set
node scripts/rag-eval.cjs --output rag-search-report.json
```

Run these only in GitHub-hosted CI, not on the VPS. AI evals runs on every PR and
every production push. Each run publishes a step-summary table and the
`rag-search-report` artifact containing all six surface/mode measurements.
Recall@10, reciprocal rank, nDCG and deleted-hit rates are informational; no score
floor blocks changes. Invalid fixtures or broken harness behavior still fail.

The former committed score-floor baseline measured copied retrieval rules and
is removed. Use the corrected GitHub artifact and ticket's baseline instead.

There are no comment documents in this snapshot. Comment search runs against an
empty namespace, so comment relevance, comment/task competition, access control,
live index freshness, provider ranking parity and embedding-model improvements
are not measured. Those need separate fixtures or live evaluation, not a claim
that these offline numbers prove production quality.

To refresh, export board 15 through `hypertask`, retain this privacy filtering,
and regenerate vectors using an approved source. A changed dataset must receive
a new fixture hash and an explicitly identified embedding model.
