'use strict';

const VERDICTS = Object.freeze(['PASS', 'PASS+NOTES', 'FAIL']);
const VERIFIER_FAMILIES = Object.freeze(['deepseek', 'codex', 'claude']);
const PLAN_SECRETS = Object.freeze({
  deepseek: 'OPENCODE_API_KEY',
  claude: 'CLAUDE_CODE_OAUTH_TOKEN',
});
const ABSENT_PLAN_SECRETS = Object.freeze(['CODEX_API_KEY']);
const AUTHOR_FAMILY = /^[a-z][a-z0-9-]{0,31}$/;

function trailerBlock(message) {
  const lines = String(message ?? '').replace(/\r\n/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  let blank = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() === '') {
      blank = index;
      break;
    }
  }
  if (blank < 0) return [];
  return lines.slice(blank + 1).map(line => line.trim()).filter(Boolean);
}

function authorFamilyFromMessage(message) {
  const values = [];
  for (const line of trailerBlock(message)) {
    const match = /^Author-Family:\s*(\S+)\s*$/.exec(line);
    if (!match) continue;
    values.push(match[1].toLowerCase());
  }
  if (values.length !== 1 || !AUTHOR_FAMILY.test(values[0])) return { known: false, families: [] };
  return { known: true, families: [values[0]] };
}

function authorFamilyFromMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return { known: false, families: [] };
  const families = [];
  for (const message of messages) {
    const one = authorFamilyFromMessage(message);
    if (!one.known) return { known: false, families: [] };
    families.push(one.families[0]);
  }
  return { known: true, families: [...new Set(families)] };
}

function manualAuthorFamily(value) {
  const family = String(value ?? '').trim().toLowerCase();
  if (!family || !AUTHOR_FAMILY.test(family)) return { known: false, families: [] };
  return { known: true, families: [family] };
}

function manualForEvent(eventName, authorFamily) {
  if (eventName !== 'workflow_dispatch') return '';
  return authorFamily ?? '';
}

function resolveAuthorFamily({ messages, manual, eventName } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const fromCommits = authorFamilyFromMessages(list);
  if (fromCommits.known) return { known: true, families: fromCommits.families, source: 'trailer' };
  if (list.some(message => authorFamilyFromMessage(message).known)) {
    return { known: false, families: [], source: 'trailer' };
  }
  const fromManual = manualAuthorFamily(manualForEvent(eventName, manual));
  if (fromManual.known) return { known: true, families: fromManual.families, source: 'manual' };
  return { known: false, families: [], source: 'none' };
}

function planReadiness({ deepseek = false, claude = false } = {}) {
  return {
    deepseek: deepseek === true || deepseek === 'true',
    codex: false,
    claude: claude === true || claude === 'true',
  };
}

function familiesToTry({ known, families, ready }) {
  if (!known || !ready) return [];
  const skip = new Set((families ?? []).filter(family => VERIFIER_FAMILIES.includes(family)));
  return VERIFIER_FAMILIES.filter(family => !skip.has(family) && ready[family] === true);
}

async function firstVerdict(order, ask) {
  const tried = [];
  for (const family of order) {
    const result = await ask(family);
    tried.push({ family, out: result?.out === true, failed: result?.failed === true });
    if (result?.verdict) return { family, verdict: result.verdict, tried };
  }
  return { family: null, verdict: null, tried };
}

function verdictLine(verdict, sha) {
  if (!VERDICTS.includes(verdict)) throw new Error('bad verdict');
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('bad sha');
  return `pstack-verifier: ${verdict} @ ${sha}`;
}

function verdictCounts(firstLine, headSha) {
  const match = /^pstack-verifier: (PASS\+NOTES|PASS|FAIL) @ ([0-9a-f]{40})$/.exec(String(firstLine ?? ''));
  return Boolean(match) && match[2] === headSha;
}

function publishAllowed(verifiedSha, currentSha) {
  return /^[0-9a-f]{40}$/.test(verifiedSha ?? '') && verifiedSha === currentSha;
}

function checkConclusion(verdict) {
  if (verdict === 'FAIL') return 'failure';
  if (verdict === 'PASS' || verdict === 'PASS+NOTES') return 'success';
  throw new Error('bad verdict');
}

function publicNote(text) {
  return String(text ?? '')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function makeVerdict(record) {
  const line = verdictLine(record.verdict, record.headSha);
  const notes = publicNote(record.notes);
  if (!notes) throw new Error('notes');
  if (typeof record.authorFamily !== 'string' || !record.authorFamily.trim()) throw new Error('author family');
  const driven = (Array.isArray(record.driven) ? record.driven : [record.driven]).map(item => publicNote(item)).filter(Boolean);
  const evidenceLinks = (record.evidenceLinks ?? []).map(item => String(item)).filter(item => /^https:\/\//.test(item));
  return {
    headSha: record.headSha,
    verdict: record.verdict,
    notes,
    authorFamily: record.authorFamily.trim(),
    verifierFamily: record.verifierFamily ? String(record.verifierFamily) : null,
    driven,
    evidenceLinks,
    line,
  };
}

function commentBody(record) {
  const verdict = makeVerdict(record);
  const lines = [
    verdict.line,
    '',
    `author-family: ${verdict.authorFamily}`,
    `verifier-family: ${verdict.verifierFamily ?? 'none'}`,
    `driven: ${verdict.driven.join(', ') || 'none'}`,
    `notes: ${verdict.notes}`,
  ];
  if (verdict.evidenceLinks.length) lines.push('evidence:', ...verdict.evidenceLinks);
  else lines.push('evidence: none');
  return lines.join('\n');
}

module.exports = {
  VERDICTS,
  VERIFIER_FAMILIES,
  PLAN_SECRETS,
  ABSENT_PLAN_SECRETS,
  authorFamilyFromMessage,
  authorFamilyFromMessages,
  manualAuthorFamily,
  manualForEvent,
  resolveAuthorFamily,
  planReadiness,
  familiesToTry,
  firstVerdict,
  verdictLine,
  verdictCounts,
  publishAllowed,
  checkConclusion,
  publicNote,
  makeVerdict,
  commentBody,
};
