const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const modal = fs.readFileSync(path.join(root, 'src/components/RTE/TiptapCreateTaskModal.tsx'), 'utf8');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const parsed = ts.createSourceFile('modal.tsx', modal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) found = node.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(found, `production declaration ${name} exists`);
  return `const ${found};`;
}
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function mount(backgroundTaskUploadsEnabled) {
  const created = [];
  const errors = [];
  const state = { saving: false, closed: false, reset: false, attachments: [], trigger: false };
  const toast = Object.assign(() => {}, {
    error: (message) => errors.push(message),
    success: () => {},
    promise: (promise, handlers) => promise.then(handlers.success, handlers.error),
  });
  const context = {
    isRecording: false, uploadInProgress: false, canSave: undefined,
    backgroundTaskUploadsEnabled, createSubmissionRef: { current: false },
    pendingAttachmentUploadsRef: { current: new Map() }, createTaskAttachmentsRef: { current: [] },
    attachmentComposerEpochRef: { current: 0 }, attachmentComposerEpoch: 0,
    aiPromptRef: { current: undefined }, setAttachmentComposerEpoch: () => {},
    formValues: { title: 'New ticket', description: '', attachments: [] },
    setUploadInProgress: (value) => { state.saving = value; },
    saveEpochRef: { current: 0 }, titleGenerationForSaveRef: { current: false },
    shouldGenerateTitleForSave: () => false, getCurrentTitle: () => 'New ticket',
    editor: { getHTML: () => '', chain: () => ({ unsetHighlight() { return this; }, clearContent() { return this; }, run() {} }) },
    setEditMode: () => {}, setCurrentFocusedElement: () => {},
    createTaskUploadCount: () => 0, reserveCreateTaskUploads: () => {}, releaseCreateTaskUploadReservations: () => {},
    handleChange: (key, value) => { context.formValues[key] = value; },
    setNewCommentAttachments: (value) => { state.attachments = value; },
    setTrigger: (update) => { state.trigger = update(state.trigger); }, setFilesDropped: () => {},
    resetFormValues: () => { state.reset = true; context.formValues.attachments = []; },
    setShowConfirmationModal: () => {}, handleSetUserInput: () => {},
    setHasOpenedClassicForm: () => {}, setShouldShowAITaskWriter: () => {}, setUploadingStateCreateTaskModal: () => {},
    CreateTaskAndDescription: async (_description, _title, payload) => { created.push(payload); return '/detail/project-1/42'; },
    getTaskCreatePerformanceTraceScope: () => null,
    completeTaskCreatePerformanceTrace: () => {}, completeTaskCreatePerformanceTraceAfterPaint: () => {},
    completeTaskCreatePerformanceTraceAfterElementRemoved: () => {},
    closeHandler: () => { state.closed = true; }, asyncPush: async () => {},
    isMbl: false, pathname: '/project', localStorage: { removeItem: () => {} },
    document: { getElementById: () => ({ focus: () => {} }) }, DIV_ID_CONSTANTS: { titleInputModal: 'title' },
    divIds: { wrapperId: 'modal' }, toast, console: { log: () => {} },
  };
  const names = ['onFilesSelected', 'onUploadFailed', 'getAttachments', 'handleFileDrop', 'callbackAttachments', 'resetComposerAfterCreate', 'CtrlEnterHandler'];
  const render = () => new Function(...Object.keys(context), `${compile(names.map(declaration).join('\n'))}; return { ${names.join(', ')} };`)(...Object.values(context));
  const handlers = render();
  return {
    ...handlers, created, errors, state, context,
    rerender: () => { context.attachmentComposerEpoch = context.attachmentComposerEpochRef.current; return render(); },
    onFilesSelected: (files, preparation = Promise.resolve(files.map((file, id) => ({ id, file })))) => handlers.onFilesSelected(files, preparation),
  };
}

for (const background of [false, true]) {
  for (const mode of ['Save', 'SaveAndClose', 'SaveAndNew']) {
    test(`${mode} waits for a pending upload and saves its attachment (background=${background})`, async () => {
      const fixture = mount(background);
      const file = new File(['hello'], 'just-added.txt', { type: 'text/plain' });
      fixture.onFilesSelected([file]);
      let resolveUpload;
      const upload = new Promise((resolve) => { resolveUpload = resolve; });
      const receipt = upload.then((source) => fixture.callbackAttachments([{ id: 0, file: { name: file.name, size: file.size, type: file.type, source } }]));
      const save = fixture.CtrlEnterHandler(mode);
      await nextTurn();
      assert.equal(fixture.state.saving, true);
      assert.equal(fixture.created.length, 0, 'create cannot run before the upload resolves');
      await fixture.CtrlEnterHandler(mode);
      assert.equal(fixture.created.length, 0, 'a second shortcut cannot bypass the pending save');
      resolveUpload('https://files.example/just-added.txt');
      await receipt;
      await save;
      await nextTurn();
      assert.equal(fixture.created.length, 1);
      assert.equal(fixture.created[0].attachments[0].file.source, 'https://files.example/just-added.txt');
      assert.equal(fixture.state.reset, true);
      assert.equal(fixture.state.saving, false);
    });
    test(`${mode} does not create or close when the pending upload fails (background=${background})`, async () => {
      const fixture = mount(background);
      fixture.onFilesSelected([new File(['hello'], 'failed.txt')]);
      const save = fixture.CtrlEnterHandler(mode);
      await nextTurn();
      fixture.onUploadFailed('failed.txt');
      await save;
      assert.equal(fixture.created.length, 0);
      assert.equal(fixture.state.closed, false);
      assert.equal(fixture.state.reset, false);
      assert.equal(fixture.state.saving, false);
      assert.match(fixture.errors[0], /Could not upload "failed.txt"/);
    });
  }
}

