'use strict';

function isAppPath(file) {
  return file.startsWith('src/') || file.startsWith('e2e/') || file.startsWith('public/');
}

function surfaceOf(paths) {
  return (paths ?? []).some(isAppPath) ? 'app' : 'check';
}

function safeRoute(route) {
  return typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') && !route.includes('\\') && route.length < 200;
}

function pathNeedles(body) {
  const needles = [];
  const pattern = /`((?:src|e2e|public)\/[^`\s]+)`/g;
  let match;
  while ((match = pattern.exec(String(body ?? '')))) needles.push(match[1].replace(/[),.;:]+$/, ''));
  return needles;
}

function pathHits(changed, needle) {
  if (changed === needle) return true;
  const slash = needle.lastIndexOf('/');
  if (slash <= 0) return false;
  return changed.startsWith(needle.slice(0, slash + 1));
}

function routeFromMap(body) {
  const match = String(body ?? '').match(/https:\/\/app\.hypertask\.ai(\/[^)\s`]+)/);
  if (!match) return '/';
  const route = match[1].replace(/[.,]+$/, '');
  return safeRoute(route) ? route : '/';
}

function driveTargets(paths, maps) {
  const appPaths = (paths ?? []).filter(isAppPath);
  if (!appPaths.length) return [];
  const ranked = [];
  for (const map of maps ?? []) {
    const needles = pathNeedles(map.body);
    let score = 0;
    for (const file of appPaths) {
      if (needles.some(needle => pathHits(file, needle))) score += 10;
    }
    if (score > 0) ranked.push({ area: map.area, file: map.file, route: routeFromMap(map.body), score });
  }
  ranked.sort((left, right) => right.score - left.score || left.area.localeCompare(right.area));
  const top = ranked[0]?.score ?? 0;
  return ranked.filter(item => item.score === top).slice(0, 3).map(({ area, file, route }) => ({ area, file, route }));
}

module.exports = { isAppPath, surfaceOf, safeRoute, driveTargets };
