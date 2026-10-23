UPDATE "Page" p SET "projectId" = t."projectId" FROM "Task" t WHERE p."taskId" = t.id AND p."projectId" <> t."projectId";