test('discarding the composer during an upload invalidates the save', async () => {
  const fixture = mount(false);
  fixture.onFilesSelected([new File(['hello'], 'discarded.txt')]);
  const save = fixture.CtrlEnterHandler('Save');
  fixture.context.saveEpochRef.current++;
  await fixture.callbackAttachments([{ id: 0, file: { name: 'discarded.txt', source: 'https://files.example/discarded.txt' } }]);
  await save;
  assert.equal(fixture.created.length, 0);
});

for (const method of ['handleFileUpload', 'handleDroppedFiles']) {
  test(`${method} registers the file before asynchronous preparation or preview`, async () => {
    let finish;
    const processing = new Promise((resolve) => { finish = resolve; });
    const loaded = { exports: {} };
    const source = fs.readFileSync(path.join(root, 'src/components/Common/AttachmentsUpload/FileUploadHandler.tsx'), 'utf8');
    new Function('module', 'exports', 'require', compile(source))(loaded, loaded.exports, (request) => {
      if (request === 'react') return { useRef: () => ({ current: null }), useState: () => [[], () => {}] };
      if (request === '@/utils/helperFunctions/helperFunctions') return { processFiles: () => processing };
      throw new Error(`Unexpected dependency: ${request}`);
    });
    const selected = [];
    const hook = loaded.exports.useFileUpload([], (files) => selected.push(...files));
    const file = new File(['hello'], 'before-preview.txt');
    const result = hook[method](method === 'handleFileUpload' ? { target: { files: [file] } } : [file]);
    assert.deepEqual(selected, [file], 'registration must be synchronous');
    finish([{ id: 0, file }]);
    await result;
  });
}

test('an initial empty preview emission cannot forget a just-selected file', async () => {
  const fixture = mount(false);
  fixture.onFilesSelected([new File(['hello'], 'not-prepared.txt')]);
  await fixture.getAttachments([]);
  assert.equal(fixture.context.pendingAttachmentUploadsRef.current.size, 1);
});

test('deliberately removing a prepared file releases its pending save', async () => {
  const fixture = mount(false);
  const file = new File(['hello'], 'removed.txt');
  fixture.onFilesSelected([file]);
  await fixture.getAttachments([file]);
  const save = fixture.CtrlEnterHandler('Save');
  await fixture.getAttachments([]);
  await save;
  assert.equal(fixture.created.length, 1);
  assert.deepEqual(fixture.created[0].attachments, []);
});

test('an upload failure before Save still blocks creation with a warning', async () => {
  const fixture = mount(false);
  fixture.onFilesSelected([new File(['hello'], 'already-failed.txt')]);
  fixture.onUploadFailed('already-failed.txt');
  await fixture.getAttachments([]);
  await fixture.CtrlEnterHandler('Save');
  assert.equal(fixture.created.length, 0);
  assert.match(fixture.errors[0], /already-failed.txt/);
});

for (const fails of [false, true]) {
  test(`image preparation can rename a pending attachment (failure=${fails})`, async () => {
    const fixture = mount(false);
    const original = new File(['image'], 'photo.png');
    const resized = new File(['webp'], 'photo.webp');
    let finishPreparation;
    fixture.onFilesSelected([original], new Promise((resolve) => { finishPreparation = resolve; }));
    const save = fixture.CtrlEnterHandler('Save');
    finishPreparation([{ id: 0, file: resized }]);
    await nextTurn();
    assert.equal(fixture.created.length, 0);
    if (fails) fixture.onUploadFailed(resized.name);
    else await fixture.callbackAttachments([{ id: 0, file: { name: resized.name, source: 'https://files.example/photo.webp' } }]);
    await save;
    assert.equal(fixture.created.length, fails ? 0 : 1);
    if (fails) assert.match(fixture.errors[0], /photo.webp/);
    else assert.equal(fixture.created[0].attachments[0].file.name, resized.name);
  });
}

test('the window registers a dropped file before the child preparation effect', async () => {
  const fixture = mount(false);
  const file = new File(['hello'], 'dropped-before-effect.txt');
  void fixture.handleFileDrop([file]);
  const save = fixture.CtrlEnterHandler('Save');
  await nextTurn();
  assert.equal(fixture.created.length, 0);
  await fixture.callbackAttachments([{ id: 0, file: { name: file.name, source: 'https://files.example/drop.txt' } }]);
  await save;
  assert.equal(fixture.created[0].attachments[0].file.name, file.name);
});

