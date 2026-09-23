import assert from "node:assert/strict";

// HTPR-6509: the AI chat task-tree tool now loads the ancestor chain in one
// recursive query and the subtree one level at a time. These tests pin the
// output the per-node version produced: tree shape, sibling order, pruning of
// deleted and inaccessible subtrees, depth limits, and the ancestor-walk
// errors, plus the query budget that motivated the change.

type Row = {
  id: number;
  parentTaskId: number | null;
  title: string;
  ticketNumber: string | null;
  uniqueIndex: number;
  status: "Normal" | "Archive" | "Deleted";
  accessible: boolean;
};

const USER_ID = 6;

function row(
  id: number,
  parentTaskId: number | null,
  uniqueIndex: number,
  extra: Partial<Row> = {}
): Row {
  return {
    id,
    parentTaskId,
    title: `Task ${id}`,
    ticketNumber: `HTPR-${uniqueIndex}`,
    uniqueIndex,
    status: "Normal",
    accessible: true,
    ...extra,
  };
}

function pick(task: Row, select: Record<string, boolean>) {
  return Object.fromEntries(
    Object.keys(select)
      .filter((key) => select[key])
      .map((key) => [key, task[key as keyof Row]])
  );
}

// Applies only the filters a call actually passes, so a dropped status, access
// or ordering clause changes the result and fails the assertions below.
function fakeDb(rows: Row[], expectedProjectWhere: unknown) {
  const calls = { findFirst: 0, findMany: 0, queryRaw: 0 };

  const matches = (task: Row, where: any) => {
    if (where.project !== undefined) {
      assert.deepEqual(where.project, expectedProjectWhere);
      if (!task.accessible) return false;
    }
    if (typeof where.id === "number" && task.id !== where.id) return false;
    if (where.id?.in && !where.id.in.includes(task.id)) return false;
    if (typeof where.parentTaskId === "number" && task.parentTaskId !== where.parentTaskId) {
      return false;
    }
    if (where.parentTaskId?.in && !where.parentTaskId.in.includes(task.parentTaskId)) {
      return false;
    }
    if (where.status?.not && task.status === where.status.not) return false;
    return true;
  };

  const db = {
    calls,
    task: {
      async findFirst({ where, select }: any) {
        calls.findFirst++;
        const task = rows.find((candidate) => matches(candidate, where));
        return task ? pick(task, select) : null;
      },
      async findMany({ where, select, orderBy }: any) {
        calls.findMany++;
        let result = rows.filter((candidate) => matches(candidate, where));
        if (orderBy?.uniqueIndex === "asc") {
          result = [...result].sort((a, b) => a.uniqueIndex - b.uniqueIndex);
        }
        return result.map((task) => pick(task, select));
      },
    },
    // Mirrors the recursive CTE: walk up from the anchor, at most 256 rows,
    // stop at a missing parent or before revisiting a task. The SQL itself was
    // checked against PostgreSQL 16 for the same cases.
    async $queryRaw(sql: { values: unknown[] }) {
      calls.queryRaw++;
      const [anchorId, maxHops] = sql.values as [number, number];
      const byId = new Map(rows.map((task) => [task.id, task]));
      const chain: { id: number; parentTaskId: number | null }[] = [];
      const seen = new Set<number>();
      let current = byId.get(anchorId);
      while (current && chain.length < maxHops && !seen.has(current.id)) {
        seen.add(current.id);
        chain.push({ id: current.id, parentTaskId: current.parentTaskId });
        current =
          current.parentTaskId == null ? undefined : byId.get(current.parentTaskId);
      }
      return chain;
    },
  };
  return db;
}

function chainRows(length: number) {
  // id 1 is the root, id `length` is the deepest task.
  return Array.from({ length }, (_, index) =>
    row(index + 1, index === 0 ? null : index, index + 1)
  );
}

