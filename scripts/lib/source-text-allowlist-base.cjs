function isAncestor(run, commit, descendant) {
  try {
    run(["merge-base", "--is-ancestor", commit, descendant]);
    return true;
  } catch {
    return false;
  }
}

function resolveAllowlistBase(run, env = process.env) {
  const pinned = env.SOURCE_TEXT_ALLOWLIST_BASE;
  const head = run(["rev-parse", "HEAD"]).trim();
  if (pinned && (pinned === head || isAncestor(run, pinned, head))) return pinned;
  let fork = "";
  let forkError = null;
  try {
    fork = run(["merge-base", "HEAD", "origin/production"]).trim();
  } catch (error) {
    forkError = error;
  }
  if (fork && fork !== head) return fork;
  if (pinned) return pinned;
  if (forkError) throw forkError;
  try {
    return run(["rev-parse", "HEAD^"]).trim();
  } catch {
    return head;
  }
}

module.exports = { resolveAllowlistBase };
