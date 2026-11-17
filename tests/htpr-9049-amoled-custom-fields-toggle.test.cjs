const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") }, fsCache: false });
const { default: definition, HTPR_9049_AMOLED_CUSTOM_FIELDS_TOGGLE_FLAG: key } = jiti(
  path.join(root, "src/lib/flags/definitions/htpr-9049-amoled-custom-fields-toggle.ts"),
);

const amoledClass = "[.amoled_&]:bg-shadcn-primary";

function renderModal(enabled) {
  const fields = [
    { id: "field-1", name: "Priority", type: "TEXT", showInRail: true, showInTable: false, valueCount: 0 },
  ];
  const Modal = loadModule("src/components/Modals/CustomField/ManageCustomFieldsModal.tsx", {
    "@/lib/state": { useRecoilValue: () => ({ title: "Launch" }) },
    "@/store": { currentProjectAtom: {} },
    "@prisma/client": { CustomFieldType: {} },
    "@/components/Common/CommonModalComponents": {
      ModalContainerCustom: ({ children }) => React.createElement("div", null, children),
      ModalHeaderComp: () => null,
    },
    reactstrap: {
      ModalBody: ({ children }) => React.createElement("div", null, children),
      ModalFooter: ({ children }) => React.createElement("div", null, children),
    },
    "../Common Modals/ConfirmActionModal": { default: () => null },
    "@tanstack/react-query": {
      useQuery: () => ({ data: fields }),
      useQueryClient: () => ({ setQueryData() {}, invalidateQueries() {} }),
    },
    axios: { default: { get: async () => ({ data: fields }) } },
    "react-hot-toast": { default: { error() {} } },
    "@hello-pangea/dnd": {
      DragDropContext: ({ children }) => children,
      Droppable: ({ children }) => children({ innerRef: null, droppableProps: {}, placeholder: null }),
      Draggable: ({ children }) => children({ innerRef: null, draggableProps: {}, dragHandleProps: {} }),
    },
    "lucide-react": { Menu: () => null, Trash2: () => null },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/hooks/useFlag": {
      useFlag: (asked) => {
        assert.equal(asked, key);
        return enabled;
      },
    },
  }).default;

  const html = renderToStaticMarkup(React.createElement(Modal, { closeHandler() {}, projectId: 15 }));
  return new JSDOM(html).window.document;
}

function toggleTrack(document, label) {
  return document.querySelector(`button[aria-label="${label}"] span`);
}

test("custom fields toggle colour ships behind its own Owner + QA bugfix flag", () => {
  assert.equal(key, "htpr-9049-amoled-custom-fields-toggle");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
});

test("AMOLED on-state switches to the neutral accent when the flag is on", () => {
  const document = renderModal(true);
  const rail = toggleTrack(document, "Rail");
  assert.equal(rail.classList.contains("bg-hypertasks-green"), true);
  assert.equal(rail.classList.contains(amoledClass), true);
});

test("the unchecked switch keeps the off colour with the flag on", () => {
  const document = renderModal(true);
  const table = toggleTrack(document, "Table");
  assert.equal(table.classList.contains("bg-hover-active"), true);
  assert.equal(table.classList.contains(amoledClass), false);
});

test("flag off keeps the plain green switch", () => {
  const document = renderModal(false);
  const rail = toggleTrack(document, "Rail");
  assert.equal(rail.classList.contains("bg-hypertasks-green"), true);
  assert.equal(rail.classList.contains(amoledClass), false);
});
