import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineText = readFileSync(new URL('./caller-refusals-baseline.json', import.meta.url), 'utf8');
const baseline = JSON.parse(baselineText);

export const callerRefusalsRule = {
  meta: {
    type: 'problem', schema: [],
    messages: { boundary: 'Caller mistake? throw new RefusalError({status, reason, field, message}) from @/lib/api/refusal. Server fault? Let it propagate; wrapMcpRoute logs and reports it.' },
  },
  create(context) {
    const nodes = [];
    return {
      'ThrowStatement > NewExpression[callee.name="Error"]'(node) { nodes.push(node); },
      'ThrowStatement > CallExpression[callee.object.name="Object"][callee.property.name="assign"]'(node) { nodes.push(node); },
      'CallExpression[callee.object.name="console"][callee.property.name="error"]'(node) { nodes.push(node); },
      'ClassDeclaration[superClass.name="Error"]'(node) { nodes.push(node); },
      'Program:exit'() {
        const filename = path.relative(root, context.filename).split(path.sep).join('/');
        const allowance = baseline[filename] ?? 0;
        for (const node of nodes.sort((a, b) => a.range[0] - b.range[0]).slice(allowance)) context.report({ node, messageId: 'boundary' });
      },
    };
  },
};

export const callerRefusalsLintConfig = {
  files: ['src/lib/mcp/**/*.{ts,tsx,js,mjs,cjs}'],
  ignores: ['src/lib/mcp/routeWrapper.ts', 'src/lib/mcp/operationCrashReport.ts'],
  plugins: { 'caller-refusals': {
    meta: { name: 'caller-refusals', version: createHash('sha256').update(readFileSync(new URL(import.meta.url))).update(baselineText).digest('hex') },
    rules: { boundary: callerRefusalsRule },
  } },
  rules: { 'caller-refusals/boundary': 'error' },
};
