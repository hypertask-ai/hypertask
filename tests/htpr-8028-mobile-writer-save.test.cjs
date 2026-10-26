const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modalPath = 'src/components/RTE/TiptapCreateTaskModal.tsx';
const writerPath = 'src/components/PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer.tsx';
const source = file => process.env.HTPR_8028_BASE
  ? execFileSync('git', ['show', `${process.env.HTPR_8028_BASE}:${file}`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, file), 'utf8');
const tree = file => ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
}
function run(code, context) {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return vm.runInNewContext(js, context);
}
function declaration(ast, name) {
  const node = find(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name);
  assert.ok(node, `Missing ${name}`);
  return node.initializer.getText(ast);
}

test('phone Save with writer uses the existing draft; desktop and flag-off retain command routing', () => {
  const ast = tree(modalPath);
  const condition = find(ast, n => ts.isIfStatement(n) && ts.isExpressionStatement(n.thenStatement) && ts.isBinaryExpression(n.thenStatement.expression) && n.thenStatement.expression.left.getText(ast) === 'newTaskWindow');
  assert.ok(condition);
  for (const mobile of [false, true]) for (const enabled of [false, true]) {
    const commands = [];
    let writerOpen = false;
    const chain = { selectAll() { return this; }, setHighlight() { return this; }, run() {} };
    const context = {
      composeEnabled: true, newTaskWindowFlag: true, isMbl: mobile,
      HTPR_8028_MOBILE_WRITER_SAVE_FLAG: 'mobile-writer-save', useFlag: key => key === 'mobile-writer-save' ? enabled : true,
      setCommands: value => commands.push(value), CommandMode: { Command: 'command' },
      formValues: { currentProject: { id: 7049 } }, _currentProject: null, closeComposedTaskForm() {},
      editor: { chain: () => chain }, document: { getElementById: () => null }, divIds: {},
      shouldShowAiTaskWriter: false, aiPromptRef: {}, setHasOpenedClassicForm() {}, editMode: 'Description', setEditMode() {},
      setShouldShowAITaskWriter: update => { writerOpen = update(writerOpen); },
    };
    run(`const mobileWriterSaveFlag = ${declaration(ast, 'mobileWriterSaveFlag')}; const mobileWriterSave = ${declaration(ast, 'mobileWriterSave')}; let newTaskWindow = false; ${condition.getText(ast)}; const toggleAiTaskWriterVisibility = ${declaration(ast, 'toggleAiTaskWriterVisibility')}; const toggleAiTaskWriter = ${declaration(ast, 'toggleAiTaskWriter')}; toggleAiTaskWriter();`, context);
    assert.equal(writerOpen, mobile && enabled);
    assert.equal(commands.length, mobile && enabled ? 0 : 1);
  }
});

test('writer failure saves the original rich description and form fields without another AI title request', async () => {
  const ast = tree(modalPath);
  const attr = find(ast, n => ts.isJsxAttribute(n) && n.name.getText(ast) === 'onCreateTaskFailure');
  assert.ok(attr, 'Missing raw-save callback');
  const html = '<p>Keep every dictated word &amp; <strong>detail</strong>.</p>';
  const attachments = [{ id: 1, file: { source: 'https://files.example/fixture.png' } }];
  const formValues = { title: '', description: 'stale state', currentProject: { id: 7049 }, status: { sectionId: 19409 }, attachments, assignees: [], tags: [{ id: 'label' }] };
  const saved = [], titles = [];
  let creationResult = true;
  const context = {
    mobileWriterSave: true, editor: { getHTML: () => html, getText: () => 'Keep every dictated word & detail.' },
    formValues, getCurrentTitle: () => '', applyTaskWriterTitle: title => titles.push(title),
    CtrlEnterHandler: async (mode, values) => { assert.equal(mode, 'Save'); saved.push(values); return creationResult; },
  };
  const callback = run(`(${attr.initializer.expression.getText(ast)})`, context);
  assert.equal(await callback(), true);
  assert.equal(titles[0], 'Keep every dictated word & detail.');
  assert.equal(saved[0].title, titles[0]);
  assert.equal(saved[0].description, html);
  assert.equal(saved[0].attachments, attachments);
  assert.equal(saved[0].currentProject, formValues.currentProject);
  assert.equal(saved[0].status, formValues.status);
  assert.equal(saved[0].tags, formValues.tags);
  creationResult = false;
  assert.equal(await callback(), false);
  assert.equal(context.editor.getHTML(), html);
  assert.equal(run(`(${attr.initializer.expression.getText(ast)})`, { ...context, mobileWriterSave: false }), undefined);
});

