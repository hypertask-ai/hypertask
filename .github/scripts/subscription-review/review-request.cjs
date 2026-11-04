#!/usr/bin/env node
// Splits one subscription review request into the files the wrapper needs and
// prints the review-schema path to constrain the model with. The engine owns the
// finding shape, so a shape it sends travels with the request; the installed
// copy is only the fallback when the request carries none (HYCI-113).
const fs = require('node:fs')
const { join } = require('node:path')

const [requestPath, outputDir] = process.argv.slice(2)
if (!requestPath || !outputDir) throw new Error('usage: review-request <request.json> <output-dir>')

const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'))
if (typeof request.instructions !== 'string' || !request.instructions.trim()) throw new Error('Missing trusted reviewer instructions')
if (typeof request.context !== 'string' || !request.context.trim()) throw new Error('Missing untrusted review context')
fs.writeFileSync(join(outputDir, 'instructions.txt'), request.instructions, { mode: 0o600 })
fs.writeFileSync(join(outputDir, 'context.txt'), request.context, { mode: 0o600 })

if (request.schema === undefined) process.exit(0)
if (request.schema === null || typeof request.schema !== 'object' || Array.isArray(request.schema)) {
  throw new Error('Review schema must be a JSON object')
}
const schemaPath = join(outputDir, 'schema.json')
fs.writeFileSync(schemaPath, JSON.stringify(request.schema), { mode: 0o600 })
process.stdout.write(schemaPath)
