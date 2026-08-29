#!/usr/bin/env tsx

/**
 * HTPR-3836 one-off repair: re-sort every view's board_columns_view to match
 * the current Section.ranking order, so views saved before the viewHelpers
 * sync existed stop showing jumbled column order.
 *
 * Dry run by default (prints what would change). Pass --apply to write.
 *
 *   npx tsx src/scripts/repair-view-column-order.ts
 *   npx tsx src/scripts/repair-view-column-order.ts --apply
 */
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

const apply = process.argv.includes("--apply");

type Column = { id?: number; ranking?: string };

async function main() {
  const sections = await prisma.section.findMany({
    select: { id: true, ranking: true },
  });
  const rankById = new Map(sections.map((s) => [s.id, s.ranking]));

  const views = await prisma.view.findMany({
    select: {
      id: true,
      title: true,
      board_columns_view: true,
      project_view: { select: { projectId: true } },
    },
  });

  let changed = 0;
  for (const view of views) {
    const columns = (view.board_columns_view as Column[] | null) ?? [];
    if (columns.length < 2) continue;

    const rankOf = (col: Column) =>
      (col.id != null ? rankById.get(col.id) : undefined) ?? col.ranking ?? "";
    const sorted = [...columns].sort((a, b) => {
      const rankA = rankOf(a);
      const rankB = rankOf(b);
      return rankA < rankB ? -1 : rankA > rankB ? 1 : 0;
    });

    const before = columns.map((c) => c.id).join(",");
    const after = sorted.map((c) => c.id).join(",");
    if (before === after) continue;

    changed++;
    console.log(
      `project ${view.project_view.projectId} view "${view.title}" (${view.id}): [${before}] -> [${after}]`
    );
    if (apply) {
      await prisma.view.update({
        where: { id: view.id },
        data: {
          board_columns_view: sorted as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  console.log(
    `${changed} of ${views.length} views ${
      apply ? "repaired" : "need repair (dry run, re-run with --apply to write)"
    }`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
