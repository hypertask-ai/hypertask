import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GithubRateLimit, createRateLimitBudget, ghApi, rateLimitWait } from './github-rate-limit.mjs';

const CONTEXT = 'ux-signoff';
const READ_ERROR = 'Could not read the ticket; retried every 10 minutes';
const READ_BUDGET = 120;
const HEARTBEAT_MS = 60 * 60 * 1000;
const DEFERRED = 'Ticket not read this sweep; rechecked within 10 minutes';
const TICKET_TITLE = /^(HTPR|HYFA|YPER4|HYCI)-(\d+) \[([^\]]+)\] \S/;
const WIREFRAME = /https:\/\/(?:hypertask\.app\/(?:wireframes|explorations)|claude\.ai\/artifact)\/[A-Za-z0-9_-]+/;

function ticketFromTitle(title) {
  const match = TICKET_TITLE.exec(title);
  return match && { key: `${match[1]}-${match[2]}`, number: match[2], prefix: match[1], type: match[3] };
}

function visibleFiles(files) {
  return files.filter(({ filename }) =>
    (filename.startsWith('src/components/') || filename.startsWith('src/styles/') ||
      (filename.startsWith('src/pages/') && !filename.startsWith('src/pages/api/')) ||
      (filename.startsWith('src/app/') && !filename.startsWith('src/app/api/'))) &&
    /\.(tsx|jsx|css|scss)$/.test(filename) &&
    !/(?:\.(?:test|spec|stories)\.|(?:^|\/)__tests__\/)/.test(filename));
}

const PRODUCTION_MODES = 'e2e/smoke/production-flag-modes.json';
const FLAG_DEFINITION = /^src\/lib\/flags\/definitions\/([a-z0-9-]+)\.ts$/;

function patchedSource(source, file) {
  if (typeof source !== 'string' || !source.endsWith('\n') || typeof file.patch !== 'string') return null;
  const lines = source.slice(0, -1).split('\n');
  const result = [];
  let cursor = 0;
  let additions = 0;
  let deletions = 0;
  const hunks = file.patch.split(/(?=^@@ )/m);
  for (const hunk of hunks) {
    const rows = hunk.replace(/\n$/, '').split('\n');
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(rows.shift());
    if (!header) return null;
    const start = Number(header[1]) - 1;
    if (start < cursor || start > lines.length) return null;
    result.push(...lines.slice(cursor, start));
    cursor = start;
    if (Number(header[3]) !== result.length + (Number(header[4] ?? 1) === 0 ? 0 : 1)) return null;
    let oldCount = 0;
    let newCount = 0;
    for (const row of rows) {
      if (!/^[ +-]/.test(row)) return null;
      if (row[0] !== '+') {
        if (lines[cursor++] !== row.slice(1)) return null;
        oldCount++;
      }
      if (row[0] !== '-') {
        result.push(row.slice(1));
        newCount++;
      }
      if (row[0] === '+') additions++;
      if (row[0] === '-') deletions++;
    }
    if (oldCount !== Number(header[2] ?? 1) || newCount !== Number(header[4] ?? 1)) return null;
  }
  if (additions !== file.additions || deletions !== file.deletions) return null;
  result.push(...lines.slice(cursor));
  return result.length ? result.join('\n') + '\n' : '';
}

