// HTPR-4119: Prisma 7 no longer reads the `prisma.schema` field from
// package.json, and CLI commands like `migrate`/`studio` need a datasource
// url (schema.prisma can no longer declare one). This file replaces both.
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: './src/prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
