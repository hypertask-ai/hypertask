const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function load(relativePath, mocks) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: false },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}
const extractor = load("src/utils/controllers/urls/extractUrlsFromContent.ts", {
  "node-html-parser": require("node-html-parser"),
  "@/utils/controllers/urls/addIntoTask": {},
  "@/utils/controllers/urls/addIntoTaskDesc": {},
});
const descriptionId = "description-container";
const image = { id: 20, fileSource: "https://files.hypertask.app/FTHJe.png", fileName: "FTHJe.png", fileType: "image/png", commentId: null };
const related = { id: 1, TaskId: 99, urlString: "https://example.com/related", title: "Related link", commentId: null };
function fixture() {
  const calls = [];
  const task = {
    description_: { content: '<p><a href="/detail/project-15/1074">HTPR-1074</a> and <a href="/detail/project-15/1108">HTPR-1108</a></p>', attachments: [image] },
    attachments: [image],
    comments: [{ id: 7, text: '<a href="https://example.com/comment">Comment link</a>', attachments: [] }],
  };
  const prisma = {
    url: { findMany: async args => { calls.push(["urls", args]); return [related]; } },
    task: { findUnique: async args => { calls.push(["task", args]); return task; } },
    $queryRaw: async (strings, ...values) => { calls.push(["raw", values]); return [related]; },
  };
  const controller = load("src/utils/controllers/urls/fetchUrls.ts", {
    "@/lib/constants/TaskDetail": { descriptionContainerId: descriptionId },
    "@/lib/prisma": { default: prisma },
    "@/utils/controllers/urls/extractUrlsFromContent": extractor,
  }).default;
  return { controller, calls, task };
}

test("Ctrl+O lists both named description links, related URLs and the saved attachment without Url copies", async () => {
  const { controller, calls } = fixture();
  const result = await controller("99", descriptionId, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.map(row => [row.urlString, row.title]), [
    [image.fileSource, image.fileName],
    ["/detail/project-15/1074", "HTPR-1074"],
    ["/detail/project-15/1108", "HTPR-1108"],
    [related.urlString, related.title],
    ["https://example.com/comment", "Comment link"],
  ]);
  assert.equal(result.json.find(row => row.Attachment).attachmentType, "image/png");
  assert.equal(calls.some(([name]) => name === "raw"), false);
});

test("composer focus does not send NaN to SQL and still lists all ticket sources", async () => {
  const { controller, calls } = fixture();
  const result = await controller("99", "comment-input", true);
  assert.equal(result.status, 200);
  assert.equal(result.json.length, 5);
  assert.equal(calls.some(([name]) => name === "raw"), false);
});

test("focused comment is first but description, related links and attachments stay listed", async () => {
  const { controller } = fixture();
  const result = await controller("99", "7", true);
  assert.equal(result.json[0].title, "Comment link");
  assert.equal(result.json.length, 5);
});

test("duplicate attachment records keep real MIME type and deduplicate the carousel row", async () => {
  const { controller, task } = fixture();
  task.description_.content += `<a href="${image.fileSource}">Image link</a>`;
  const result = await controller("99", "", true);
  const attachments = result.json.filter(row => row.urlString === image.fileSource);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].Attachment, true);
  assert.equal(attachments[0].title, image.fileName);
});

test("flag off preserves legacy Url-only queries and ordering for every focus path", async () => {
  for (const focus of [undefined, descriptionId, "7", "comment-input"]) {
    const { controller, calls } = fixture();
    const result = await controller("99", focus, false);
    assert.deepEqual(result, { status: 200, json: [related] });
    assert.equal(calls.some(([name]) => name === "task"), false);
    assert.equal(calls[0][0], focus ? "raw" : "urls");
  }
});