async function main() {
  process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";

  const [{ buildTaskTree, findRootTaskIdForTree, MAX_TREE_ANCESTOR_HOPS }, { getProjectWhere }] =
    await Promise.all([
      import("@/lib/aiChat/taskTree"),
      import("@/utils/controllers/projects/getAllIncludes"),
    ]);
  const projectWhere = getProjectWhere(USER_ID);

  // Tree: root 1 -> [2, 3] (seeded out of order, children of 2 and 3
  // interleaved in one level), plus a deleted and an inaccessible child whose
  // own subtrees must disappear with them.
  const treeRows: Row[] = [
    row(3, 1, 30),
    row(1, null, 10),
    row(31, 3, 305),
    row(21, 2, 202),
    row(2, 1, 20),
    row(32, 3, 301),
    row(22, 2, 201),
    row(4, 1, 15, { status: "Deleted" }),
    row(41, 4, 401),
    row(5, 1, 16, { accessible: false }),
    row(51, 5, 501),
    row(6, 1, 25, { status: "Archive", ticketNumber: null }),
    row(211, 21, 2101),
  ];

  {
    const db = fakeDb(treeRows, projectWhere);
    const tree = await buildTaskTree(1, USER_ID, undefined, db as any);
    assert.deepEqual(tree, {
      id: 1,
      task_id: 1,
      title: "Task 1",
      ticketNumber: "HTPR-10",
      uniqueIndex: 10,
      children: [
        {
          id: 2,
          task_id: 2,
          title: "Task 2",
          ticketNumber: "HTPR-20",
          uniqueIndex: 20,
          children: [
            { id: 22, task_id: 22, title: "Task 22", ticketNumber: "HTPR-201", uniqueIndex: 201, children: [] },
            {
              id: 21,
              task_id: 21,
              title: "Task 21",
              ticketNumber: "HTPR-202",
              uniqueIndex: 202,
              children: [
                { id: 211, task_id: 211, title: "Task 211", ticketNumber: "HTPR-2101", uniqueIndex: 2101, children: [] },
              ],
            },
          ],
        },
        // Archived children stay in the tree, as before. No ticket number, no key.
        { id: 6, task_id: 6, title: "Task 6", uniqueIndex: 25, children: [] },
        {
          id: 3,
          task_id: 3,
          title: "Task 3",
          ticketNumber: "HTPR-30",
          uniqueIndex: 30,
          children: [
            { id: 32, task_id: 32, title: "Task 32", ticketNumber: "HTPR-301", uniqueIndex: 301, children: [] },
            { id: 31, task_id: 31, title: "Task 31", ticketNumber: "HTPR-305", uniqueIndex: 305, children: [] },
          ],
        },
      ],
    });
    // Key order is part of the JSON the model sees.
    assert.deepEqual(Object.keys(tree), ["id", "task_id", "title", "ticketNumber", "uniqueIndex", "children"]);
    // Root lookup plus one query per level, including the final empty level.
    assert.deepEqual(db.calls, { findFirst: 1, findMany: 4, queryRaw: 0 });
  }

  {
    const db = fakeDb(treeRows, projectWhere);
    const tree = await buildTaskTree(1, USER_ID, 0, db as any);
    assert.equal("children" in tree, false, "depth 0 returns the root without a children key");
    assert.deepEqual(db.calls, { findFirst: 1, findMany: 0, queryRaw: 0 });
  }

  {
    const db = fakeDb(treeRows, projectWhere);
    const tree = await buildTaskTree(1, USER_ID, 1, db as any);
    assert.deepEqual(tree.children?.map((child) => child.id), [2, 6, 3]);
    for (const child of tree.children ?? []) {
      assert.equal("children" in child, false, "nodes at the depth limit have no children key");
    }
    assert.deepEqual(db.calls, { findFirst: 1, findMany: 1, queryRaw: 0 });
  }

  {
    const db = fakeDb([row(1, null, 10, { accessible: false })], projectWhere);
    await assert.rejects(buildTaskTree(1, USER_ID, undefined, db as any), /Task not found in tree build/);
  }

  // 50 nodes, four levels: root, 7 children, 21 grandchildren, 21 great-grandchildren.
  {
    const rows: Row[] = [row(1, null, 1)];
    let nextId = 2;
    const addChildren = (parentIds: number[], perParent: number) => {
      const ids: number[] = [];
      for (const parentId of parentIds) {
        for (let index = 0; index < perParent; index++) {
          rows.push(row(nextId, parentId, nextId));
          ids.push(nextId++);
        }
      }
      return ids;
    };
    const level1 = addChildren([1], 7);
    const level2 = addChildren(level1, 3);
    addChildren(level2, 1);
    assert.equal(rows.length, 50);
    const db = fakeDb(rows, projectWhere);
    await buildTaskTree(1, USER_ID, undefined, db as any);
    assert.equal(db.calls.findFirst + db.calls.findMany, 5, "50-node tree loads in 5 queries");
  }

  // Ancestor walk.
  {
    const db = fakeDb(chainRows(11), projectWhere);
    assert.deepEqual(await findRootTaskIdForTree(11, USER_ID, db as any), { rootId: 1 });
    assert.deepEqual(db.calls, { findFirst: 0, findMany: 1, queryRaw: 1 }, "10 hops load in 2 queries");
  }

  {
    const db = fakeDb([row(1, null, 1)], projectWhere);
    assert.deepEqual(await findRootTaskIdForTree(1, USER_ID, db as any), { rootId: 1 });
  }

  {
    const db = fakeDb([], projectWhere);
    assert.deepEqual(await findRootTaskIdForTree(99, USER_ID, db as any), {
      error: "Task not found or access denied",
    });
    assert.deepEqual(db.calls, { findFirst: 0, findMany: 0, queryRaw: 1 });
  }

  {
    const db = fakeDb([row(1, 1, 1)], projectWhere);
    assert.deepEqual(await findRootTaskIdForTree(1, USER_ID, db as any), {
      error: "Invalid parent chain (cycle detected)",
    });
  }

  {
    const db = fakeDb([row(3, 1, 3), row(1, 2, 1), row(2, 1, 2)], projectWhere);
    assert.deepEqual(await findRootTaskIdForTree(3, USER_ID, db as any), {
      error: "Invalid parent chain (cycle detected)",
    });
  }

  {
    // An inaccessible task before the cycle is reported as access denied.
    const db = fakeDb([row(3, 1, 3), row(1, 2, 1, { accessible: false }), row(2, 1, 2)], projectWhere);
    assert.deepEqual(await findRootTaskIdForTree(3, USER_ID, db as any), {
      error: "Task not found or access denied",
    });
  }

  {
    // Inaccessible ancestor in the middle of the chain.
    const rows = chainRows(5);
    rows[1] = { ...rows[1], accessible: false };
    const db = fakeDb(rows, projectWhere);
    assert.deepEqual(await findRootTaskIdForTree(5, USER_ID, db as any), {
      error: "Task not found or access denied",
    });
  }

  {
    // Dangling parent id.
    const db = fakeDb([row(2, 1, 2)], projectWhere);
    assert.deepEqual(await findRootTaskIdForTree(2, USER_ID, db as any), {
      error: "Task not found or access denied",
    });
  }

  {
    // Root reached on the last allowed hop (hop 255).
    const db = fakeDb(chainRows(MAX_TREE_ANCESTOR_HOPS), projectWhere);
    assert.deepEqual(await findRootTaskIdForTree(MAX_TREE_ANCESTOR_HOPS, USER_ID, db as any), {
      rootId: 1,
    });
  }

  {
    const db = fakeDb(chainRows(MAX_TREE_ANCESTOR_HOPS + 1), projectWhere);
    assert.deepEqual(
      await findRootTaskIdForTree(MAX_TREE_ANCESTOR_HOPS + 1, USER_ID, db as any),
      { error: "Parent chain exceeds maximum depth" }
    );
  }

  console.log("chat task tree tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
