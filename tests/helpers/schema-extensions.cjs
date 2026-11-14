function withSchemaExtensions(schemaSql) {
  return `CREATE EXTENSION IF NOT EXISTS pg_trgm;\n${schemaSql}`;
}

module.exports = { withSchemaExtensions };
