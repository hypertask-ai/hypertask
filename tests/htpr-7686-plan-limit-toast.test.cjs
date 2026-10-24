const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const compiled = ts.transpileModule(read("src/lib/planLimitsClient.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} };
const stubs = {
  axios: { __esModule: true, default: { isAxiosError: error => error?.isAxiosError === true } },
};
new Function("require", "module", "exports", compiled)(name => {
  assert.ok(Object.hasOwn(stubs, name), `Unexpected import: ${name}`);
  return stubs[name];
}, loaded, loaded.exports);
const { PlanLimitRefusal, planLimitRefusalMessage } = loaded.exports;
const message = "This Free team has reached its limit of 250 tickets. Upgrade to add more.";
const refusal = (status = 402, code = "PLAN_LIMIT_REACHED", text = message) => ({
  isAxiosError: true,
  response: { status, data: { success: false, code, message: text, limit: "tickets", max: 250 } },
});

test("axios 402 PLAN_LIMIT_REACHED returns the exact server message", () => {
  assert.equal(planLimitRefusalMessage(refusal()), message);
});

test("other failures remain outside the new toast path", () => {
  for (const error of [
    refusal(500), refusal(402, "OTHER_ERROR"), refusal(402, null),
    refusal(402, "PLAN_LIMIT_REACHED", null), refusal(402, "PLAN_LIMIT_REACHED", 250),
    { response: refusal().response }, { isAxiosError: true },
    { isAxiosError: true, response: { status: 402 } },
    new Error("Network error"), null, undefined,
  ]) assert.equal(planLimitRefusalMessage(error), null);
});

const modalHook = "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts";
const modal = "src/components/RTE/TiptapCreateTaskModal.tsx";
const saveHook = "src/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent.ts";
const preview = "src/components/Common/AttachmentsUpload/SingleFileInputPreview.tsx";
const quietConsole = { log() {}, error() {} };
class UploadTooLargeError extends Error {}

function nodes(file, predicate) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function visit(node) {
    if (predicate(node, source)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function initializer(file, name) {
  const [node] = nodes(file, (node, source) => ts.isVariableDeclaration(node) && node.name.getText(source) === name);
  assert.ok(node, `${file}: ${name}`);
  return ts.isCallExpression(node.initializer) ? node.initializer.arguments[0].getText() : node.initializer.getText();
}

function evaluate(expression, context) {
  const compiled = ts.transpileModule(`return (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(context), compiled)(...Object.values(context));
}

const errors = [refusal(), refusal(500), refusal(402, "OTHER_ERROR"), new Error("Network error")];
const isPlan = error => planLimitRefusalMessage(error) !== null;
const noChange = () => assert.fail("failure must preserve the draft");

test("all modal save modes and phone Save show exactly one server refusal and keep the draft", async () => {
  const [saveCatch] = nodes(modal, node => ts.isCatchClause(node) && node.block.getText().includes('toast.error(error instanceof PlanLimitRefusal'));
  const promiseErrors = nodes(modal, node => ts.isPropertyAssignment(node) && node.name.getText() === "error" && node.initializer.getText().includes('"error when creating"'));
  assert.equal(promiseErrors.length, 2);
  for (const enabled of [false, true]) for (const error of errors) {
    const formValues = { title: "Keep my typed title", description: "Keep my description", currentProject: { id: 15 }, assignees: [], attachments: [] };
    const before = structuredClone(formValues);
    const toasts = [];
    const context = {
      showPlanLimitToast: enabled, formValues, currentUser: { id: 6 },
      parentTaskInfo: undefined, createTaskFromComment: undefined,
      createNewTaskGloballyAPIHandler: async () => ({ error: true, ErrorMessage: error }),
      planLimitRefusalMessage, PlanLimitRefusal, toast: { error: text => toasts.push(text) },
      beginTaskCreatePerformanceTrace: () => null,
      processHtmlForTaskId: async () => ({ html: formValues.description, urls: [], relations: [] }),
      uploadAttachmentsDescription: () => ({ AttachmentUrls: [] }),
    };
    context.CreateNewTask = evaluate(initializer(modalHook, "CreateNewTask"), context);
    const create = evaluate(initializer(modalHook, "CreateTaskAndDescription"), context);
    let caught;
    try { await create(); } catch (failure) { caught = failure; }
    assert.ok(caught instanceof Error);
    assert.equal(caught instanceof PlanLimitRefusal, enabled && isPlan(error));
    assert.equal(caught.message, enabled && isPlan(error) ? message : "Task could not be created");
    assert.deepEqual(toasts, [], "the hook must not compete with the modal toast owner");
    const handlers = {
      PlanLimitRefusal, console: quietConsole, traceScope: null,
      completeTaskCreatePerformanceTrace() {}, setUploadInProgress() {}, releaseSubmission() {},
      toast: context.toast,
    };
    const showSaveError = evaluate(`(error) => ${saveCatch.block.getText()}`, handlers);
    showSaveError(caught);
    assert.deepEqual(toasts.splice(0), [enabled && isPlan(error) ? message : "Error when creating"]);
    for (const callback of promiseErrors) {
      const display = evaluate(callback.initializer.getText(), handlers)(caught);
      assert.deepEqual(toasts, []);
      assert.equal(display, enabled && isPlan(error) ? message : "error when creating");
    }
    assert.deepEqual(formValues, before);
  }
});

test("AI-chat handoff keeps a plan refusal readable without a second toast", () => {
  const [caught] = nodes("src/components/Modals/CreateTaskGloballyModal/CreateTaskModalBody.tsx", node => ts.isCatchClause(node) && node.block.getText().includes("sidebarHandoffPending"));
  for (const error of [new PlanLimitRefusal(message), new Error("500")]) {
    const toasts = [];
    evaluate(`(error) => ${caught.block.getText()}`, {
      PlanLimitRefusal, sidebarHandoffPending: { current: true }, toast: { error: text => toasts.push(text) },
    })(error);
    assert.deepEqual(toasts, [error instanceof PlanLimitRefusal ? message : "Could not open AI chat. Your task draft is still here."]);
  }
});

test("board refusal signal crosses useSections without clearing quick entry or adding a generic toast", async () => {
  for (const enabled of [false, true]) for (const error of errors) for (const viewDefaults of [false, true]) {
    const toasts = [];
    const sections = [{ sectionId: 7, items: [] }];
    const project = { id: 15, sections };
    const createItem = evaluate(initializer("src/hooks/MultiPages/useAddDeleteTaskInBoards.tsx", "createItem"), {
      console: quietConsole, _currentProject: project, currentUser: { id: 6 },
      getProjectIdxAndAllData: async () => ({ allData: { updatedProjects: [{ sections }] }, projectToUpdateIndex: 0 }),
      generateRanking: () => "rank", getActiveFiltersFromProject: () => ({}),
      getNewTaskViewDefaults: () => ({ tags: viewDefaults ? [{}] : [], assignees: [] }),
      createNewTaskGloballyAPIHandler: async () => ({ error: true, ErrorMessage: error }),
      axios: { post: async () => { throw error; } },
      showPlanLimitToast: enabled, planLimitRefusalMessage, toast: { error: text => toasts.push(text) },
    });
    const invokeCreateItem = evaluate(initializer("src/hooks/Homepage/useSections.ts", "invokeCreateItem"), {
      createItem, position: "top", sectionId: 7, projectId: 15, title: "Bugs",
      setPosition: noChange, setShowAddItem: noChange,
    });
    const title = "Keep my quick-entry title";
    const create = evaluate(initializer("src/components/Common/newTask.tsx", "createItem"), {
      schemaCheck: () => title, invokeCreateItem, submittingRef: { current: false }, setIsSubmitting() {},
      onTitleChange: noChange, toast: text => toasts.push(text),
    });
    await create();
    assert.deepEqual(toasts, [enabled && isPlan(error) ? message : "Could not create the task, try again"]);
  }
});

const fileMessage = "Files on the Free plan can be up to 10 MB. Upgrade to upload bigger files.";
const fileRefusal = () => ({ ...refusal(402, "PLAN_LIMIT_REACHED", fileMessage), response: { status: 402, data: { code: "PLAN_LIMIT_REACHED", message: fileMessage, limit: "file_size" } } });
const file = { name: "large.bin", size: 11 * 1024 * 1024, type: "application/octet-stream" };

function previewFailure(enabled, error, reportUploadFailure = () => {}) {
  const [caught] = nodes(preview, node => ts.isCallExpression(node) && node.expression.getText() === "uploadFile().catch");
  const toasts = [];
  evaluate(caught.arguments[0].getText(), {
    active: true, file, showPlanLimitToast: enabled, PlanLimitRefusal, planLimitRefusalMessage,
    UploadTooLargeError: class UploadTooLargeError extends Error {},
    toast: { error: text => toasts.push(text) }, backgroundTaskUpload: false,
    latestHandlersRef: { current: { handleRemove() {}, reportUploadFailure } },
  })(error);
  return toasts;
}

test("description and create attachment catches show exact server messages only with the flag On", () => {
  for (const enabled of [false, true]) for (const error of [fileRefusal(), refusal(500), refusal(402, "OTHER_ERROR"), new Error("offline")]) {
    assert.deepEqual(previewFailure(enabled, error), [enabled && isPlan(error) ? fileMessage : `Could not upload "${file.name}". Please try again.`]);
  }
});

test("a pending create save does not duplicate the attachment refusal already toasted by the preview", async () => {
  const pending = { failed: false, reject: undefined };
  const promise = new Promise((resolve, reject) => { pending.reject = reject; });
  const pendingAttachmentUploadsRef = { current: new Map([[file.name, pending]]) };
  const onUploadFailed = evaluate(initializer(modal, "onUploadFailed"), {
    attachmentComposerEpoch: 0, attachmentComposerEpochRef: { current: 0 }, pendingAttachmentUploadsRef,
  });
  const toasts = previewFailure(true, fileRefusal(), onUploadFailed);
  const [caught] = nodes(modal, node => ts.isCatchClause(node) && node.block.getText().includes("pendingAttachmentUploadsRef.current.forEach"));
  try { await promise; } catch (error) {
    assert.ok(error instanceof PlanLimitRefusal);
    evaluate(`(error) => ${caught.block.getText()}`, {
      pendingAttachmentUploadsRef, setUploadInProgress() {}, createSubmissionRef: { current: true },
      PlanLimitRefusal, toast: { error: text => toasts.push(text) },
    })(error);
  }
  assert.deepEqual(toasts, [fileMessage]);
});

function commentRedirect(enabled, upload, queued, toasts, verify = async () => ({ data: { success: true } })) {
  return evaluate(initializer(saveHook, "redirectAPI"), {
    showPlanLimitToast: enabled, PlanLimitRefusal, planLimitRefusalMessage, UploadTooLargeError, uploadSingleFileViaApi: upload,
    axios: { post: verify },
    DOMParser: class { parseFromString() { return { querySelectorAll: () => [] }; } },
    currentTask: { id: 42 }, currentProject: { id: 15 }, currentBoardBilling: null,
    improveWritingSource: "fixture", improveWritingModel: "fixture", description: "Description",
    setUploadingComments: update => queued.push(...update([])), toast: { error: text => toasts.push(text) },
  });
}

function editorSend(handleSave, state, toasts) {
  return evaluate(initializer("src/components/RTE/useTaskDetailEditorSave.tsx", "handleCallback"), {
    handleSave, saveInFlightRef: { current: false }, mobileEditSavingRef: { current: false },
    mode: "create-comment", uploadingDescription: undefined, mobileExistingEditOpen: false,
    mobileEditSnapshotRef: { current: null }, setSaveInFlight() {}, cancelDebounceRef: { current: null },
    newCommentAttachments: [file], attachments: [], commentId: undefined, id: "comment-input", inboxFlow: null,
    currentTask: { status: "Normal" }, setTrigger() {}, setNewCommentAttachments: value => { state.attachments = value; },
    draftsFromTQ: [], queryClient: { setQueryData() {} }, draftQueryKey: [], invalidateUserDrafts() {},
    allowEdit: true, isRecording: false, console: quietConsole, toast: { error: text => toasts.push(text) },
    editor: { isEmpty: false, isDestroyed: false, setEditable() {}, getHTML: () => state.text, getText: () => state.text,
      commands: { blur() {}, setContent: text => { state.text = text; } } },
  });
}

test("comment Send awaits upload and preserves text and attachments on a refusal; flag Off stays queued", async () => {
  for (const enabled of [false, true]) for (const error of [fileRefusal(), refusal(500), refusal(402, "OTHER_ERROR"), new Error("offline")]) {
    const queued = [], toasts = [];
    let uploads = 0;
    const redirect = commentRedirect(enabled, async () => { uploads++; throw error; }, queued, toasts);
    const state = { text: "Keep my comment draft", attachments: [file] };
    const sent = await editorSend(redirect, state, toasts)();
    assert.equal(sent, !enabled);
    assert.equal(uploads, enabled ? 1 : 0);
    assert.equal(queued.length, enabled ? 0 : 1);
    assert.equal(state.text, enabled ? "Keep my comment draft" : "");
    assert.deepEqual(state.attachments, enabled ? [file] : []);
    assert.deepEqual(toasts, enabled ? [isPlan(error) ? fileMessage : `Could not upload "${file.name}". Please try again.`] : []);
  }
});

const newComment = "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent.tsx";

function phoneEditorSend(redirectAPI, state, toasts) {
  const handleSave = evaluate(initializer(newComment, "redirectMiddleware"), {
    redirectAPI, setTimeout() {}, setShowTaskOptions() {},
  });
  return editorSend(handleSave, state, toasts);
}

test("phone Send preserves the draft and attachment chip when upload or finalize refuses the file", async () => {
  for (const endpoint of ["upload", "finalize"]) for (const error of [fileRefusal(), refusal(500), refusal(402, "OTHER_ERROR"), new Error("offline")]) {
    const queued = [], toasts = [];
    const state = { text: "Keep my phone comment draft", attachments: [file] };
    const chips = state.attachments;
    const redirect = commentRedirect(true, async () => {
      if (endpoint === "upload") throw error;
      return "https://files.example/large.bin";
    }, queued, toasts, async () => { throw error; });
    assert.equal(await phoneEditorSend(redirect, state, toasts)(), false);
    assert.equal(state.text, "Keep my phone comment draft");
    assert.equal(state.attachments, chips);
    assert.deepEqual(state.attachments, [file]);
    assert.deepEqual(queued, []);
    assert.deepEqual(toasts, [isPlan(error) ? fileMessage : `Could not upload "${file.name}". Please try again.`]);
  }
});

test("phone Send preserves text and chips on a rejected save exactly like desktop", async () => {
  for (const send of [editorSend, phoneEditorSend]) {
    const state = { text: "Unsaved phone comment", attachments: [file] };
    const chips = state.attachments;
    const toasts = [];
    assert.equal(await send(async () => { throw new Error("offline"); }, state, toasts)(), false);
    assert.equal(state.text, "Unsaved phone comment");
    assert.equal(state.attachments, chips);
    assert.deepEqual(toasts, ["Could not save. Your changes are still here."]);
  }
});

test("phone Send waits for success before clearing the draft and attachment chip", async () => {
  const queued = [], toasts = [];
  const state = { text: "Phone comment", attachments: [file] };
  let finishUpload;
  const upload = new Promise(resolve => { finishUpload = resolve; });
  const redirect = commentRedirect(true, () => upload, queued, toasts);
  let settled = false;
  const sending = phoneEditorSend(redirect, state, toasts)().then(result => {
    settled = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(state.text, "Phone comment");
  assert.deepEqual(state.attachments, [file]);
  assert.deepEqual(queued, []);
  finishUpload("https://files.example/large.bin");
  assert.equal(await sending, true);
  assert.equal(state.text, "");
  assert.deepEqual(state.attachments, []);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].content, "Phone comment");
  assert.equal(queued[0].attachments[0].file.source, "https://files.example/large.bin");
  assert.deepEqual(toasts, []);
});

test("flag-Off phone Send keeps the existing queued-and-clear behavior", async () => {
  const queued = [], toasts = [];
  const state = { text: "Phone comment", attachments: [file] };
  const redirect = commentRedirect(false, async () => assert.fail("flag Off must not preflight"), queued, toasts);
  assert.equal(await phoneEditorSend(redirect, state, toasts)(), true);
  assert.equal(state.text, "");
  assert.deepEqual(state.attachments, []);
  assert.equal(queued.length, 1);
  assert.deepEqual(toasts, []);
});

test("successful flagged comment Send queues sourced attachments without a second upload", async () => {
  const queued = [], toasts = [];
  const source = "https://files.example/large.bin";
  const redirect = commentRedirect(true, async () => source, queued, toasts);
  const state = { text: "Comment", attachments: [file] };
  assert.equal(await editorSend(redirect, state, toasts)(), true);
  assert.equal(queued[0].attachments[0].file.source, source);
  assert.deepEqual(toasts, []);
});

test("uploadUrl, uploadFinalize and buffered fallback preserve raw 402 refusals for the flagged toast owners", async () => {
  for (const refusedEndpoint of ["uploadUrl", "uploadFinalize", "n8nUpload"]) {
    const error = fileRefusal();
    const requested = [];
    const axios = {
      isAxiosError: error => error?.isAxiosError === true,
      post: async url => {
        requested.push(url);
        if (url === `/api/tasks/${refusedEndpoint}`) throw error;
        if (url === "/api/tasks/uploadUrl") {
          if (refusedEndpoint === "n8nUpload") throw new Error("direct service unavailable");
          return { data: { grant: "grant", uploads: [{ key: "key", uploadUrl: "https://storage/put", fileUrl: "https://storage/file", contentType: "text/plain" }] } };
        }
        return { data: { fileUrls: ["https://storage/file"] } };
      },
    };
    const dependencies = {
      axios: { __esModule: true, default: axios },
      "@/lib/media/heicToJpeg": { planUploadFiles: async files => files.map(file => ({ file })), isHeicByMetadata: () => false },
      "@/lib/media/heicPreview": { isHeicPreviewUrl: () => false },
      "./directUpload": { directUploadContentType: type => type, getDirectUploadSizeError: () => null },
      "./uploadLimits": { getUploadSizeError: () => null, UploadTooLargeError: class UploadTooLargeError extends Error {} },
    };
    const compiled = ts.transpileModule(read("src/lib/storage/uploadViaApi.ts"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const loaded = { exports: {} };
    const xhr = class {
      upload = {};
      status = 200;
      open() {}
      setRequestHeader() {}
      send() { this.onload(); }
    };
    new Function("require", "module", "exports", "XMLHttpRequest", compiled)(name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`);
      return dependencies[name];
    }, loaded, loaded.exports, xhr);
    await assert.rejects(loaded.exports.uploadSingleFileViaApi(new File(["file"], "file.txt")), failure => failure === error);
    assert.ok(requested.includes(`/api/tasks/${refusedEndpoint}`));
    assert.deepEqual(previewFailure(true, error), [fileMessage]);
    assert.deepEqual(previewFailure(false, error), [`Could not upload "${file.name}". Please try again.`]);
  }
});