function failureEffect() {
  const ast = tree(writerPath);
  const effect = find(ast, n => ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect' && find(n.arguments[0], c => ts.isIdentifier(c) && c.text === 'onCreateTaskFailure'));
  assert.ok(effect, 'Missing failure fallback effect');
  const context = {
    isLoading: false, isMobileCreateFlow: true, hasError: false, isByokBlocked: false, currentDisplayResponse: '',
    mobileRequestFinished: false, mobileFallbackAttemptedRef: { current: false },
    calls: 0, cleared: 0, handled: true,
  };
  context.onCreateTaskFailure = async () => { context.calls++; return context.handled; };
  context.clearHistory = () => { context.cleared++; };
  return { context, render: () => run(`(${effect.arguments[0].getText(ast)})()`, context) };
}

for (const failure of ['hasError', 'empty', 'isByokBlocked']) {
  test(`mobile ${failure} failure triggers one raw save, not one per render`, async () => {
    const { context, render } = failureEffect();
    context.isLoading = true; render(); assert.equal(context.calls, 0);
    context.isLoading = false; context.mobileRequestFinished = true;
    if (failure !== 'empty') context[failure] = true;
    render(); render(); await Promise.resolve();
    assert.equal(context.calls, 1);
    assert.equal(context.cleared, 1);
  });
}

test('successful writer, desktop, and absent callback never trigger raw fallback', () => {
  for (const scenario of ['success', 'desktop', 'flag-off']) {
    const { context, render } = failureEffect();
    context.isLoading = true; render(); context.isLoading = false;
    if (scenario === 'success') context.currentDisplayResponse = '<h1>Written title</h1><p>Written description</p>';
    else context.hasError = true;
    if (scenario === 'desktop') context.isMobileCreateFlow = false;
    if (scenario === 'flag-off') context.onCreateTaskFailure = undefined;
    render(); assert.equal(context.calls, 0);
  }
});

test('failed persistence retains the original draft and does not retry on rerender', async () => {
  const { context, render } = failureEffect();
  context.hasError = true; context.handled = false;
  render(); render(); await Promise.resolve();
  assert.equal(context.calls, 1);
  assert.equal(context.cleared, 0);
});

test('a fast empty request falls back even when React batches away the loading render', async () => {
  const ast = tree(writerPath);
  let complete;
  const request = new Promise(resolve => { complete = resolve; });
  const completedStates = [];
  const callback = run(`(${declaration(ast, 'sendInitialPrompt')})`, {
    useCallback: fn => fn, initialPrompt: 'dictated note', presentation: 'overlay',
    document: { getElementById: () => null }, DIV_ID_CONSTANTS: { titleInputModal: 'title' },
    buildTaskWriterPrompt: prompt => prompt, onCreateTaskFailure() {},
    setMobileRequestFinished: value => completedStates.push(value), sendAIRequest: () => request,
  });
  callback('Thinking...');
  assert.deepEqual(completedStates, [false]);
  complete(); await request; await Promise.resolve();
  assert.deepEqual(completedStates, [false, true]);
  const { context, render } = failureEffect();
  context.mobileRequestFinished = completedStates[1];
  render(); await Promise.resolve();
  assert.equal(context.calls, 1);
});
