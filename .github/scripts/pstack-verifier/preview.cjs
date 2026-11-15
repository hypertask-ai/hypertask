'use strict';

const PRODUCTION_APP = 'https://app.hypertask.ai';
const PROJECT_ID = 'prj_oEok2iMNFPzj6AWe1KQBaIAcPaAf';
const TEAM_ID = 'team_yureFlJZ6ibwebaOOkKc5whs';
function httpsOrigin(value) {
  if (!value) return null;
  const raw = String(value).startsWith('http') ? String(value) : `https://${value}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
function allowedAppUrl(value) {
  const origin = httpsOrigin(value);
  if (!origin) return false;
  const host = new URL(origin).host;
  return host === 'app.hypertask.ai' || host.endsWith('.vercel.app');
}
function parentUrl(baseRef) {
  return baseRef === 'production' ? PRODUCTION_APP : null;
}
function deploymentQuery(sha) {
  const query = new URLSearchParams({ projectId: PROJECT_ID, teamId: TEAM_ID, sha, state: 'READY', limit: '5' });
  return `/v7/deployments?${query}`;
}
function previewFromDeployments(deployments, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return null;
  for (const item of deployments ?? []) {
    if (!item || item.state !== 'READY') continue;
    const commit = item.meta?.githubCommitSha || item.meta?.gitCommitSha || item.sha;
    if (commit !== sha) continue;
    const origin = httpsOrigin(item.url || item.alias?.[0]);
    if (allowedAppUrl(origin)) return origin;
  }
  return null;
}
function previewFromStatuses({ deploymentStatuses = [], commitStatuses = [] } = {}) {
  for (const status of [...deploymentStatuses, ...commitStatuses]) {
    if (status?.state !== 'success') continue;
    const origin = httpsOrigin(status.environment_url || status.target_url);
    if (allowedAppUrl(origin) && new URL(origin).host.endsWith('.vercel.app')) return origin;
  }
  return null;
}

function landingsAllowPass(observations) {
  return Array.isArray(observations)
    && observations.length > 0
    && observations.every(item => item?.ok === true && allowedAppUrl(item.base) && !String(item.finalPath || '').startsWith('/login') && !String(item.finalPath || '').startsWith('/qa/login'));
}

async function headPreview(sha, { fetchImpl = globalThis.fetch, token = process.env.VERCEL_TOKEN || '' } = {}) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return { url: null, reason: 'The head sha is not 40 hex, so the preview was not looked up.' };
  if (!token) return { url: null, reason: 'VERCEL_TOKEN is empty, so the head preview was not looked up.' };
  let response;
  try {
    response = await fetchImpl(`https://api.vercel.com${deploymentQuery(sha)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { url: null, reason: 'The preview lookup did not answer.' };
  }
  if (!response.ok) return { url: null, reason: `The preview lookup answered ${response.status}.` };
  let body;
  try {
    body = await response.json();
  } catch {
    return { url: null, reason: 'The preview lookup was not JSON.' };
  }
  const url = previewFromDeployments(body.deployments, sha);
  return url ? { url, reason: '' } : { url: null, reason: 'No READY preview deployment matches this head.' };
}

module.exports = {
  PRODUCTION_APP,
  parentUrl,
  allowedAppUrl,
  deploymentQuery,
  previewFromDeployments,
  previewFromStatuses,
  landingsAllowPass,
  headPreview,
};
