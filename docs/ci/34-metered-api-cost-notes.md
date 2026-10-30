## Metered API cost notes (YPER4-873)

The existing required `ci-tests` job checks added network calls in `src/`
with `.github/scripts/paid-api-cost-notes.mjs <base-sha> <head-sha>`.
The TypeScript AST inventory covers `fetch`, `globalThis.fetch`, Axios calls,
and the named AI SDK generation, embedding and credit-metadata calls. It is
not whole-program network discovery: aliases, other SDKs and cost estimates
still need semantic review. New or changed calls need a source-bound entry in
`.github/paid-api-cost-notes.json`: maximum estimated dollars per day, reason,
and an HTTPS pricing or measurement source. Identical moved calls are not new;
additional copies are. Parse and Git failures stop the check. No paid request
is made by this check, and no new required status is added.

New flags declaring `releaseRisk.highRisk: "money"` must explicitly default
to `OWNER_AND_QA`; Valentin approves release through the existing flag-switch path.
Existing flag definitions and live modes are unchanged. Other high-risk
classes retain their existing default rules.
