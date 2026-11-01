function resolveAllowlistBase(run, env = process.env) {
  const pinned = env.SOURCE_TEXT_ALLOWLIST_BASE;
  if (pinned) return pinned;
  const head = run(["rev-parse", "HEAD"]).trim();
  const fork = run(["merge-base", "HEAD", "origin/production"]).trim();
  if (fork && fork !== head) return fork;
  try {
    return run(["rev-parse", "HEAD^"]).trim();
  } catch {
    return head;
  }
}

module.exports = { resolveAllowlistBase };
