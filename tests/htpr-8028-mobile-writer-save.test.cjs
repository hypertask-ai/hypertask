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
  assert.equal(await callback(''), true);
  assert.equal(titles[0], 'Keep every dictated word & detail.');
  assert.equal(saved[0].title, titles[0]);
  assert.equal(saved[0].description, html);
  assert.equal(saved[0].attachments, undefined, 'the save handler must read current attachments after uploads finish');
  creationResult = false;
  assert.equal(await callback(''), false);
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
    mobileFallbackPromptRef: { current: '' }, autoTrigger: true, userPrompt: '', initialPrompt: '',
    calls: 0, cleared: 0, handled: true,
  };
  context.onCreateTaskFailure = async prompt => { context.calls++; context.rawPrompt = prompt; return context.handled; };
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

test('raw fallback preserves a submitted writer note as literal text in the draft', async () => {
  const ast = tree(modalPath);
  const attr = find(ast, n => ts.isJsxAttribute(n) && n.name.getText(ast) === 'onCreateTaskFailure');
  let html = '<p>Original description.</p>';
  const note = 'New dictated detail: <keep> every & word\nSecond line';
  const writes = [];
  const { escapeHtml } = require('./task-route-loader.cjs').load('src/utils/helperFunctions/escapeHtml.ts');
  const callback = run(`(${attr.initializer.expression.getText(ast)})`, {
    mobileWriterSave: true, formValues: { title: 'Existing title', description: html, attachments: [] },
    editor: { getHTML: () => html, getText: () => 'Original description.', commands: { setContent: value => { html = value; } } },
    getCurrentTitle: () => 'Existing title', applyTaskWriterTitle() {}, handleChange() {}, escapeHtml,
    appliedRawWriterPromptsRef: { current: new Set() },
    CtrlEnterHandler: async (_, values) => { writes.push(values); return false; },
  });
  assert.equal(await callback(note), false);
  assert.equal(writes[0].description, '<p>Original description.</p><p>New dictated detail: &lt;keep&gt; every &amp; word<br>Second line</p>');
  assert.equal(html, writes[0].description, 'failed persistence leaves both original and new words in the draft');
  assert.equal(writes[0].title, 'Existing title');
  assert.equal(await callback(note), false);
  assert.equal(writes[1].description, writes[0].description, 'retry must not append the same note twice');
});

test('fallback waits for uploads, then reads the completed attachment rather than a stale form snapshot', async () => {
  const ast = tree(modalPath);
  const attr = find(ast, n => ts.isJsxAttribute(n) && n.name.getText(ast) === 'onCreateTaskFailure');
  const handler = find(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'CtrlEnterHandler').initializer;
  const end = handler.body.statements.findIndex(statement => statement.getText(ast).startsWith('const formValuesAtSave'));
  assert(end >= 0);
  const preamble = handler.body.statements.slice(0, end + 1).map(statement => statement.getText(ast)).join('\n');
  const formValues = { title: 'Task', description: '<p>Words.</p>', attachments: [], currentProject: { id: 7049 }, tags: [{ id: 'keep-tag' }] };
  const ref = { current: [] }, pending = new Map();
  let finish;
  pending.set('file', { promise: new Promise(resolve => { finish = () => { ref.current = [{ id: 7, file: { name: 'finished.txt', source: 'https://files.example/finished.txt' } }]; pending.clear(); resolve(); }; }) });
  const save = run(`(async (param, formValuesOverride) => { ${preamble}; return formValuesAtSave; })`, {
    console: { log() {} }, canSave: true, isRecording: false, uploadInProgress: false, createSubmissionRef: { current: false },
    saveEpochRef: { current: 0 }, pendingAttachmentUploadsRef: { current: pending }, setUploadInProgress() {},
    createTaskAttachmentsRef: ref, releaseCreateTaskUploadReservations() {}, formValues,
  });
  let saved;
  const callback = run(`(${attr.initializer.expression.getText(ast)})`, {
    mobileWriterSave: true, formValues, editor: { getHTML: () => formValues.description, getText: () => 'Words.' },
    getCurrentTitle: () => 'Task', applyTaskWriterTitle() {},
    CtrlEnterHandler: async (mode, values) => { saved = await save(mode, values); return true; },
  });
  const result = callback(''); finish(); await result;
  assert.equal(saved.attachments.length, 1);
  assert.equal(saved.attachments[0].file.name, 'finished.txt');
  assert.equal(saved.currentProject, formValues.currentProject);
  assert.equal(saved.tags, formValues.tags);
});

test('manual empty completion retains the submitted raw prompt even after context clears input', async () => {
  const ast = tree(writerPath);
  let finish;
  const request = new Promise(resolve => { finish = resolve; });
  const states = [], prompt = { current: '' };
  const context = {
    useCallback: fn => fn, isLoading: false, isByokBlocked: false, isMobileCreateFlow: true,
    mobileCreateRequestPendingRef: { current: false }, currentDisplayResponse: '', autoTrigger: false,
    presentation: 'overlay', initialPrompt: '', userPrompt: 'Keep this fresh dictated note.', isUploadingAttachments: false,
    resolveTaskWriterSubmitPrompt: (_, __, ___, value) => value, uploadProgress: 0,
    document: { getElementById: () => null }, DIV_ID_CONSTANTS: { titleInputModal: 'title' },
    buildTaskWriterPrompt: prompt => prompt, onCreateTaskFailure() {}, mobileFallbackPromptRef: prompt,
    setMobileRequestFinished: value => states.push(value), sendAIRequest: () => request,
  };
  const submit = run(`(${declaration(ast, 'onClickHandler')})`, context);
  submit(); assert.deepEqual(states, [false]);
  context.userPrompt = ''; finish(); await request; await Promise.resolve();
  assert.deepEqual(states, [false, true]);
  assert.equal(prompt.current, 'Keep this fresh dictated note.');
  const fallback = failureEffect();
  fallback.context.mobileRequestFinished = true;
  fallback.context.mobileFallbackPromptRef.current = prompt.current;
  fallback.render(); await Promise.resolve();
  assert.equal(fallback.context.rawPrompt, 'Keep this fresh dictated note.');
});