function scanFlagSource(source) {
  // This is deliberately not a JS parser: unsupported syntax keeps normal sign-off.
  if (/\\\n|[\r\u2028\u2029]/.test(source)) return null;
  const code = new Set();
  const containers = new Map();
  const blocks = new Map();
  const elements = new Map();
  const attributes = new Map();
  const parentheses = new Map();
  const groups = new Map();
  let cursor = 0;
  let depth = 0;
  const comments = [];
  const regexes = [];

  function quoted(attribute = false) {
    const quote = source[cursor++];
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === '\n' || char === '\r') return false;
      if (char === quote) return true;
      if (char === '\\') {
        if (attribute) return false;
        if (cursor === source.length || /[\r\n]/.test(source[cursor])) return false;
        cursor++;
      }
    }
    return false;
  }

  function expression(end = '', block = true) {
    if (++depth > 100) return false;
    let previous = block ? 'block-open' : '';
    while (cursor < source.length) {
      const char = source[cursor];
      if (/\s/.test(char)) { cursor++; continue; }
      if (end && char === end) { cursor++; depth--; return true; }
      if (/[})\]]/.test(char)) return false;
      if (source.startsWith('//', cursor)) {
        const newline = source.indexOf('\n', cursor + 2);
        comments.push([cursor, newline < 0 ? source.length : newline]);
        cursor = newline < 0 ? source.length : newline + 1;
        continue;
      }
      if (source.startsWith('/*', cursor)) {
        const close = source.indexOf('*/', cursor + 2);
        if (close < 0) return false;
        comments.push([cursor, close + 2]);
        cursor = close + 2;
        continue;
      }
      if (char === '"' || char === "'") {
        if (!quoted()) return false;
        previous = 'value';
        continue;
      }
      if (char === '`') {
        const start = cursor++;
        let closed = false;
        while (cursor < source.length) {
          if (source[cursor] === '\\') { cursor += 2; continue; }
          if (source[cursor] === '`') { cursor++; closed = true; break; }
          if (source.startsWith('${', cursor)) {
            cursor += 2;
            if (!expression('}', false)) return false;
          } else cursor++;
        }
        if (!closed) return false;
        groups.set(start, cursor);
        previous = 'value';
        continue;
      }
      if (char === '/') {
        regexes.push(cursor);
        if (!['', '=>', '=', '(', '[', ',', ':', '?', 'return', '&&', '||', '!'].includes(previous)) return false;
        cursor++;
        let characterClass = false;
        let closed = false;
        while (cursor < source.length) {
          const next = source[cursor++];
          if (/[\r\n]/.test(next)) return false;
          if (next === '\\') { cursor++; continue; }
          if (next === '[') { if (characterClass) return false; characterClass = true; }
          if (next === ']') characterClass = false;
          if (next === '/' && !characterClass) { closed = true; break; }
        }
        if (!closed) return false;
        const flagsStart = cursor;
        while (/[a-z]/i.test(source[cursor] ?? '') && cursor < source.length) cursor++;
        const flags = source.slice(flagsStart, cursor);
        if (/[^dgimsuy]/.test(flags) || new Set(flags).size !== flags.length) return false;
        previous = 'value';
        continue;
      }
      if (char === '\\') return false;
      if (char === '<' && ['block-open', 'block-close', ';', '(', '[', '=', '=>', 'return', '&&', '||', '?', ':', ',', ''].includes(previous)) {
        if (!element()) return false;
        previous = 'value';
        continue;
      }
      const start = cursor;
      code.add(cursor++);
      if (/[A-Za-z_$0-9]/.test(char)) {
        while (cursor < source.length && /[\w$]/.test(source[cursor])) code.add(cursor++);
        previous = previous === '.' ? 'value' : source.slice(start, cursor);
      } else if (char === '(' || char === '[' || char === '{') {
        const isBlock = char === '{' && ['block-open', 'block-close', ';', ')', '=>', 'else', 'try', 'finally'].includes(previous);
        if (!expression({ '(': ')', '[': ']', '{': '}' }[char], isBlock)) return false;
        groups.set(start, cursor);
        if (isBlock) blocks.set(start, cursor);
        if (char === '(') parentheses.set(start, cursor);
        previous = isBlock ? 'block-close' : { '(': ')', '[': ']', '{': 'value' }[char];
      } else {
        const pair = source.slice(start, cursor + 1);
        if (['=>', '&&', '||'].includes(pair)) { code.add(cursor++); previous = pair; }
        else previous = char;
      }
    }
    depth--;
    return !end;
  }

  function container(child = false) {
    const start = cursor++;
    if (!expression('}', false)) return false;
    if (child) containers.set(start, cursor);
    return true;
  }

  function element() {
    if (++depth > 100) return false;
    const start = cursor;
    const opening = /^<([A-Za-z][\w.-]*(?::[A-Za-z][\w.-]*)?|)(?=[\s/>])/.exec(source.slice(cursor));
    if (!opening) return false;
    const name = opening[1];
    cursor += name.length + 1;
    if (!name && source[cursor] !== '>') return false;
    while (cursor < source.length && source[cursor] !== '>') {
      if (source.startsWith('/>', cursor)) {
        cursor += 2;
        elements.set(start, cursor);
        depth--;
        return Boolean(name);
      }
      if (/\s/.test(source[cursor])) { cursor++; continue; }
      if (source[cursor] === '{') { if (!container()) return false; continue; }
      const attributeStart = cursor;
      const attribute = /^[A-Za-z_:][\w:.-]*/.exec(source.slice(cursor));
      if (!attribute) return false;
      cursor += attribute[0].length;
      while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++;
      if (source[cursor] !== '=') continue;
      cursor++;
      while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++;
      if (source[cursor] === '"' || source[cursor] === "'") { if (!quoted(true)) return false; }
      else if (source[cursor] === '{') { if (!container()) return false; }
      else return false;
      attributes.set(attributeStart, cursor);
    }
    if (source[cursor++] !== '>') return false;
    while (cursor < source.length) {
      if (source.startsWith('</', cursor)) {
        const closing = `</${name}>`;
        if (!source.startsWith(closing, cursor)) return false;
        cursor += closing.length;
        elements.set(start, cursor);
        depth--;
        return true;
      }
      if (source[cursor] === '<') { if (!element()) return false; }
      else if (source[cursor] === '{') { if (!container(true)) return false; }
      else if (source[cursor] === '}') return false;
      else cursor++; // JSX text, including quotes, is not JavaScript.
    }
    return false;
  }

  return expression() ? { code, containers, blocks, elements, attributes, parentheses, groups, comments, regexes } : null;
}

function listItems(source, scanned, start, end) {
  const items = [];
  let first = start;
  for (let cursor = start; cursor < end; cursor++) {
    const close = scanned.groups.get(cursor);
    if (close != null) { cursor = close - 1; continue; }
    if (!scanned.code.has(cursor)) continue;
    if (source[cursor] === ',') { items.push([first, cursor]); first = cursor + 1; }
  }
  if (source.slice(first, end).trim()) items.push([first, end]);
  return items;
}

function blankComments(source) {
  const scanned = scanFlagSource(source);
  if (!scanned) return null;
  let blanked = source;
  for (const [start, end] of scanned.comments) {
    blanked = blanked.slice(0, start) + blanked.slice(start, end).replace(/[^\n]/g, ' ') + blanked.slice(end);
  }
  return blanked;
}

