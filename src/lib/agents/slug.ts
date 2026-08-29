/**
 * Readable agent URLs: /agents/board-maintainer, not /agents/be6887e6-6c12-…
 *
 * No slug column. An owner's agent list is small and already fetched, so the
 * slug is derived from the display name and collisions are settled by age —
 * which keeps an existing agent's URL stable when a new one takes its name.
 * Ids keep working everywhere, so old links and API callers are unaffected.
 */

export type TSluggableAgent = {
  id: string;
  displayName: string;
  createdAt: string | Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeAgentId(value: string): boolean {
  return UUID.test(value.trim());
}

/** "Board Maintainer" -> "board-maintainer". Empty names fall back to "agent". */
export function slugifyAgentName(displayName: string): string {
  const slug = displayName
    .normalize("NFKD")
    // Accents out, so "Café" and "Cafe" do not produce two different URLs.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  // A name that is entirely emoji or punctuation still needs a URL.
  return slug || "agent";
}

/**
 * One slug per agent, unique within the owner's set. The oldest agent with a
 * name keeps the bare slug; later ones get -2, -3, so renaming or adding an
 * agent never silently steals an existing URL.
 */
export function assignAgentSlugs(agents: TSluggableAgent[]): Map<string, string> {
  const byAge = [...agents].sort((a, b) => {
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    if (at !== bt) return at - bt;
    // Same timestamp: id keeps the order stable rather than leaving it to the
    // sort's input order, which the two routes need not agree on.
    return a.id.localeCompare(b.id);
  });

  // Taken slugs, not per-base counts: an agent literally named "QA Agent 2"
  // owns "qa-agent-2", so the second "QA Agent" has to skip past it rather
  // than land on the same URL and make both cards point at one agent.
  const taken = new Set<string>();
  const slugs = new Map<string, string>();
  for (const agent of byAge) {
    const base = slugifyAgentName(agent.displayName);
    let candidate = base;
    let n = 2;
    while (taken.has(candidate)) candidate = `${base}-${n++}`;
    taken.add(candidate);
    slugs.set(agent.id, candidate);
  }
  return slugs;
}

/**
 * The id behind whatever is in the URL. Accepts an id or a slug, and returns
 * null when neither matches, so callers keep their own 404.
 */
export function resolveAgentRef(
  agents: TSluggableAgent[],
  ref: string,
): string | null {
  const wanted = ref.trim();
  if (!wanted) return null;
  const byId = agents.find((agent) => agent.id === wanted);
  if (byId) return byId.id;

  const slugs = assignAgentSlugs(agents);
  const lowered = wanted.toLowerCase();
  for (const [id, slug] of slugs) {
    if (slug === lowered) return id;
  }
  return null;
}
