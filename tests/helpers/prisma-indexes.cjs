function modelIndexes(schema) {
  const indexes = new Map();
  let model = null;
  for (const line of schema.split("\n")) {
    const header = /^model (\w+) \{\s*$/.exec(line);
    if (header) {
      model = header[1];
      indexes.set(model, []);
      continue;
    }
    if (/^\}\s*$/.test(line)) {
      model = null;
      continue;
    }
    if (model === null) continue;
    const index = /^ {2}@@index\(\[([^\]]*)\]\)/.exec(line);
    if (index) indexes.get(model).push(index[1].split(",").map((column) => column.trim()));
  }
  return indexes;
}

function migrationIndexes(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => {
      const parsed = /^CREATE INDEX CONCURRENTLY IF NOT EXISTS "(\w+)" ON "(\w+)"\("(\w+)"\);$/.exec(statement);
      if (!parsed) throw new Error(`unparsed migration statement: ${statement}`);
      return { name: parsed[1], table: parsed[2], column: parsed[3] };
    });
}

module.exports = { modelIndexes, migrationIndexes };