test('dropping an already-attached file does not leave an unresolvable wait', async () => {
  const fixture = mount(false);
  const file = new File(['hello'], 'duplicate-drop.txt');
  fixture.context.createTaskAttachmentsRef.current = [{ id: 0, file }];
  await fixture.handleFileDrop([file]);
  assert.equal(fixture.context.pendingAttachmentUploadsRef.current.size, 0);
});

test('a settled ordinary upload still saves the unwrapped preview metadata', async () => {
  const fixture = mount(false);
  const uploaded = { name: 'settled.txt', source: 'https://files.example/settled.txt', size: 5, type: 'text/plain' };
  fixture.context.createTaskAttachmentsRef.current = [uploaded];
  await fixture.CtrlEnterHandler('SaveAndClose');
  await nextTurn();
  assert.equal(fixture.created[0].attachments[0].file, uploaded);
});

test('the create window wires selection and upload-failure reports through the shared uploader', () => {
  const state = fs.readFileSync(path.join(root, 'src/components/Common/AttachmentsUpload/useAttachmentUploadState.ts'), 'utf8');
  const uploader = fs.readFileSync(path.join(root, 'src/components/Common/AttachmentsUpload/index.tsx'), 'utf8');
  assert.match(modal, /onFilesSelected=\{onFilesSelected\}/);
  assert.match(modal, /onUploadFailed=\{onUploadFailed\}/);
  assert.match(state, /useFileUpload\(props\.filesFromParent, props\.onFilesSelected, props\.onUploadFailed\)/);
  assert.match(state, /await handleDroppedFiles\(files\)/);
  assert.match(uploader, /onUploadFailed=\{props\.onUploadFailed\}/);
});

for (const background of [false, true]) {
  test(`Save & new isolates late preview and upload callbacks from the next ticket (background=${background})`, async () => {
    const fixture = mount(background);
    const file = new File(['image'], 'first.webp', { type: 'image/webp' });
    const uploaded = [{ id: 0, file: { name: file.name, size: file.size, type: file.type, source: 'https://files.example/first.webp' } }];
    fixture.onFilesSelected([file]);
    const save = fixture.CtrlEnterHandler('SaveAndNew');
    await fixture.callbackAttachments(uploaded);
    await save;
    await nextTurn();
    assert.equal(fixture.created[0].attachments[0].file.source, uploaded[0].file.source);
    assert.deepEqual(fixture.state.attachments, []);
    assert.deepEqual(fixture.context.createTaskAttachmentsRef.current, []);
    const triggerAfterReset = fixture.state.trigger;
    // The old gallery emits its uploadedFiles again when its files become empty.
    await fixture.getAttachments([file]);
    await fixture.callbackAttachments(uploaded);
    assert.deepEqual(fixture.state.attachments, [], 'old callbacks cannot repopulate the next composer');
    assert.deepEqual(fixture.context.formValues.attachments, []);
    assert.equal(fixture.state.trigger, triggerAfterReset);
    const next = fixture.rerender();
    await next.CtrlEnterHandler('SaveAndClose');
    await nextTurn();
    assert.deepEqual(fixture.created[1].attachments, [], 'title-only second ticket has no old attachment');
  });
}

test('late preparation, failure and upload callbacks cannot affect a same-name file in the next composer', async () => {
  const fixture = mount(true);
  const original = new File(['old'], 'photo.png');
  let prepare;
  fixture.onFilesSelected([original], new Promise((resolve) => { prepare = resolve; }));
  fixture.resetComposerAfterCreate();
  const next = fixture.rerender();
  const current = new File(['new'], 'photo.png');
  next.onFilesSelected([current]);
  const pending = fixture.context.pendingAttachmentUploadsRef.current.get(current.name);
  prepare([{ id: 0, file: new File(['webp'], 'photo.webp') }]);
  await nextTurn();
  fixture.onUploadFailed(current.name);
  await fixture.callbackAttachments([{ id: 0, file: { name: current.name, source: 'https://files.example/old.png' } }]);
  assert.equal(fixture.context.pendingAttachmentUploadsRef.current.get(current.name), pending);
  assert.equal(pending.failed, false);
  assert.deepEqual(fixture.context.createTaskAttachmentsRef.current, []);
  const save = next.CtrlEnterHandler('SaveAndClose');
  await nextTurn();
  assert.equal(fixture.created.length, 0);
  await next.callbackAttachments([{ id: 0, file: { name: current.name, source: 'https://files.example/new.png' } }]);
  await save;
  await nextTurn();
  assert.equal(fixture.created[0].attachments[0].file.source, 'https://files.example/new.png');
});

test('the uploader remounts at the composer boundary to clear fileItems and gallery upload history', () => {
  assert.match(modal, /<AttachmentsUpload\s+key=\{attachmentComposerEpoch\}/);
});
