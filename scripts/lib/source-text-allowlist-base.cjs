function resolveAllowlistBase(run, env = process.env) {
  const pinned = env.SOURCE_TEXT_ALLOWLIST_BASE;
  const head = run(["rev-parse", "HEAD"]).trim();
  if (pinned) {
    if (pinned === head) return pinned;
    try {
      run(["merge-base", "--is-ancestor", pinned, "HEAD"]);
      return pinned;
    } catch {
      // The pin is the base tip its event fired on, which can be newer than the branch's start.
    }
  }
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