test("comment Send retains the pre-existing readable 413 upload message", async () => {
  const queued = [], toasts = [];
  const redirect = commentRedirect(true, async () => { throw new UploadTooLargeError("File exceeds the upload cap"); }, queued, toasts);
  assert.equal(await redirect({ content: "Draft", mode: "create-comment", attachments_: [file] }), false);
  assert.deepEqual(toasts, ["File exceeds the upload cap"]);
  assert.deepEqual(queued, []);
});

for (const sourced of [false, true]) {
  test(`comment Send receives the task-scoped 402 before queueing or clearing (${sourced})`, async () => {
    const queued = [], toasts = [], requests = [];
    const attachment = sourced ? { ...file, source: "https://storage/file" } : file;
    const redirect = commentRedirect(true, async () => "https://storage/file", queued, toasts, async (url, body) => {
      requests.push({ url, body });
      throw fileRefusal();
    });
    const state = { text: "Keep my comment draft", attachments: [attachment] };
    const send = editorSend(args => redirect({ ...args, attachments_: [attachment] }), state, toasts);
    assert.equal(await send(), false);
    assert.deepEqual(requests, [{ url: "/api/tasks/uploadFinalize", body: { action: "verify-task-attachments", taskId: 42, sources: ["https://storage/file"] } }]);
    assert.equal(state.text, "Keep my comment draft");
    assert.deepEqual(state.attachments, [attachment]);
    assert.deepEqual(queued, [], "no Sending placeholder may be created");
    assert.deepEqual(toasts, [fileMessage]);
  });

  for (const allowed of [{ size: 10 * 1024 * 1024, scope: "Free" }, { size: 11 * 1024 * 1024, scope: "paid" }]) {
    test(`comment Send still queues after successful verification: ${allowed.scope}, ${allowed.size} bytes (${sourced})`, async () => {
      const queued = [], toasts = [], requests = [];
      const attachment = { ...file, size: allowed.size, ...(sourced ? { source: "https://storage/file" } : {}) };
      const redirect = commentRedirect(true, async () => "https://storage/file", queued, toasts, async (url, body) => { requests.push({ url, body }); });
      const state = { text: "Allowed comment", attachments: [attachment] };
      assert.equal(await editorSend(args => redirect({ ...args, attachments_: [attachment] }), state, toasts)(), true);
      assert.equal(requests.length, 1);
      assert.equal(queued.length, 1);
      assert.equal(queued[0].attachments[0].file.source, "https://storage/file");
      assert.equal(state.text, "");
      assert.deepEqual(state.attachments, []);
      assert.deepEqual(toasts, []);
    });
  }
}

test("flag Off leaves sourced comment attachment queueing unchanged without verification", async () => {
  const queued = [], toasts = [];
  const redirect = commentRedirect(false, noChange, queued, toasts, noChange);
  assert.equal(await redirect({ content: "Legacy", mode: "create-comment", attachments_: [{ ...file, source: "https://storage/file" }] }), true);
  assert.equal(queued.length, 1);
  assert.deepEqual(toasts, []);
});
