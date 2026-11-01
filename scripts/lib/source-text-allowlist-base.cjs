function resolveAllowlistBase(run) {
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
