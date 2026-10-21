
export type TSluggableAgent = {
  id: string;
  displayName: string;
  createdAt: string | Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeAgentId(value: string): boolean {
  return UUID.test(value.trim());
}

export function slugifyAgentName(displayName: string): string {
  const slug = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "agent";
}

export function assignAgentSlugs(agents: TSluggableAgent[]): Map<string, string> {
  const byAge = [...agents].sort((a, b) => {
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });

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