for (const enabled of [true, false]) {
  test(`Ctrl+O renders the real menu and opens the existing attachment carousel with flag ${enabled ? "on" : "off"}`, async t => {
    const React = require("react");
    const { createRoot } = require("react-dom/client");
    const { JSDOM } = require("jsdom");
    const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai" });
    const names = ["window", "document", "IS_REACT_ACT_ENVIRONMENT", "fetch"];
    const previous = Object.fromEntries(names.map(name => [name, global[name]]));
    Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const renderer = createRoot(document.getElementById("root"));
    t.after(async () => {
      await React.act(async () => renderer.unmount());
      for (const name of names) {
        if (previous[name] === undefined) delete global[name];
        else global[name] = previous[name];
      }
      dom.window.close();
    });
    const { controller, task } = fixture();
    const attachment = { ...image, fileSource: "https://storage.example.com/file?signature=test", fileType: "application/pdf", fileName: "report.pdf" };
    task.attachments = [attachment];
    task.description_.attachments = [];
    const result = await controller("99", "", enabled);
    global.fetch = async url => {
      assert.equal(url, "/api/urls/fetchUrls?taskId=99&commentId=");
      return { ok: true, json: async () => result.json };
    };
    let carouselProps;
    const box = ({ children }) => React.createElement("div", null, children);
    const LinksModal = load("src/components/Modals/LinksModal/index.tsx", {
      react: React,
      "react/jsx-runtime": require("react/jsx-runtime"),
      reactstrap: { ModalBody: box },
      "@/styles/linksModal.module.scss": { default: {} },
      "next/navigation": { useRouter: () => ({ push: () => {} }) },
      "lucide-react": { Link: () => null, Search: () => null },
      "next/dynamic": { default: () => props => { carouselProps = props; return React.createElement("div", { id: "carousel" }); } },
      "@/components/Common/CommonModalComponents": {
        ModalContainerCustom: ({ children, onOpened }) => {
          React.useEffect(() => { void onOpened(); }, []);
          return React.createElement("div", null, children);
        },
        ModalHintBar: () => null,
        ModalInput: React.forwardRef((props, ref) => React.createElement("input", { ...props, ref })),
        ModalListContainer: box,
        ModalRowElementContainer: ({ children, onClick, id }) => React.createElement("button", { onClick, id }, children),
      },
      "@/hooks/General/useHandleMouse": { default: () => ({ handleMouseEnter: () => {}, handleMouseLeave: () => {}, handleMouseMove: () => {} }) },
      "@/lib/constants/TaskDetail": { descriptionContainerId: descriptionId },
      "@/hooks/useFlag": { useFlag: key => { assert.equal(key, "htpr-7050-ctrl-o-links"); return enabled; } },
      "@/lib/flags/keys": { HTPR_7050_CTRL_O_LINKS_FLAG: "htpr-7050-ctrl-o-links" },
    }).default;
    await React.act(async () => renderer.render(React.createElement(LinksModal, { display: true, onClose: () => {}, currentTaskId: 99, commentId: "" })));
    const titles = [...document.querySelectorAll("button")].map(row => row.textContent);
    if (!enabled) {
      assert.deepEqual(titles, ["Related link"]);
      assert.equal(carouselProps, undefined);
      return;
    }
    for (const title of ["HTPR-1074", "HTPR-1108", "Related link", "report.pdf"]) assert.ok(titles.includes(title), title);
    const row = [...document.querySelectorAll("button")].find(row => row.textContent === "report.pdf");
    await React.act(async () => row.click());
    assert.ok(document.getElementById("carousel"));
    assert.equal(carouselProps.currentIndex, 0);
    assert.deepEqual(carouselProps.attachments, [{ fileSource: attachment.fileSource, fileType: "application/pdf", fileName: "report.pdf" }]);
  });
}

for (const enabled of [true, false]) {
  test(`URL route authorizes access before evaluating and forwarding flag ${enabled ? "on" : "off"}`, async () => {
    const calls = [];
    let authorized = true;
    const handler = load("src/pages/api/urls/fetchUrls.ts", {
      "@/utils/controllers/urls/fetchUrls": { default: async (...args) => { calls.push(args); return { status: 200, json: [] }; } },
      "@/lib/prisma": { default: { task: { findFirst: async ({ where }) => { assert.equal(where.id, 99); return authorized ? { id: 99 } : null; } } } },
      "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 7 }) },
      "@/lib/flags": {
        HTPR_7050_CTRL_O_LINKS_FLAG: "htpr-7050-ctrl-o-links",
        isFeatureEnabled: async (key, userId) => { assert.equal(key, "htpr-7050-ctrl-o-links"); assert.equal(userId, 7); assert.ok(authorized); return enabled; },
      },
      "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: userId => { assert.equal(userId, 7); return {}; } },
    }).default;
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    const req = { method: "GET", headers: {}, query: { taskId: "99", commentId: descriptionId } };
    await handler(req, res);
    assert.equal(res.code, 200);
    assert.deepEqual(calls, [["99", descriptionId, enabled]]);
    authorized = false;
    await handler(req, res);
    assert.equal(res.code, 404);
    assert.equal(calls.length, 1);
  });
}
