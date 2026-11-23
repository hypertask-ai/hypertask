const test = require('node:test'), assert = require('node:assert/strict'), { readFileSync } = require('node:fs'), path = require('node:path'), yaml = require('js-yaml')
const root = path.resolve(__dirname, '..'), mod = require('./helpers/loadModule.cjs').loadModule(path.join(root, 'e2e/smoke/lib/mobile-design.ts'))
const baseline = JSON.parse(readFileSync(path.join(root, 'e2e/smoke/__snapshots__/mobile-design.baseline.json'), 'utf8'))
const el = (o = {}) => ({ key: 'div:0>button:0', tag: 'button', role: 'button', label: 'Action', cls: '', w: 48, h: 48, x: 16, y: 16, disabled: false, textField: false, contenteditable: false, fontSize: null, radius: '4px', radiusBad: false, visibleSurface: true, roundMarker: false, outsideX: false, inHScroller: false, clippedByAncestor: false, textClipped: false, ellipsis: false, scrollW: 48, clientW: 48, ...o })
const m = (o = {}) => ({ coarsePointer: true, docOverflowX: 0, elements: [], textFields: [], purple: [], ...o })

test('every mobile design rule fails on a real defect naming screen, element, and rule', () => {
  const cases = [
    ['tap-target', 'ai-chat-full', m({ elements: [el({ label: 'Copy message', w: 14, h: 14 })] }), 'Copy message'],
    ['radius', 'board-kanban', m({ elements: [el({ label: 'Ask AI', w: 40, h: 40, radius: '999px', radiusBad: true })] }), 'Ask AI'],
    ['input-font', 'ai-chat-full', m({ elements: [el({ tag: 'div', role: 'textbox', label: 'div.tiptap', cls: 'tiptap ProseMirror', textField: true, contenteditable: true, fontSize: 14 })] }), 'div.tiptap'],
    ['overflow-x', 'board-table', m({ docOverflowX: 24, elements: [el({ label: 'Wide button', x: 370, w: 60, outsideX: true })] }), 'document'],
    ['purple-non-ai', 'inbox', m({ purple: [{ key: 'div:1', label: 'Archive button', hits: ['bg rgb(168, 85, 247)'], ai: false }] }), 'Archive button'],
    ['mic-action', 'commands-new-task', m({ textFields: [{ key: 'textarea:0', label: 'Describe the task', kind: 'multiline', disabled: false, x: 16, y: 80, w: 300, h: 80, micFound: true, micLabel: 'Start dictation', micW: 18, micH: 32, micBgAlpha: 0, micRightBound: true, micIsPrimaryRight: false }] }), 'Start dictation'],
    ['mic-action', 'search', m({ textFields: [{ key: 'input:0', label: 'Search tasks', kind: 'search', disabled: false, x: 16, y: 80, w: 300, h: 40, micFound: false, micLabel: '', micW: 0, micH: 0, micBgAlpha: 0, micRightBound: false, micIsPrimaryRight: false }] }), 'Search tasks'],
  ]
  for (const [rule, screen, metrics, expected] of cases) {
    const res = mod.evaluateMobileDesign(screen, 'porcelain', metrics, null, true)
    assert.ok(res.failures.some((f) => f.includes(screen) && f.includes(`rule=${rule}`) && f.includes(expected)), `${rule}: ${res.failures.join('\n')}`)
  }
})
test('mobile design ratchet passes when baseline holds and fails on regression', () => {
  assert.equal(baseline.touchEmulation, true); assert.deepEqual(baseline.viewport, { width: 390, height: 844 }); assert.deepEqual(baseline.themes, ['porcelain', 'graphite', 'amoled', 'dia'])
  const allowed = baseline.screens['board-kanban'].porcelain['tap-target'], atBase = m({ elements: Array.from({ length: allowed }, (_, i) => el({ key: `b:${i}`, label: `Btn ${i}`, w: 32, h: 32 })) })
  assert.deepEqual(mod.evaluateMobileDesign('board-kanban', 'porcelain', atBase, baseline).failures, [])
  const regressed = mod.evaluateMobileDesign('board-kanban', 'porcelain', m({ elements: [...atBase.elements, el({ key: 'b:new', label: 'New tiny icon', w: 20, h: 20 })] }), baseline)
  assert.equal(regressed.failures.length, 1); assert.match(regressed.failures[0], /board-kanban.*rule=tap-target/)
})
test('mobile-verify workflow follows CI contract', () => {
  const wf = yaml.load(readFileSync(path.join(root, '.github/workflows/mobile-verify.yml'), 'utf8'))
  assert.equal(wf.concurrency.group, 'mobile-verify'); assert.equal(wf.concurrency['cancel-in-progress'], true); assert.equal(wf.jobs['mobile-verify']['runs-on'], 'ubuntu-latest')
  const run = wf.jobs['mobile-verify'].steps.map((s) => s.run || '').join('\n'); assert.match(run, /--project=mobile-design/); assert.match(run, /--project=mobile-journeys/)
})
