## The source-text gate judges the branch start (HYCI-47)

The source-text regex lane in `ci-checks` compares a tree with the commit its
branch started from, `git merge-base HEAD origin/production`, never production's
moving tip. `scripts/lib/source-text-allowlist-base.cjs` resolves that ceiling, and
`SOURCE_TEXT_ALLOWLIST_BASE` still overrides it first.

Both lanes that run the gate also pin the starting commit from the pull request's
base SHA. `ci-checks` holds full history, but `test-shard` checks out one commit
deep with no ancestry to walk, so `git merge-base` cannot answer there; the pin is
the only thing that keeps that lane judging the branch instead of the tip.

That base SHA is the tip its event fired on, which is not always the branch's
start: a branch pushed after a cleanup batch is pinned to a commit newer than its
fork point, where that cleanup already removed the files it still holds. So the
resolver keeps the pin only when it is an ancestor of the checked-out commit, and
otherwise uses `git merge-base`. Where ancestry exists the branch's real start
wins; where it does not, the pin is the only answer and is used as before.

Before this, a cleanup batch that deleted allowlisted test files lowered
production's allowlist while every open branch still held those files. Each such
branch then looked like it had added them, so its own required check went red for
work it never touched, and only a branch update cleared it. Judging the starting
commit removes that: an open branch stays green while cleanup batches land, and a
branch that really adds an offender still fails against its own start.

A production push is judged against the commit before it, never itself, and a tree
with no parent history resolves to itself. Coverage Nightly and the revert replay
keep their own pinned ceiling.
