const test = require('node:test'), assert = require('node:assert/strict'), { readFileSync } = require('node:fs'), path = require('node:path'), yaml = require('js-yaml')
const root = path.resolve(__dirname, '..'), mod = require('./helpers/loadModule.cjs').loadModule(path.join(root, 'e2e/smoke/lib/mobile-design.ts'))
const baseline = JSON.parse(readFileSync(path.join(root, 'e2e/smoke/__snapshots__/mobile-design.baseline.json'), 'utf8'))
const el = (o = {}) => ({ key: 'div:0>button:0', tag: 'button', role: 'button', label: 'Action', cls: '', w: 48, h: 48, x: 16, y: 16, disabled: false, interactive: true, display: 'inline-block', textField: false, contenteditable: false, fontSize: null, radius: '4px', radiusBad: false, visibleSurface: true, roundMarker: false, outsideX: false, inHScroller: false, clippedByAncestor: false, textClipped: false, ellipsis: false, proseLink: false, scrollW: 48, clientW: 48, ...o })
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
    ['tap-target', 'inbox', m({ elements: [el({ tag: 'a', role: '', label: 'Icon link', display: 'inline', w: 16, h: 16, proseLink: false })] }), 'Icon link'],
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
  const drift = m({ elements: [el({ key: 'd:1', stableId: 'div:Column 7', label: 'Column 7', w: 20, h: 20 })] }), driftBase = { screens: { inbox: { porcelain: { 'tap-target': ['div:Column 1', 'div:Column 2'] } } } }
  assert.deepEqual(mod.evaluateMobileDesign('inbox', 'porcelain', drift, driftBase).failures, [], 'a changed count keeps the identity')
  assert.equal(mod.evaluateMobileDesign('inbox', 'porcelain', m({ elements: [el({ key: 'd:2', stableId: 'button#task-2', label: 'Task', w: 20, h: 20 })] }), { screens: { inbox: { porcelain: { 'tap-target': ['button#task-1'] } } } }).failures.length, 1, 'a stable element id keeps its digits')
  for (const [tag, attrs, exp] of [['select', {}, false], ['button', { role: 'combobox' }, false], ['input', { type: 'checkbox' }, false], ['input', { type: 'text' }, true], ['input', { type: 'search' }, true], ['textarea', {}, true], ['div', { contenteditable: 'true' }, true], ['div', { role: 'textbox' }, true]]) assert.equal(mod.classifyTextField(tag, attrs).is, exp, tag)
  for (const screen of mod.MOBILE_SCREENS) assert.ok(screen.ready, `${screen.id} has no readiness landmark`)
  assert.deepEqual(mod.evaluateMobileDesign('inbox', 'porcelain', m({ elements: [el({ label: 'Card surface', interactive: false, w: 120, h: 20 }), el({ tag: 'a', role: '', label: 'inline prose link', display: 'inline', w: 60, h: 20, proseLink: true })] }), null, true).failures, [])
  const dupes = mod.evaluateMobileDesign('board-kanban', 'porcelain', m({ radii: [{ key: 'a', label: 'Card', radius: '8px' }, { key: 'b', label: 'Card', radius: '8px' }], clips: [{ key: 'c', label: 'Row', scrollW: 200, clientW: 100 }, { key: 'd', label: 'Row', scrollW: 200, clientW: 100 }], purple: [{ key: 'p1', label: 'Chip', hits: ['bg rgb(168, 85, 247)'], ai: false }, { key: 'p2', label: 'Chip', hits: ['bg rgb(168, 85, 247)'], ai: false }] }), null, true)
  assert.deepEqual(dupes.idsByRule['radius'], ['radius:Card']); assert.deepEqual(dupes.idsByRule['overflow-x'], ['clip:Row']); assert.deepEqual(dupes.idsByRule['purple-non-ai'], ['purple:Chip'], 'a surface repeated by data is one identity, so a row count cannot invent a defect')
  const passive = mod.evaluateMobileDesign('board-kanban', 'porcelain', m({ elements: [el({ label: 'Tap target' })], radii: [{ label: 'Card surface', radius: '8px' }], clips: [{ label: 'Row label', scrollW: 240, clientW: 160 }] }), null, true)
  assert.ok(passive.failures.some((f) => f.includes('rule=radius') && f.includes('Card surface')), passive.failures.join('\n'))
  assert.ok(passive.failures.some((f) => f.includes('rule=overflow-x') && f.includes('Row label')), passive.failures.join('\n'))
  assert.ok(!passive.failures.some((f) => f.includes('rule=tap-target')), 'a compliant tap target must not be flagged')
  assert.deepEqual(mod.evaluateMobileDesign('board-kanban', 'porcelain', m({ elements: [el({ key: 'r:1', stableId: 'button[aria=Delete]', label: 'Delete', w: 20, h: 20 }), el({ key: 'r:2', stableId: 'button[aria=Delete]', label: 'Delete', w: 20, h: 20 }), el({ key: 'r:3', stableId: 'button[aria=Archive]', label: 'Archive', w: 20, h: 20 })] }), null, true).idsByRule['tap-target'], ['button[aria=Archive]', 'button[aria=Delete]'], 'one identity per structural element, and a different control is still a new one')
  const repeatedRows = mod.evaluateMobileDesign('inbox', 'porcelain', m({ radii: [{ key: 'row:1>span:0', stableId: 'li[row]>span:0', label: 'Badge', radius: '999px' }, { key: 'row:2>span:0', stableId: 'li[row]>span:0', label: 'Badge', radius: '999px' }] }), { screens: { inbox: { porcelain: { radius: ['li[row]>span:0'] } } } })
  assert.deepEqual(repeatedRows.failures, [], 'a second data row repeating an allowed surface stays allowed')
})
test('mobile-verify workflow follows CI contract and gates on prod-health-gate', async () => {
  const wf = yaml.load(readFileSync(path.join(root, '.github/workflows/mobile-verify.yml'), 'utf8')), steps = wf.jobs['mobile-verify'].steps, gateStep = steps.find((s) => s.id === 'gate'), pwStep = steps.find((s) => /playwright test/.test(s.run || ''))
  assert.equal(wf.concurrency.group, 'mobile-verify'); assert.equal(wf.concurrency['cancel-in-progress'], yaml.load(readFileSync(path.join(root, 'docs/ci-policy.yml'), 'utf8')).policies.concurrency.cancel_production_push_runs, 'production pushes queue, never cancel'); assert.equal(wf.jobs['mobile-verify']['runs-on'], 'ubuntu-latest')
  assert.match(gateStep.run, /wait-prod-health-gate\.mjs/); assert.equal(gateStep.if, "inputs.mode != 'refresh' && inputs.mode != 'dry-run'", 'only a manual dry-run or refresh skips the release verdict'); assert.equal(pwStep.if, "steps.gate.outcome == 'success' || steps.gate.outcome == 'skipped'", 'the suites run only after the gate step, and a failed gate stops the job'); assert.equal(pwStep.env.MOBILE_DESIGN_UPDATE, '${{ inputs.mode == \'refresh\' && \'1\' || \'0\' }}'); assert.match(pwStep.run, /--project=mobile-design/); assert.match(pwStep.run, /--project=mobile-journeys/)
  assert.ok(!JSON.stringify(pwStep.env).includes('7049'), 'the phone audit must not walk the live QA board')
  const { waitForProdHealthGate } = await import(path.join(root, '.github/scripts/wait-prod-health-gate.mjs')), mkFetch = (runs, statuses, deployments = []) => async (u) => ({ ok: true, json: async () => (u.includes('/runs?') ? { workflow_runs: runs } : u.includes('/deployments?') ? deployments : statuses) })
  assert.equal((await waitForProdHealthGate({ eventName: 'workflow_dispatch', repo: 'o/r', sha: 'abc', token: 't' })).ok, true)
  assert.equal((await waitForProdHealthGate({ eventName: 'push', repo: 'o/r', sha: 's1', token: 't', maxPolls: 2, pollMs: 0, sleep: async () => {}, fetchImpl: mkFetch([{ id: 77, status: 'in_progress', created_at: '2026-11-23T10:00:00Z' }], [{ context: 'prod-health-gate', state: 'success', target_url: 'https://github.com/o/r/actions/runs/77', created_at: '2026-11-23T10:02:00Z' }]) })).ok, true)
  const stale = await waitForProdHealthGate({ eventName: 'push', repo: 'o/r', sha: 's1', token: 't', maxPolls: 2, pollMs: 0, sleep: async () => {}, fetchImpl: mkFetch([{ id: 88, status: 'completed', conclusion: 'success', created_at: '2026-11-23T11:00:00Z' }], [{ context: 'prod-health-gate', state: 'success', target_url: 'https://github.com/o/r/actions/runs/77', created_at: '2026-11-23T10:02:00Z' }]) })
  assert.equal(stale.ok, false); assert.equal(stale.unreadable, false)
  const invalidated = await waitForProdHealthGate({ eventName: 'push', repo: 'o/r', sha: 's1', token: 't', maxPolls: 2, pollMs: 0, sleep: async () => {}, fetchImpl: mkFetch([{ id: 77, status: 'in_progress', created_at: '2026-11-23T10:00:00Z' }], [{ context: 'prod-health-gate', state: 'success', target_url: 'https://github.com/o/r/actions/runs/77', created_at: '2026-11-23T10:02:00Z' }, { context: 'prod-health-gate', state: 'failure', created_at: '2026-11-23T10:30:00Z' }]) })
  assert.equal(invalidated.ok, false, 'a later invalidation without a target_url must fail the gate'); assert.equal(invalidated.unreadable, false)
  let statusPolls = 0; const racing = async (u) => ({ ok: true, json: async () => (u.includes('/runs?') ? { workflow_runs: [{ id: 99, status: 'completed', created_at: '2026-11-23T12:00:00Z' }] } : (++statusPolls > 1 ? [{ context: 'prod-health-gate', state: 'success', target_url: 'https://github.com/o/r/actions/runs/99', created_at: '2026-11-23T12:01:00Z' }] : [])) }); assert.equal((await waitForProdHealthGate({ eventName: 'push', repo: 'o/r', sha: 's1', token: 't', maxPolls: 4, pollMs: 0, sleep: async () => {}, fetchImpl: racing })).ok, true, 'a completed run must keep polling until its status is visible')
  const unreadable = await waitForProdHealthGate({ eventName: 'push', repo: 'o/r', sha: 's1', token: 't', maxPolls: 1, pollMs: 0, sleep: async () => {}, fetchImpl: async () => ({ ok: false }) })
  assert.equal(unreadable.ok, false); assert.equal(unreadable.unreadable, true)
  const { gateOutcome } = await import(path.join(root, '.github/scripts/wait-prod-health-gate.mjs'))
  assert.deepEqual(gateOutcome({ ok: true, unreadable: false, reason: 'prod-health-gate success' }), { level: 'info', code: 0, message: 'prod-health-gate success' })
  const skipped = gateOutcome(stale)
  assert.equal(skipped.level, 'error', 'a missing release stamp fails the job'); assert.equal(skipped.code, 1); assert.match(skipped.message, /did not run/)
  let clock = Date.parse('2026-11-23T12:00:00Z'); const tick = () => (clock += 60_000)
  const built = [{ id: 88, status: 'completed', conclusion: 'success', created_at: '2026-11-23T11:00:00Z' }]
  const noDeploy = await waitForProdHealthGate({ eventName: 'push', repo: 'o/r', sha: 's1', token: 't', maxPolls: 6, pollMs: 0, sleep: async () => {}, now: tick, fetchImpl: mkFetch(built, [], []) })
  const notRun = gateOutcome(noDeploy)
  assert.equal(noDeploy.notDeployed, true, 'an ignored build has no release to verify'); assert.equal(notRun.code, 0); assert.equal(notRun.level, 'notice'); assert.match(notRun.message, /no release verdict/)
  const shipped = await waitForProdHealthGate({ eventName: 'push', repo: 'o/r', sha: 's1', token: 't', maxPolls: 6, pollMs: 0, sleep: async () => {}, now: tick, fetchImpl: mkFetch(built, [], [{ environment: 'Production' }]) })
  assert.equal(shipped.notDeployed, undefined, 'a built release that published no verdict is a failure, not a skip'); assert.equal(gateOutcome(shipped).code, 1)
})
