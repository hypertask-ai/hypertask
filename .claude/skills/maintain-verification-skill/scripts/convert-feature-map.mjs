#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const mapDirectories = [
  '.claude/skills/verify-qa/reference/feature-map',
];

export const shape = [
  'Sub-features',
  'How to get to it (user POV)',
  'Driving it with agent-browser',
  'Gotchas',
];

const renamed = new Map([
  ['How a customer reaches it', shape[1]],
  ['How to drive it', shape[2]],
  ['What usually breaks', shape[3]],
]);

const nested = new Set(['What proof to collect', 'Cleanup', 'Gap']);

function slug(title) {
  return title
    .toLowerCase()
    .replace(/[`*_()[\]{}:;,.!?'"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parsePage(markdown) {
  const lines = markdown.split('\n');
  const h1 = lines.find(line => line.startsWith('# '));
  const firstH2 = lines.findIndex(line => line.startsWith('## '));
  const intro = lines.slice(0, firstH2 === -1 ? lines.length : firstH2);
  const sections = [];
  let current = null;
  for (const line of lines.slice(firstH2 === -1 ? lines.length : firstH2)) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      current = { title: match[1].trim(), body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  return { h1: h1 ?? '', intro, sections };
}

function bodyText(section) {
  return section.body.join('\n').replace(/^\n+|\n+$/g, '');
}

function h3(title, body) {
  if (!body) return [];
  return [`### ${title}`, '', body, ''];
}

export function convertPage(markdown) {
  const { h1, intro, sections } = parsePage(markdown);
  if (sections.some(section => section.title === shape[0])) return markdown;
  const extras = sections.filter(section => !renamed.has(section.title) && !nested.has(section.title));
  const title = h1.replace(/^# /, '').trim() || 'feature';
  const subFeatures = extras.length
    ? extras.map(section => `- \`${slug(section.title)}\` ${section.title}.`)
    : [`- \`${slug(title)}\` ${title}.`];
  const blocks = [
    ...intro,
    `## ${shape[0]}`, '', ...subFeatures, '',
  ];
  for (const section of sections) {
    const heading = renamed.get(section.title) ?? section.title;
    const level = renamed.has(section.title) ? '##' : '###';
    blocks.push(`${level} ${heading}`, '', ...section.body);
  }
  return blocks.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}

export function checkPage(markdown) {
  const { sections } = parsePage(markdown);
  const titles = sections.map(section => section.title);
  return titles.length === shape.length && titles.every((title, index) => title === shape[index]);
}

export function pages(root) {
  return mapDirectories.flatMap(directory => {
    const full = path.join(root, directory);
    if (!existsSync(full)) return [];
    return readdirSync(full)
      .filter(name => name.endsWith('.md') && name !== 'INDEX.md')
      .sort()
      .map(name => path.join(directory, name));
  });
}

function main() {
  const write = process.argv.includes('--write');
  const check = process.argv.includes('--check');
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const files = pages(root);
  if (check) {
    const problems = files.filter(file => !checkPage(readFileSync(path.join(root, file), 'utf8')));
    for (const file of problems) process.stdout.write(`- ${file}: not the four-section pstack shape\n`);
    if (problems.length) process.exitCode = 1;
    else process.stdout.write('feature-map shape ok\n');
    return;
  }
  let changed = 0;
  for (const file of files) {
    const before = readFileSync(path.join(root, file), 'utf8');
    const after = convertPage(before);
    if (after === before) continue;
    changed += 1;
    if (write) writeFileSync(path.join(root, file), after);
    else process.stdout.write(`would convert ${file}\n`);
  }
  process.stdout.write(`${write ? 'converted' : 'would convert'} ${changed} of ${files.length} pages\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
