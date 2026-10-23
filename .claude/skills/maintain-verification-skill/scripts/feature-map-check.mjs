#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const mapPath = '.claude/skills/verify-qa/reference/feature-map';

export function repoPaths(markdown) {
  const paths = new Set();
  const local = markdown.replace(/\([^()\n]*`[\w.-]+\/[\w.-]+`\s+(?:repo|repository)\b[^()\n]*\)/g, '');
  for (const token of [...local.matchAll(/`([^`\n]+)`/g)].flatMap(match => match[1].trim().split(/\s+/))) {
    if (!/^(src|e2e|\.github|\.claude|scripts|docs|prisma|public)\//.test(token)) continue;
    const clean = token.replace(/#.*$/, '').replace(/:\d+(?::\d+)?(?:-\d+)?[.,;:!)]*$/, '').replace(/[.,;:!)]*$/, '').replace(/\/$/, '');
    if (/[<*>?{}]/.test(clean)) continue;
    paths.add(clean);
  }
  return [...paths].sort();
}

export function apiRoutes(markdown) {
  const routes = new Set();
  const fragments = [...markdown.matchAll(/`([^`\n]+)`/g)].filter(match => !/\b(?:not|never use|instead of)\s+$/.test(markdown.slice(0, match.index))).map(match => match[1]);
  fragments.push(...[...markdown.matchAll(/\b(?:GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[^\s`"']+)/g)].map(match => match[1]));
  for (const fragment of fragments) {
    for (const match of fragment.matchAll(/(?<![\w/.*])\/api\/[^\s`"'(),;]+/g)) {
      const route = match[0].split(/[?#]/)[0].replace(/[.!:]+$/, '').replace(/\/$/, '');
      if (!route.includes('*')) routes.add(route);
    }
  }
  return [...routes].sort();
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(name) : entry.isFile() ? [name] : [];
  });
}

export function routePatterns(root) {
  const patterns = [];
  for (const family of ['pages', 'app']) {
    const base = path.join(root, 'src', family, 'api');
    for (const file of filesUnder(base)) {
      let relative = path.relative(base, file).split(path.sep).join('/');
      if (family === 'pages') {
        if (!relative.endsWith('.ts')) continue;
        relative = relative.slice(0, -3).replace(/(?:^|\/)index$/, '');
      } else {
        if (!relative.endsWith('/route.ts') && relative !== 'route.ts') continue;
        relative = relative.replace(/(?:^|\/)route\.ts$/, '');
        relative = relative.split('/').filter(segment => !/^\([^/]+\)$/.test(segment)).join('/');
      }
      patterns.push(relative.split('/').filter(Boolean));
    }
  }
  return patterns;
}

export function routeExists(route, patterns) {
  const segments = route.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const matches = (pattern, at = 0, index = 0) => {
    if (at === pattern.length) return index === segments.length;
    const segment = pattern[at];
    if (/^\[\[\.\.\..+\]\]$/.test(segment) || /^\[\.\.\..+\]$/.test(segment)) {
      const minimum = segment.startsWith('[[') ? 0 : 1;
      for (let count = minimum; index + count <= segments.length; count++) {
        if (matches(pattern, at + 1, index + count)) return true;
      }
      return false;
    }
    return index < segments.length && (segment === segments[index] || /^\[[^/]+\]$/.test(segment)) && matches(pattern, at + 1, index + 1);
  };
  return patterns.some(pattern => matches(pattern));
}

export function checkFeatureMap(root) {
  const directory = path.join(root, mapPath);
  const problems = [];
  const add = (page, kind, value) => problems.push({ page, kind, value });
  if (!existsSync(directory)) return [{ page: 'INDEX.md', kind: 'missing directory', value: mapPath }];
  const pages = readdirSync(directory).filter(name => name.endsWith('.md') && name !== 'INDEX.md').sort();
  const index = path.join(directory, 'INDEX.md');
  const rows = existsSync(index) ? readFileSync(index, 'utf8').split('\n').filter(line => /^\s*\|/.test(line)) : [];
  if (!existsSync(index)) add('INDEX.md', 'missing index', 'INDEX.md');
  const indexed = new Set();
  const seenRows = new Set();
  for (const row of rows) {
    const normalized = row.trim().replace(/\s+/g, ' ');
    if (seenRows.has(normalized)) add('INDEX.md', 'duplicate row', normalized);
    seenRows.add(normalized);
    for (const match of row.matchAll(/\[[^\]]*\]\((?:\.\/)?([^\s)#]+\.md)(?:#[^)]*)?\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z+.-]*:|^\/\//i.test(target)) continue;
      if (indexed.has(target)) add('INDEX.md', 'duplicate entry', target);
      indexed.add(target);
      if (!pages.includes(target)) add('INDEX.md', 'missing file', target);
    }
  }
  for (const page of pages) if (!indexed.has(page)) add('INDEX.md', 'unindexed page', page);
  const patterns = routePatterns(root);
  for (const page of pages) {
    const markdown = readFileSync(path.join(directory, page), 'utf8');
    for (const value of repoPaths(markdown)) {
      const resolved = path.resolve(root, value);
      if (!resolved.startsWith(path.resolve(root) + path.sep) || !existsSync(resolved)) add(page, 'missing path', value);
    }
    for (const value of apiRoutes(markdown)) if (!routeExists(value, patterns)) add(page, 'missing API route', value);
  }
  return problems;
}

export function formatProblems(problems) {
  return problems.length ? problems.map(({ page, kind, value }) => `- ${page}: ${kind}: ${value}`).join('\n') + '\n' : '- Feature map check: clean\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.argv[2] || process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const problems = checkFeatureMap(root);
    const report = formatProblems(problems);
    process.stdout.write(report);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    process.exitCode = problems.length ? 1 : 0;
  } catch {
    const report = '- feature-map-check: check failed: cannot read checkout or write summary\n';
    process.stdout.write(report);
    process.exitCode = 1;
  }
}
