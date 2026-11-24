const test = require('node:test'), assert = require('node:assert/strict'), { readFileSync } = require('node:fs'), path = require('node:path'), yaml = require('js-yaml')
const root = path.resolve(__dirname, '..'), mod = require('./helpers/loadModule.cjs').loadModule(path.join(root, 'e2e/smoke/lib/mobile-design.ts'))
const baseline = JSON.parse(readFileSync(path.join(root, 'e2e/smoke/__snapshots__/mobile-design.baseline.json'), 'utf8'))
const el = (o = {}) => ({ key: 'div:0>button:0', tag: 'button', role: 'button', label: 'Action', cls: '', w: 48, h: 48, x: 16, y: 16, disabled: false, interactive: true, display: 'inline-block', textField: false, contenteditable: false, fontSize: null, radius: '4px', radiusBad: false, visibleSurface: true, roundMarker: false, outsideX: false, inHScroller: false, clippedByAncestor: false, textClipped: false, ellipsis: false, scrollW: 48, clientW: 48, ...o })
const m = (o = {}) => ({ coarsePointer: true, docOverflowX: 0, elements: [], textFields: [], purple: [], radii: [], clips: [], ...o })
test('every mobile design rule fails on a real defect naming screen, element, and rule', () => {
  const cases = [
    ['tap-target', 'ai-chat-full', m({ elements: [el({ label: 'Copy message', w: 14, h: 14 })] }), 'Copy message'],
    ['radius', 'board-kanban', m({ elements: [el({ label: 'Ask AI', w: 40, h: 40, radius: '999px', radiusBad: true })] }), 'Ask AI'],
    ['input-font', 'ai-chat-full', m({ elements: [el({ tag: 'div', role: 'textbox', label: 'div.tiptap', cls: 'tiptap ProseMirror', textField: true, contenteditable: true, fontSize: 14 })] }), 'div.tiptap'],
    ['overflow-x', 'board-table', m({ docOverflowX: 24, elements: [el({ label: 'Wide button', x: 370, w: 60, outsideX: true })] }), 'document'],
    ['purple-non-ai', 'inbox', m({ purple: [{ key: 'div:1', label: 'Archive button', hits: ['bg rgb(168, 85, 247)'], ai: false }] }), 'Archive button'],
    ['mic-action', 'commands-new-task', m({ textFields: [{ key: 'textarea:0', label: 'Describe the task', kind: 'multiline', disabled: false, x: 16, y: 80, w: 300, h: 80, micFound: true, micLabel: 'Start dictation', micW: 18, micH: 32, micBgAlpha: 0, micRightBound: true, micIsPrimaryRight: false }] }), 'Start dictation'],
    ['mic-action', 'search', m({ textFields: [{ key: 'input:0', label: 'Search tasks', kind: 'search', disabled: false, x: 16, y: 80, w: 300, h: 40, micFound: false, micLabel: '', micW: 0, micH: 0, micBgAlpha: 0, micRightBound: false, micIsPrimaryRight: false }] }), 'Search tasks'],
    ['tap-target', 'task-detail', m({ elements: [el({ tag: 'a', role: '', label: 'Tiny link', display: 'inline-block', w: 10, h: 10 })] }), 'Tiny link'],
    ['radius', 'board-kanban', m({ radii: [{ stableId: 'div[aria=Card surface]', label: 'Card surface', radius: '8px' }] }), 'Card surface'],
    ['overflow-x', 'board-table', m({ clips: [{ stableId: 'div[aria=Row label]', label: 'Row label', scrollW: 240, clientW: 160 }] }), 'Row label'],
  ]
  for (const [rule, screen, metrics, expected] of cases) { const res = mod.evaluateMobileDesign(screen, 'porcelain', metrics, null, true); assert.ok(res.failures.some((f) => f.includes(screen) && f.includes(`rule=${rule}`) && f.includes(expected)), `${rule}: ${res.failures.join('\n')}`) }
})
test('mobile design ratchet compares stable violation identities and catches substitutions', () => {
  assert.equal(baseline.touchEmulation, true); assert.deepEqual(baseline.viewport, { width: 390, height: 844 }); assert.deepEqual(baseline.themes, ['porcelain', 'graphite', 'amoled', 'dia'])
  const allowedIds = baseline.screens['board-kanban'].porcelain['tap-target']; assert.ok(Array.isArray(allowedIds) && allowedIds.length > 0)
  const atBase = m({ elements: allowedIds.map((stableId, i) => el({ key: `b:${i}`, stableId, label: `Btn ${i}`, w: 32, h: 32 })) })
  assert.deepEqual(mod.evaluateMobileDesign('board-kanban', 'porcelain', atBase, baseline).failures, [])
  const res = mod.evaluateMobileDesign('board-kanban', 'porcelain', m({ elements: [...atBase.elements.slice(1), el({ key: 'b:new', stableId: 'button[aria=New tiny icon]', label: 'New tiny icon', w: 20, h: 20 })] }), baseline)
  assert.equal(res.failures.length, 1); assert.match(res.failures[0], /board-kanban.*rule=tap-target.*New tiny icon/)
  for (const [tag, attrs, exp] of [['select', {}, false], ['button', { role: 'combobox' }, false], ['input', { type: 'checkbox' }, false], ['input', { type: 'text' }, true], ['input', { type: 'search' }, true], ['textarea', {}, true], ['div', { contenteditable: 'true' }, true], ['div', { role: 'textbox' }, true]]) assert.equal(mod.classifyTextField(tag, attrs).is, exp, tag)
  for (const screen of mod.MOBILE_SCREENS) assert.ok(screen.ready, `${screen.id} has no readiness landmark`)
  assert.deepEqual(mod.evaluateMobileDesign('inbox', 'porcelain', m({ elements: [el({ label: 'Card surface', interactive: false, w: 120, h: 20 }), el({ tag: 'a', role: '', label: 'inline prose link', display: 'inline', w: 60, h: 20 })] }), null, true).failures, [])
  const passive = mod.evaluateMobileDesign('board-kanban', 'porcelain', m({ elements: [el({ label: 'Tap target' })], radii: [{ label: 'Card surface', radius: '8px' }], clips: [{ label: 'Row label', scrollW: 240, clientW: 160 }] }), null, true)
  assert.ok(passive.failures.some((f) => f.includes('rule=radius') && f.includes('Card surface')), passive.failures.join('\n'))
  assert.ok(passive.failures.some((f) => f.includes('rule=overflow-x') && f.includes('Row label')), passive.failures.join('\n'))
  assert.ok(!passive.failures.some((f) => f.includes('rule=tap-target')), 'a compliant tap target must not be flagged')
})
test('mobile-verify workflow follows CI contract and gates on prod-health-gate', async () => {
  const wf = yaml.load(readFileSync(path.join(root, '.github/workflows/mobile-verify.yml'), 'utf8')), steps = wf.jobs['mobile-verify'].steps, gateStep = steps.find((s) => s.id === 'gate'), pwStep = steps.find((s) => /playwright test/.test(s.run || ''))
  assert.equal(wf.concurrency.group, 'mobile-verify'); assert.equal(wf.concurrency['cancel-in-progress'], true); assert.equal(wf.jobs['mobile-verify']['runs-on'], 'ubuntu-latest')
  assert.match(gateStep.run, /wait-prod-health-gate\.mjs/); assert.equal(pwStep.if, "steps.gate.outputs.ok == 'true'"); assert.match(pwStep.run, /--project=mobile-design/); assert.match(pwStep.run, /--project=mobile-journeys/)
  const { waitForProdHealthGate } = await import(path.join(root, '.github/scripts/wait-prod-health-gate.mjs')), mkFetch = (runs, statuses) => async (u) => ({ ok: true, json: async () => (u.includes('/runs?') ? { workflow_runs: runs } : statuses) })
  assert.equal((await waitForProdHealthGate({ eventName: 'workflow_dispatch', repo: 'o/r', sha: 'abc', token: 't' })).ok, true)
  assert.equal((await waitForProdHealthGate({ eventName: 'push', repo: 'o/r', sha: 's1', token: 't', maxPolls: 2, pollMs: 0, sleep: async () => {}, fetchImpl: mkFetch([{ id: 77, status: 'in_progress', created_at: '2026-11-23T10:00:00Z' }], [{ context: 'prod-health-gate', state: 'success', target_url: 'https://github.com/o/r/actions/runs/77', created_at: '2026-11-23T10:02:00Z' }]) })).ok, true)
  const stale = await waitForProdHealthGate({ eventName: 'push', repo: 'o/r', sha: 's1', token: 't', maxPolls: 2, pollMs: 0, sleep: async () => {}, fetchImpl: mkFetch([{ id: 88, status: 'completed', conclusion: 'success', created_at: '2026-11-23T11:00:00Z' }], [{ context: 'prod-health-gate', state: 'success', target_url: 'https://github.com/o/r/actions/runs/77', created_at: '2026-11-23T10:02:00Z' }]) })
  assert.equal(stale.ok, false); assert.equal(stale.unreadable, false)
  let statusPolls = 0; const racing = async (u) => ({ ok: true, json: async () => (u.includes('/runs?') ? { workflow_runs: [{ id: 99, status: 'completed', created_at: '2026-11-23T12:00:00Z' }] } : (++statusPolls > 1 ? [{ context: 'prod-health-gate', state: 'success', target_url: 'https://github.com/o/r/actions/runs/99', created_at: '2026-11-23T12:01:00Z' }] : [])) })
  assert.equal((await waitForProdHealthGate({ eventName: 'push', repo: 'o/r', sha: 's1', token: 't', maxPolls: 4, pollMs: 0, sleep: async () => {}, fetchImpl: racing })).ok, true, 'a completed run must keep polling until its status is visible')
  const unreadable = await waitForProdHealthGate({ eventName: 'push', repo: 'o/r', sha: 's1', token: 't', maxPolls: 1, pollMs: 0, sleep: async () => {}, fetchImpl: async () => ({ ok: false }) })
  assert.equal(unreadable.ok, false); assert.equal(unreadable.unreadable, true)
})
