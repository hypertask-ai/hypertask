## The source-text gate judges the branch start (HYCI-47)

The source-text regex lane in `ci-checks` compares a tree with the commit its
branch started from, `git merge-base HEAD origin/production`, never production's
moving tip. `scripts/lib/source-text-allowlist-base.cjs` resolves that ceiling, and
`SOURCE_TEXT_ALLOWLIST_BASE` still overrides it first.

Before this, a cleanup batch that deleted allowlisted test files lowered
production's allowlist while every open branch still held those files. Each such
branch then looked like it had added them, so its own required check went red for
work it never touched, and only a branch update cleared it. Judging the starting
commit removes that: an open branch stays green while cleanup batches land, and a
branch that really adds an offender still fails against its own start.

A production push is judged against the commit before it, never itself, and a tree
with no parent history resolves to itself. Coverage Nightly and the revert replay
keep their own pinned ceiling.
