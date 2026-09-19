export type CurrentTaskCount = {
  key: string;
  label: string;
  value: number;
};

export type CurrentTaskReport = {
  total: number;
  sections: CurrentTaskCount[];
  assignees: CurrentTaskCount[];
  generatedAt: string;
};

type Section = {
  id: number;
  title: string;
  ranking: string;
};

type SectionCount = {
  sectionId: number | null;
  section: string;
  count: number;
};

type AssigneeCount = {
  key: string;
  label: string;
  count: number;
};

export function buildCurrentTaskReport({
  total,
  sections,
  sectionCounts,
  assigneeCounts,
  unassignedCount,
  generatedAt,
}: {
  total: number;
  sections: Section[];
  sectionCounts: SectionCount[];
  assigneeCounts: AssigneeCount[];
  unassignedCount: number;
  generatedAt: Date;
}): CurrentTaskReport {
  const sectionGroups = new Map<string, CurrentTaskCount>();
  const sectionIds = new Set(sections.map(({ id }) => id));

  for (const section of [...sections].sort((a, b) =>
    a.ranking.localeCompare(b.ranking)
  )) {
    sectionGroups.set(`section:${section.id}`, {
      key: `section:${section.id}`,
      label: section.title,
      value: 0,
    });
  }

  for (const row of sectionCounts) {
    const key =
      row.sectionId !== null && sectionIds.has(row.sectionId)
        ? `section:${row.sectionId}`
        : `legacy:${row.section}`;
    const current = sectionGroups.get(key);
    if (current) {
      current.value += row.count;
    } else {
      sectionGroups.set(key, {
        key,
        label: row.section || "Unknown section",
        value: row.count,
      });
    }
  }

  const assignees = assigneeCounts.map(({ key, label, count }) => ({
    key,
    label,
    value: count,
  }));
  if (unassignedCount > 0) {
    assignees.push({
      key: "unassigned",
      label: "Unassigned",
      value: unassignedCount,
    });
  }
  assignees.sort(
    (a, b) => b.value - a.value || a.label.localeCompare(b.label)
  );

  return {
    total,
    sections: [...sectionGroups.values()],
    assignees,
    generatedAt: generatedAt.toISOString(),
  };
}