function projectFlagOn(source, symbols) {
  const initial = scanFlagSource(source);
  if (!initial || [...source.matchAll(/\b(?:eval|with)\b/g)].some((match) => initial.code.has(match.index))) return null;
  const imports = [...source.matchAll(/^import \{ ([A-Za-z_$][\w$]*(?:, [A-Za-z_$][\w$]*)*) \} from (["'])(@\/lib\/flags(?:\/keys)?|@\/hooks\/useFlag)\2;?\n/gm)].filter((match) => initial.code.has(match.index));
  const importedSymbols = new Set(imports.filter((match) => match[3].startsWith('@/lib/flags')).flatMap((match) => match[1].split(', ')));
  const importedHooks = new Set(imports.flatMap((match) => match[1].split(', ').filter((name) =>
    (name === 'useFlag' && match[3] === '@/hooks/useFlag') || (name === 'isFeatureEnabled' && match[3] === '@/lib/flags'))));
  for (const match of source.matchAll(/\b(?:useFlag|isFeatureEnabled)\b/g)) {
    if (!initial.code.has(match.index) || imports.some((item) => item.index <= match.index && match.index < item.index + item[0].length)) continue;
    if (!/^\([A-Z][A-Z0-9_]*[,)]/.test(source.slice(match.index + match[0].length)) ||
      !/(?:^|[=(:,;{\[]|\bawait)\s*$/.test(source.slice(0, match.index))) return null;
    const end = initial.parentheses.get(match.index + match[0].length);
    if (end == null || /^\s*(?::[^{};=]+)?\s*(?:=>|\{)/.test(source.slice(end))) return null;
  }
  const aliases = [];
  let projected = source.replace(/^([ \t]*)const ([A-Za-z_][A-Za-z0-9_]*) = (useFlag\(([A-Z][A-Z0-9_]*)\)|await isFeatureEnabled\(([A-Z][A-Z0-9_]*), [A-Za-z_$][\w$.]*\));?\n/gm,
    (line, indent, alias, call, clientSymbol, serverSymbol, offset) => {
      const symbol = clientSymbol ?? serverSymbol;
      if (!initial.code.has(offset + indent.length) || !symbols.has(symbol) || !importedSymbols.has(symbol) || !importedHooks.has(clientSymbol ? 'useFlag' : 'isFeatureEnabled')) return line;
      const scope = [...initial.blocks].filter(([start, end]) => start < offset && offset < end).sort(([a], [b]) => b - a)[0];
      if (!scope || [...source.matchAll(new RegExp(`\\b${alias}\\b`, 'g'))].some((match) => initial.code.has(match.index) &&
        (match.index < offset || match.index >= scope[1]))) return line;
      if (/^\s*[\[(`+\-/]/.test(source.slice(offset + line.length)) && !/(?:^|[;{])\s*$/.test(source.slice(0, offset))) return line;
      aliases.push(alias);
      return '';
    });
  if (aliases.length && initial.regexes.length) return null;
  let unwrapped = 0;
  for (const alias of aliases) {
    const scanned = scanFlagSource(projected);
    if (!scanned) return null;
    const wrapper = new RegExp(`^([ \t]*)\\{${alias} (&&|\\?) \\(\n([\\s\\S]*?)^\\1\\)( : null)?\\}\n`, 'gm');
    projected = projected.replace(wrapper, (whole, indent, operator, body, fallback, offset) => {
      const start = offset + indent.length;
      const end = offset + whole.length - 1;
      if (scanned.containers.get(start) !== end && scanned.blocks.get(start) !== end) return whole;
      if ((operator === '?') !== Boolean(fallback)) return whole;
      const rows = body.slice(0, -1).split('\n');
      if (!rows.length || rows.some((line) => !line.startsWith(indent + '  '))) return whole;
      // Only a single JSX element can lose these parentheses without changing evaluation.
      const bodyStart = offset + whole.indexOf('\n') + 1;
      if ([...scanned.groups].some(([start, end]) => bodyStart <= start && end <= bodyStart + body.length &&
        projected[start] === '`' && /[\r\n]/.test(projected.slice(start, end)))) return whole;
      const elementStart = bodyStart + body.search(/\S/);
      const elementEnd = scanned.elements.get(elementStart);
      if (elementEnd == null || projected.slice(elementEnd, bodyStart + body.length).trim()) return whole;
      unwrapped++;
      return rows.map((line) => indent + line.slice(indent.length + 2)).join('\n') + '\n';
    });
    {
      let current = scanFlagSource(projected);
      if (!current) return null;
      projected = projected.replace(new RegExp(String.raw`^([ \t]*)if \(!${alias}\) return;\n`, 'gm'), (whole, indent, offset) => {
        if (!current.code.has(offset + indent.length) || !/[;{]\s*$/.test(projected.slice(0, offset)) || /^\s*(?:else\b|\/)/.test(projected.slice(offset + whole.length))) return whole;
        unwrapped++;
        return '';
      });
      current = scanFlagSource(projected);
      if (!current) return null;
      projected = projected.replace(new RegExp(String.raw`\bif \(${alias}\) (?=[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\()`, 'g'), (whole, offset) => {
        if (!current.code.has(offset)) return whole;
        const callStart = projected.indexOf('(', offset + whole.length);
        const callEnd = current.parentheses.get(callStart);
        if (callEnd == null || projected[callEnd] !== ';' || /^;\s*(?:else\b|\/)/.test(projected.slice(callEnd))) return whole;
        const prefix = projected.slice(0, offset);
        if (!/(?:^|[;{}])\s*$/.test(prefix)) return whole;
        unwrapped++;
        return '';
      });
    }
    const atom = String.raw`(?:[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*|"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*')`;
    const expressionStart = (text) => /(?:[({\[,:]|(?<!\?)\?|(?<![=<>!+*/%&|^?\-])=|\breturn)\s*$/.test(text);
    {
      for (const [pattern, replacement, allowLogicalPrefix] of [
        [new RegExp(String.raw`(!?)\b${alias} \? (${atom}) : (${atom})(?=\s*[,;)}\]])`, 'g'), (match) => match[1] ? match[3] : match[2]],
        [new RegExp(String.raw`\b${alias} && `, 'g'), () => '', true],
      ]) {
        const current = scanFlagSource(projected);
        if (!current) return null;
        const text = projected;
        projected = text.replace(pattern, (...args) => {
          const offset = args.at(-2);
          if (current.regexes.length) return args[0];
          if ([...current.parentheses].some(([start, end]) => start < offset && offset < end &&
            (!/(?:[({\[,:=!?&|]|\b[A-Za-z_$][\w$]*)\s*$/.test(text.slice(0, start)) ||
              /\b(?:typeof|delete|new)\s*$/.test(text.slice(0, start)) ||
              !/^\s*(?:[,;)}\]{]|$)/.test(text.slice(end))))) return args[0];
          const prefix = text.slice(0, offset);
          if (!current.code.has(offset) || !(expressionStart(prefix) || (allowLogicalPrefix && /(?:&&|\|\|)\s*$/.test(prefix)))) return args[0];
          if (/^(?:[ \t]*[\r\n]|\s*(?:function\b|class\b|async\s+function\b|\{|let\s*\[))/.test(text.slice(offset + args[0].length))) return args[0];
          unwrapped++;
          return replacement(args);
        });
      }
    }
    const current = scanFlagSource(projected);
    if (!current) return null;
    const text = projected;
    for (const [start, end] of [...current.attributes].sort(([a], [b]) => b - a)) {
      const attribute = text.slice(start, end);
      const direct = new RegExp(String.raw`^([A-Za-z_:][\w:.-]*)=\{${alias}\}$`).exec(attribute);
      if (!direct) continue;
      projected = projected.slice(0, start) + `${direct[1]}={true}` + projected.slice(end);
      unwrapped++;
    }
    {
      const current = scanFlagSource(projected);
      if (!current) return null;
      const edits = [];
      for (const match of projected.matchAll(/\b(useEffect)\(/g)) {
        if (!current.code.has(match.index)) continue;
        const start = match.index + match[0].length - 1;
        const end = current.parentheses.get(start);
        if (end == null) continue;
        const hookImport = new RegExp(String.raw`^import \{ (?:[A-Za-z_$][\w$]*, )*${match[1]}(?:, [A-Za-z_$][\w$]*)* \} from ["']react["'];$`, 'm').exec(projected);
        if (!hookImport || !current.code.has(hookImport.index) ||
          [...projected.matchAll(new RegExp(String.raw`\b${match[1]}\b`, 'g'))].some((reference) => {
            if (!current.code.has(reference.index) || (hookImport.index <= reference.index && reference.index < hookImport.index + hookImport[0].length)) return false;
            const call = reference.index + reference[0].length;
            const close = current.parentheses.get(call);
            return close == null || projected[close] !== ';' || !/(?:^|[;{}])\s*$/.test(projected.slice(0, reference.index));
          })) continue;
        const args = listItems(projected, current, start + 1, end - 1);
        if (args.length !== 2) continue;
        const [left, right] = args[1];
        const arrayStart = left + projected.slice(left, right).search(/\S/);
        const arrayEnd = current.groups.get(arrayStart);
        if (projected[arrayStart] !== '[' || arrayEnd == null || projected.slice(arrayEnd, right).trim()) continue;
        const deps = listItems(projected, current, arrayStart + 1, arrayEnd - 1);
        for (let index = 0; index < deps.length; index++) {
          const [a, b] = deps[index];
          if (projected.slice(a, b).trim() !== alias) continue;
          const next = deps[index + 1]?.[0];
          if (next != null) edits.push([a, index === 0 && !projected.slice(a, b).includes('\n') ? next + projected.slice(next, arrayEnd).search(/\S/) : next, '']);
          else if (projected[b] === ',') edits.push([a, b + 1, '']);
          else edits.push([index ? deps[index - 1][1] : a, b, '']);
          unwrapped++;
        }
      }
      for (const [a, b, replacement] of edits.sort(([a], [b]) => b - a)) projected = projected.slice(0, a) + replacement + projected.slice(b);
    }
    const remaining = scanFlagSource(projected);
    if (!remaining || [...projected.matchAll(new RegExp(`\\b${alias}\\b`, 'g'))].some((match) => remaining.code.has(match.index))) return null;
  }
  const final = scanFlagSource(projected);
  if (!final) return null;
  const removable = new Set([...symbols, 'useFlag', 'isFeatureEnabled']);
  projected = projected.replace(/^import \{ ([A-Za-z_$][\w$]*(?:, [A-Za-z_$][\w$]*)*) \} from (["'])(@\/lib\/flags(?:\/keys)?|@\/hooks\/useFlag)\2;?\n/gm,
    (line, names, quote, module, offset) => {
      if (!final.code.has(offset)) return line;
      const kept = names.split(', ').filter((name) => {
        if (!removable.has(name)) return true;
        const rest = projected.replace(line, '');
        const scanned = scanFlagSource(rest);
        return !scanned || [...rest.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].some((match) => scanned.code.has(match.index));
      });
      return kept.length ? `import { ${kept.join(', ')} } from ${quote}${module}${quote}${line.endsWith(';\n') ? ';' : ''}\n` : '';
    });
  const checked = scanFlagSource(projected);
  if (!checked || [...symbols].some((symbol) => [...projected.matchAll(new RegExp(`\\b${symbol}\\b`, 'g'))].some((match) => checked.code.has(match.index)))) return null;
  return { source: projected, unwrapped };
}

function normalizeTrueProps(source) {
  const scanned = scanFlagSource(source);
  if (!scanned) return null;
  for (const [start, end] of [...scanned.attributes].sort(([a], [b]) => b - a)) {
    const attribute = source.slice(start, end);
    if (/^[A-Za-z_:][\w:.-]*=\{true\}$/.test(attribute)) source = source.slice(0, start) + attribute.slice(0, -7) + source.slice(end);
  }
  return source;
}

export function flagRemovalOnly(files, productionModes, sources = {}) {
  const definitions = files.filter((file) => FLAG_DEFINITION.test(file.filename));
  if (!definitions.length || !productionModes?.modes || !sources || files.some((file) => ['renamed', 'copied'].includes(file.status))) return [];
  const keys = [];
  const symbols = new Set();
  for (const file of definitions) {
    const key = FLAG_DEFINITION.exec(file.filename)[1];
    const source = sources[file.filename];
    if (file.status !== 'removed' || productionModes.modes[key] !== 'EVERYONE' || patchedSource(source, file) !== '') return [];
    const definition = new RegExp(`^export const ([A-Z][A-Z0-9_]*) = ["']${key}["'];$`, 'm').exec(source);
    if (!definition || !new RegExp(`key: ${definition[1]}[,\\s]`).test(source)) return [];
    keys.push(key);
    symbols.add(definition[1]);
  }
  let unwrapped = 0;
  for (const file of files) {
    if (definitions.includes(file) || /^(?:tests\/|docs\/)/.test(file.filename) || (!file.filename.startsWith('src/') && /\.md$/.test(file.filename))) continue;
    if (file.filename === PRODUCTION_MODES) {
      try {
        const expected = structuredClone(productionModes);
        for (const key of keys) delete expected.modes[key];
        if (file.status !== 'modified' || JSON.stringify(JSON.parse(patchedSource(sources[file.filename], file))) !== JSON.stringify(expected)) return [];
      } catch { return []; }
      continue;
    }
    if (file.filename === '.github/scripts/agent-scope/agent-scope-exceptions.json') {
      try {
        const before = JSON.parse(sources[file.filename]);
        const after = JSON.parse(patchedSource(sources[file.filename], file));
        if (file.status !== 'modified' || !Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return [];
        for (let index = 0; index < before.length; index++) {
          const old = before[index];
          const next = after[index];
          if (JSON.stringify(old) === JSON.stringify(next)) continue;
          if (!files.some((changed) => changed.filename === old.path && changed.status === 'modified') ||
            !/^https:\/\/app\.hypertask\.ai\/detail\/project-\d+\/\d+$/.test(next.approvedIn) || !/^[a-f0-9]{64}$/.test(next.sha256) ||
            JSON.stringify({ ...next, approvedIn: old.approvedIn, sha256: old.sha256 }) !== JSON.stringify(old)) return [];
        }
      } catch { return []; }
      continue;
    }
    if (/^src\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(file.filename)) {
      const rows = file.patch?.split('\n').slice(1);
      if (file.status !== 'added' || file.deletions !== 0 || rows?.length !== file.additions ||
        rows.some((row) => !keys.some((key) => row === `+DELETE FROM "FeatureFlag" WHERE "key" = '${key}';`))) return [];
      continue;
    }
    if (file.status !== 'modified' || !/^src\//.test(file.filename) || !/\.[jt]sx?$/.test(file.filename)) return [];
    const patched = patchedSource(sources[file.filename], file);
    if (patched == null) return [];
    const source = blankComments(sources[file.filename]);
    const after = blankComments(patched);
    if (source == null || after == null) return [];
    const projection = projectFlagOn(source, symbols);
    if (!projection) return [];
    const normalized = normalizeTrueProps(projection.source);
    if (normalized == null || normalized !== normalizeTrueProps(after)) return [];
    unwrapped += projection.unwrapped;
  }
  return unwrapped ? keys.sort() : [];
}

function readProductionFile(filename) {
  if (!/^[A-Za-z0-9_./ \[\]-]+$/.test(filename) || filename.startsWith('/') || filename.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  try { return readFileSync(new URL(`../../${filename}`, import.meta.url), 'utf8'); }
  catch { return null; }
}

function plainText(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/<span\b[^>]*\bdata-type\s*=\s*(["'])mention\1[^>]*>[\s\S]*?<\/span\s*>/gi, '')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>|<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, entity) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()];
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    });
}

function humanValentin(item, idField) {
  return item[idField] === 6 &&
    ['agent', 'agent_display_name', 'agentId', 'isAgent'].every((key) => item[key] == null);
}

function commentVerdict(comment) {
  if (!humanValentin(comment, 'creatorId')) return null;
  // Agents for the same owner keep his attribution: any edit he did not make himself blocks until a fresh yes.
  if (comment.editedAt != null && !(comment.editedBy && humanValentin(comment.editedBy, 'userId'))) return 'reject';
  const text = plainText(comment.text).trim().toLowerCase().replace(/[’‘]/g, "'");
  if (/^(?:no|nope|not|reject|don't)\b|\b(?:no|not|but|change|instead)\b|n't/.test(text)) return 'reject';
  return /^(?:(?:yes|yep|yeah|go|ok|okay|agree|agreed|approve|approved|lgtm|looks good|ship it)\b|👍)/u.test(text) ? 'approve' : null;
}

function asksYesToShipElements(comment, wireframeLink, designIds, newElements) {
  const text = plainText(comment.text).trim();
  const ask = /^Question:[ \t]*([^\n]*)/.exec(text)?.[1].replace(/[’‘]/g, "'");
  if (ask == null || !/(?:^|\n)[ \t]*Yes:/.test(text)) return false;
  const template = /^May (.+) ship with the (?:\d+ )?new (?:parts|elements) named here: ([A-Za-z0-9_]+(?:, ?[A-Za-z0-9_]+)*)\?$/.exec(ask.trim());
  if (!template) return false;
  const named = new Set(template[2].split(/, ?/));
  if (!newElements.length || !newElements.every((name) => named.has(name))) return false;
  if (/\b(?:no|not|block|blocked|reject|defer|postpone|hold|wait|stop|cancel|revert|undo|instead|another|different|change|review|later|tests?|only)\b|n't/i.test(template[1])) return false;
  return comment.text.match(WIREFRAME)?.[0] === wireframeLink ||
    designIds.some((id) => new RegExp(`#comment-${id}(?!\\d)`).test(comment.text));
}

function valentinReacted(comment) {
  const edited = comment.editedAt ?? comment.updatedAt;
  return (comment.reactions ?? []).some((reaction) =>
    humanValentin(reaction, 'userId') && /^(?:👍[🏻-🏿]?|✅)️?$/u.test(reaction.emoji) &&
    (edited == null || Date.parse(reaction.createdAt) > Date.parse(edited)));
}

function newest(comments) {
  return comments.filter((comment) => Number.isFinite(Date.parse(comment.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (b.id ?? 0) - (a.id ?? 0))[0];
}

function elementNames(comment) {
  const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const withoutNotes = plainText(comment.text).replace(/\([^()\r\n]*\)/g, '');
  return [...withoutNotes.matchAll(/\bNew elements:[ \t]*([^\r\n.?;]*)/gi)]
    .flatMap((match) => match[1].split(/,|\s+and\s+/i).map(normalize)).filter((name) => name && name !== 'none');
}

export function evaluate({ title, author, files, comments = [], parentComments = [], productionModes, sources }) {
  const success = (description) => ({ state: 'success', description, details: [] });
  const ui = visibleFiles(files);
  if (ui.length === 0) return success('No visible UI change');
  if (author === 'dependabot[bot]') return success('Dependabot is exempt from UX signoff');
  const removedFlags = flagRemovalOnly(files, productionModes, sources);
  if (removedFlags.length) return success(`Flag removal only: ${removedFlags.join(', ')} already on for everyone`.slice(0, 140));
  const ticket = ticketFromTitle(title);
  if (!ticket) {
    const description = 'Title names no ticket, so the wireframe sign-off cannot be checked';
    return { state: 'failure', description, details: [description] };
  }

  // Valentin's own comments are verdicts, even when they quote the wireframe link.
  const wireframe = newest(comments.filter((comment) => WIREFRAME.test(comment.text) && !humanValentin(comment, 'creatorId')));
  const created = wireframe ? Date.parse(wireframe.createdAt) : -Infinity;
  const edited = wireframe?.editedAt ?? wireframe?.updatedAt;
  const revision = edited != null ? Date.parse(edited) : created;
  const verdict = newest(comments.filter((comment) =>
    Date.parse(comment.createdAt) > created && commentVerdict(comment)));
  const approval = verdict && commentVerdict(verdict) === 'approve' && Date.parse(verdict.createdAt) > revision ? verdict : null;
  const reacted = wireframe && valentinReacted(wireframe);
  const wireframeLink = wireframe?.text.match(WIREFRAME)?.[0];
  const earlierSameWireframe = !wireframe ? [] : comments.filter((comment) => comment !== wireframe &&
    !humanValentin(comment, 'creatorId') && comment.text.match(WIREFRAME)?.[0] === wireframeLink &&
    Date.parse(comment.editedAt ?? comment.updatedAt ?? comment.createdAt) < created);
  const designIds = [wireframe, ...earlierSameWireframe].map((comment) => comment?.id).filter((id) => id != null);
  const newElements = [...new Set(ui.filter(({ filename, status }) =>
    (status === 'added' || status === 'copied') && filename.startsWith('src/components/') &&
    /\.(tsx|jsx)$/.test(filename)).map(({ filename }) => {
      const name = basename(filename).replace(/\.(tsx|jsx)$/, '');
      return name === 'index' ? basename(dirname(filename)) : name;
    }))];
  const question = wireframe && newest(comments.filter((comment) =>
    !humanValentin(comment, 'creatorId') && Date.parse(comment.createdAt) > revision &&
    asksYesToShipElements(comment, wireframeLink, designIds, newElements) && valentinReacted(comment)));
  const approved = commentVerdict(verdict ?? {}) !== 'reject' && Boolean(approval || reacted || question);
  const approvedNames = new Set(approved ? [
    ...(wireframe ? elementNames(wireframe) : []),
    ...earlierSameWireframe.flatMap(elementNames),
    ...(approval ? elementNames(approval) : []),
    ...(question ? newElements.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')) : []),
  ] : []);
  const missingNames = newElements.filter((name) => !approvedNames.has(name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const reusesExistingUi = newElements.length === 0;
  const exempt = ticket.type === 'BUGFIX' || ticket.prefix === 'YPER4' || reusesExistingUi;
  const details = [];
  if (!exempt && (!wireframe || !approved)) {
    details.push(`UI change needs Valentin's yes on a wireframe on ${ticket.key}`);
  }
  if (missingNames.length) {
    details.push(`New element ${missingNames.join(', ')} needs Valentin's yes by name on ${ticket.key}`);
  }
  if (details.length) {
    const childLink = wireframe?.text.match(WIREFRAME)?.[0];
    const parentWireframe = newest(parentComments.filter((comment) => WIREFRAME.test(comment.text) && !humanValentin(comment, 'creatorId')));
    const sameDesignAsParent = !childLink || parentWireframe?.text.match(WIREFRAME)?.[0] === childLink;
    const childDesignUnedited = edited == null;
    if (parentComments.length && !verdict && sameDesignAsParent && childDesignUnedited) {
      const parent = evaluate({ title, author, files, comments: parentComments });
      if (parent.state === 'success') return parent;
    }
    return { state: 'failure', description: details[0].slice(0, 140), details };
  }
  if (reusesExistingUi) return success('No new component file; reused UI ships behind its flag without a wireframe');
  return success(exempt ? 'Wireframe exempt; new elements approved' : 'Wireframe and new elements have UX signoff');
}

export function ticketUrl(title, runUrl) {
  const ticket = ticketFromTitle(title);
  const project = { HTPR: 15, YPER4: 4060, HYCI: 11514 }[ticket?.prefix];
  return project ? `https://app.hypertask.ai/detail/project-${project}/${ticket.number}` : runUrl;
}

export function createGithub({ env = process.env, fetchImpl = fetch, exec = execFileSync, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, log = console.error } = {}) {
  const budget = createRateLimitBudget({
    now, maxWaitMs: Number(env.GH_API_MAX_WAIT_SECONDS || 240) * 1000,
    timeBudgetMs: Number(env.GH_API_TIME_BUDGET_SECONDS || 480) * 1000,
  });
  return async (path, { method = 'GET', body, noWait = false } = {}) => {
    const readOnly = method === 'GET' && body === undefined;
    if (!env.GH_TOKEN) {
      const args = ['api', '--method', method, path];
      if (body) args.push('--input', '-');
      return JSON.parse(await ghApi(args.slice(1), {
        budget, now, sleep, log, env: { GH_API_NO_WAIT: noWait ? '1' : '' },
        exec: (command, ghArgs, options) => {
          try {
            return { status: 0, stdout: exec(command, ghArgs, {
              ...options, input: body ? JSON.stringify(body) : undefined, stdio: ['pipe', 'pipe', 'pipe'],
            }) };
          } catch (error) {
            return { status: error.status, stdout: error.stdout, stderr: error.stderr };
          }
        },
      }));
    }
    let readToken = readOnly ? env.GH_READ_TOKEN || '' : '';
    for (let attempt = 0; ;) {
      let response;
      try {
        response = await fetchImpl(`https://api.github.com/${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${readToken || env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30000),
        });
      } catch (error) {
        if (readToken) { readToken = ''; continue; }
        if (!readOnly || noWait || attempt >= 2) throw error;
        await sleep(attempt++ === 0 ? 1000 : 3000);
        continue;
      }
      if (response.ok) return response.json();
      if (readToken) {
        readToken = '';
        log(`hypertask-ci read token got HTTP ${response.status}; retrying with GH_TOKEN`);
        continue;
      }
      const wait = rateLimitWait(response.status, response.headers, await response.text(), now());
      if (wait != null) {
        if (!readOnly || noWait) throw new GithubRateLimit(new Date(now() + wait).toISOString());
        const ms = budget.reserve(wait);
        log(`GitHub API rate limited; waiting ${Math.ceil(ms / 1000)}s until reset`);
        await sleep(ms);
        continue;
      }
      if (!readOnly || noWait || attempt >= 2 || response.status < 500) {
        throw new Error(`GitHub API returned HTTP ${response.status}`);
      }
      await sleep(attempt++ === 0 ? 1000 : 3000);
    }
  };
}

async function githubPages(github, path, options) {
  const items = [];
  for (let page = 1; ; page++) {
    const entries = await github(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, options);
    if (!Array.isArray(entries)) throw new Error('GitHub API returned no list');
    items.push(...entries);
    if (entries.length < 100) return items;
  }
}

async function readHypertask(url, { env = process.env, fetchImpl = fetch, budget } = {}) {
  if (!env.MCP_TOKEN) throw new Error('HYPERTASK_MCP_TOKEN is empty');
  if (budget) {
    if (budget.stopped || budget.remaining === 0) {
      throw Object.assign(new Error(budget.stopped || 'Hypertask read budget exhausted; left untouched this run'), { deferred: true });
    }
    budget.remaining--;
  }
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${env.MCP_TOKEN}` }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const error = new Error(`Hypertask API returned HTTP ${response.status}`);
    if (budget && (response.status === 429 || response.status >= 500)) {
      budget.stopped = `${error.message}; further reads stopped this run`;
      error.deferred = true;
    }
    throw error;
  }
  return response.json();
}

export async function readComments(ticket, { env = process.env, fetchImpl = fetch, budget } = {}) {
  if (!env.MCP_TOKEN) throw new Error('HYPERTASK_MCP_TOKEN is empty');
  const comments = [];
  const cursors = new Set();
  let cursor;
  do {
    const url = new URL('/api/mcp/comments', env.MCP_BASE_URL || 'https://app.hypertask.ai');
    url.searchParams.set('ticket_number', ticket);
    url.searchParams.set('limit', '100');
    if (cursor != null) url.searchParams.set('cursor', cursor);
    const data = await readHypertask(url, { env, fetchImpl, budget });
    if (data.success === false || !Array.isArray(data.comments) ||
      data.comments.some((comment) => !comment || typeof comment.text !== 'string')) {
      throw new Error('Hypertask API returned no valid comment list');
    }
    comments.push(...data.comments);
    cursor = data.nextCursor;
    if (cursor != null) {
      if ((typeof cursor !== 'string' && typeof cursor !== 'number') || cursors.has(String(cursor))) {
        throw new Error('Hypertask API returned an invalid or repeated cursor');
      }
      cursors.add(String(cursor));
    }
  } while (cursor != null);
  return comments;
}

async function readParentTicket(ticket, { env, fetchImpl, budget }) {
  const url = new URL('/api/mcp/tasks', env.MCP_BASE_URL || 'https://app.hypertask.ai');
  url.searchParams.set('ticket_number', ticket);
  const data = await readHypertask(url, { env, fetchImpl, budget });
  const task = data.tasks?.[0];
  if (data.success === false || !Array.isArray(data.tasks) || data.tasks.length !== 1 || task?.ticketNumber !== ticket) {
    throw new Error('Hypertask API returned no valid ticket');
  }
  const parent = task.parent_task?.ticketNumber;
  if (parent == null && task.parent_id == null && task.parent_task == null) return null;
  if (typeof parent !== 'string' || !/^(HTPR|HYFA|YPER4|HYCI)-[1-9]\d*$/.test(parent) || parent === ticket) {
    throw new Error('Hypertask API did not expose a valid parent ticket number');
  }
  return parent;
}

async function readVerdict(pr, { github, repo, env, fetchImpl, commentCache, parentCache, budget }) {
  if (typeof pr.title !== 'string' || typeof pr.user?.login !== 'string') throw new Error('Invalid PR metadata');
  const files = await githubPages(github, `repos/${repo}/pulls/${pr.number}/files`);
  if (files.some((file) => typeof file.filename !== 'string' || typeof file.status !== 'string') ||
    (Number.isInteger(pr.changed_files) && files.length !== pr.changed_files)) {
    throw new Error('Incomplete PR file list');
  }
  let productionModes;
  const sources = Object.create(null);
  if (files.some((file) => FLAG_DEFINITION.test(file.filename) && file.status === 'removed')) {
    try { productionModes = JSON.parse(readProductionFile(PRODUCTION_MODES)); } catch { /* Missing modes never exempt. */ }
    for (const file of files) {
      if (file.filename.startsWith('src/') || file.filename === PRODUCTION_MODES || file.filename === '.github/scripts/agent-scope/agent-scope-exceptions.json') sources[file.filename] = readProductionFile(file.filename);
    }
  }
  const input = { title: pr.title, author: pr.user.login, files, productionModes, sources };
  const preliminary = evaluate(input);
  const ticket = ticketFromTitle(pr.title);
  if (preliminary.state === 'success' || !ticket) return preliminary;
  if (!commentCache.has(ticket.key)) {
    commentCache.set(ticket.key, readComments(ticket.key, { env, fetchImpl, budget }));
  }
  const comments = await commentCache.get(ticket.key);
  const verdict = evaluate({ ...input, comments });
  if (verdict.state === 'success') return verdict;
  if (!parentCache.has(ticket.key)) {
    parentCache.set(ticket.key, readParentTicket(ticket.key, { env, fetchImpl, budget }));
  }
  const parent = await parentCache.get(ticket.key);
  if (!parent) return verdict;
  if (!commentCache.has(parent)) {
    commentCache.set(parent, readComments(parent, { env, fetchImpl, budget }));
  }
  return evaluate({ ...input, comments, parentComments: await commentCache.get(parent) });
}

export async function run(args, options = {}) {
  try {
    return await runGate(args, options);
  } catch (error) {
    if (!error.rateLimited) throw error;
    (options.log ?? console.log)(`::warning::${error.message}`);
    return error.exitCode ?? 0;
  }
}

async function runGate(args, { env = process.env, fetchImpl = fetch, github, log = console.log, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let reconcile = false;
  let number;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--reconcile' && !reconcile) reconcile = true;
    else if (args[index] === '--pr' && number == null && /^[1-9]\d*$/.test(args[index + 1] ?? '')) number = Number(args[++index]);
    else throw new Error('Usage: ux-signoff-gate.mjs [--reconcile] [--pr <number>]');
  }
  if (!reconcile && number == null) throw new Error('Read-only mode requires --pr <number>');
  const repo = env.REPO || env.GITHUB_REPOSITORY || 'hypertask-ai/hypertask';
  const runUrl = env.RUN_URL || `https://github.com/${repo}/actions${env.GITHUB_RUN_ID ? `/runs/${env.GITHUB_RUN_ID}` : ''}`;
  const commentCache = new Map();
  const parentCache = new Map();
  github ??= createGithub({ env, fetchImpl, now, sleep: async (ms) => {
    commentCache.clear();
    parentCache.clear();
    await sleep(ms);
  } });
  const options = { github, repo, env, fetchImpl, commentCache, parentCache, budget: { remaining: READ_BUDGET, stopped: false } };
  if (!reconcile) {
    const pr = await github(`repos/${repo}/pulls/${number}`);
    const verdict = await readVerdict(pr, options);
    log(JSON.stringify(verdict, null, 2));
    return verdict.state === 'success' ? 0 : 1;
  }

  const openPrs = await githubPages(github, `repos/${repo}/pulls?state=open&base=production`);
  // The ux-signoff status on each head is the sweep cursor: oldest-evaluated heads (no status first) spend the read budget first.
  const statusCache = new Map();
  const lastEvaluated = async (pr) => {
    const statuses = await githubPages(github, `repos/${repo}/commits/${pr.head?.sha}/statuses`).catch((error) => {
      if (error.rateLimited) throw error;
      return null;
    });
    if (statuses) statusCache.set(pr.head?.sha, statuses);
    const newestStatus = statuses?.find((status) => status.context === CONTEXT);
    // A deferred placeholder means the head was never evaluated, so it keeps first place.
    const time = newestStatus?.description === DEFERRED ? NaN : Date.parse(newestStatus?.updated_at);
    return Number.isNaN(time) ? -Infinity : time;
  };
  const targets = number == null ? openPrs : openPrs.filter((pr) => pr.number === number);
  const order = [];
  for (const pr of targets) order.push({ pr, time: await lastEvaluated(pr) });
  const prs = order.sort((a, b) => (a.time === b.time ? 0 : a.time < b.time ? -1 : 1)).map(({ pr }) => pr);
  let errors = false;
  for (const listed of prs) {
    try {
      let pr = await github(`repos/${repo}/pulls/${listed.number}`);
      for (let attempt = 0; attempt < 3; attempt++) {
        if (pr.state !== 'open' || pr.base?.ref !== 'production') break;
        let verdict;
        let deferred = false;
        try {
          verdict = await readVerdict(pr, options);
        } catch (error) {
          if (error.rateLimited) throw error;
          if (error.deferred) {
            log(JSON.stringify({ pr: pr.number, state: 'deferred', description: error.message }));
            // Out of read budget: an evaluated head keeps its verdict until its turn comes, a new head gets pending.
            // Hypertask failing (429/5xx): every unread head goes pending, so a withdrawn yes never stays green.
            deferred = !options.budget.stopped;
            verdict = { state: 'pending', description: DEFERRED, details: [] };
          } else verdict = { state: 'error', description: env.MCP_TOKEN ? READ_ERROR : 'HYPERTASK_MCP_TOKEN is empty; configure it for UI signoff', details: [] };
        }
        if (verdict.state === 'error') errors = true;
        if (!/^[a-f0-9]{40}$/.test(pr.head?.sha ?? '')) throw new Error('No PR head SHA to publish');
        // The serialized workflow owns this context; reuse the cursor read for unchanged heads.
        const statuses = statusCache.get(pr.head.sha) ?? await githubPages(github, `repos/${repo}/commits/${pr.head.sha}/statuses`, { noWait: true });
        const newestStatus = statuses.find((status) => status.context === CONTEXT);
        // Keep the head read immediately before publication, including error verdicts.
        const current = await github(`repos/${repo}/pulls/${pr.number}`, { noWait: true });
        if (current.state !== 'open' || current.base?.ref !== 'production') break;
        if (current.head?.sha !== pr.head.sha || current.title !== pr.title || current.base?.sha !== pr.base?.sha) {
          pr = current;
          if (attempt === 2) log(JSON.stringify({ pr: pr.number, state: 'deferred', description: 'PR kept changing; left untouched this run' }));
          continue;
        }
        if (deferred && newestStatus) break;
        // Unchanged verdicts are re-posted hourly so the cursor moves while statuses per head stay bounded.
        const stale = Date.parse(newestStatus?.updated_at) < now() - HEARTBEAT_MS;
        if (stale || newestStatus?.state !== verdict.state || newestStatus?.description !== verdict.description) {
          await github(`repos/${repo}/statuses/${pr.head.sha}`, {
            method: 'POST', body: {
              context: CONTEXT, state: verdict.state, description: verdict.description,
              target_url: ticketUrl(pr.title, runUrl),
            },
          });
          statusCache.delete(pr.head.sha);
        }
        log(JSON.stringify({ pr: pr.number, ...verdict }, null, 2));
        break;
      }
    } catch (error) {
      if (error.rateLimited) {
        error.exitCode = errors ? 2 : 0;
        throw error;
      }
      errors = true;
      const reason = /^GitHub API returned (HTTP \d+|no list)$/.test(error?.message) || error?.message === 'No PR head SHA to publish'
        ? error.message : 'unexpected error';
      log(JSON.stringify({ pr: listed.number, state: 'error', description: 'Could not read or publish UX signoff status; left untouched', reason }));
    }
  }
  return errors ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    // Do not echo response bodies or gh stderr, which may contain credentials.
    const description = error.code ? 'Could not read GitHub data' : error.message;
    console.log(JSON.stringify({ state: 'error', description, details: [] }, null, 2));
    process.exitCode = 2;
  }
}
