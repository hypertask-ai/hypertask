const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-7509-agent-role-screen";
const legend = "Read sees boards and tasks. Write also edits tasks and creates boards. Admin also gives other agents access.";
const labels = ["Read · sees boards and tasks", "Write · edits tasks, creates boards", "Admin · also gives other agents access"];
const box = ({ children }) => React.createElement("div", null, children);

function harness({ enabled = true, owner = true, failSave = false, showBoards = true, forceRoles = false, userId } = {}) {
  const state = { teamId: "team", calls: [], notices: [], flagReads: [] };
  const seeds = [
    { id: "read-agent", displayName: "Reader", role: "read", revokedAt: "2026-10-01" },
    { id: "write-agent", displayName: "Writer", role: "write" },
    { id: "admin-agent", displayName: "Administrator", role: "admin" },
    { id: "legacy-agent", displayName: "Legacy" },
  ].map(agent => ({ ...agent, boards: [{ id: 15, name: "Team board" }] }));
  const load = loader({
    "@/hooks/useFlag": { useFlag: key => { state.flagReads.push(key); return key === flag && enabled; } },
    "@/lib/flags/keys": { HTPR_7509_AGENT_ROLE_SCREEN_FLAG: flag },
    "@/lib/state": { useRecoilValue: () => ({ id: userId ?? (owner ? 6 : 7) }) },
    "@/store": { currentUserAtom: {} },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/components/Common/UserAvatar": { default: () => React.createElement("span", { "data-avatar": true }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "./useSettingsTeam": { useSettingsTeam: () => ({
      project: { id: 15 }, teamId: state.teamId, ownerAndMembers: { owner: { id: 6 } },
    }) },
    "@/hooks/MultiPages/useAgents": { useAgents: () => {
      const [agents, setAgents] = React.useState(seeds);
      return { agents, isLoading: false, changeAgentRole: { isPending: false, mutate: (vars, callbacks) => {
        state.calls.push(vars);
        if (failSave) return callbacks.onError(new Error("Save refused"));
        setAgents(rows => rows.map(agent => agent.id === vars.id ? { ...agent, role: vars.role } : agent));
        callbacks.onSuccess();
      } } };
    } },
    "react-hot-toast": { default: {
      success: message => state.notices.push(message), error: message => state.notices.push(message),
    } },
    "reactstrap": { ModalBody: box },
    "@/hooks/General/useHandleMouse": { default: () => ({
      handleMouseEnter: () => {}, handleMouseLeave: () => {}, handleMouseMove: () => {}, elRef: { current: null },
    }) },
    "@/components/Common/CommonModalComponents": {
      ModalContainerCustom: box,
      ModalHeaderComp: ({ header }) => React.createElement("h2", null, header),
      ModalInput: ({ value, placeholder, onChange }) => React.createElement("input", { value, placeholder, onChange }),
      ModalListContainer: box,
      ModalRowElementContainer: ({ children, onClick, id }) => React.createElement("button", { onClick, id }, children),
    },
  });
  const Component = load("src/components/Modals/Settings/TeamAgentsSection.tsx").default;
  const List = load("src/components/Modals/Settings/AgentSettingsList.tsx").default;
  const view = mount();
  const element = showBoards ? React.createElement(Component) : React.createElement(List, { agents: seeds, isLoading: false, emptyLabel: "None", showRoles: forceRoles });
  view.render(element);
  const buttons = () => [...view.container.querySelectorAll("button")];
  const click = element => React.act(() => element.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  return { ...view, state, buttons, click, rerender: () => view.render(React.createElement(Component)) };
}

for (const enabled of [false, true]) {
  for (const owner of [false, true]) {
    test(`${owner ? "owner" : "member"} sees approved role screen with flag ${enabled ? "On" : "Off"}`, () => {
      const h = harness({ enabled, owner });
      try {
        assert.ok(h.container.textContent.includes("Agents attached to boards in the selected team."));
        assert.equal(h.container.textContent.includes(legend), enabled);
        assert.equal(h.buttons().filter(button => button.textContent === "Change role").length, enabled && owner ? 4 : 0);
        const roles = [...h.container.querySelectorAll("span")].filter(span => ["Read", "Write", "Admin"].includes(span.textContent));
        assert.deepEqual(roles.map(span => span.textContent), enabled ? ["Read", "Write", "Admin", "Write"] : []);
        assert.ok(h.container.textContent.includes("Disabled"));
        assert.ok(h.container.textContent.includes("Team board"));
        assert.ok(h.state.flagReads.filter(key => key === flag).length >= 2);
      } finally { h.close(); }
    });
  }
}

test("Change role opens the existing command option picker with exact labels and Current hint", async () => {
  const h = harness();
  try {
    h.click(h.buttons().find(button => button.textContent === "Change role"));
    assert.ok(h.container.textContent.includes("Role for Reader"));
    assert.deepEqual(h.buttons().filter(button => button.id.startsWith("option-picker-")).map(button => button.textContent), [labels[0] + "Current", labels[1], labels[2]]);
    await React.act(async () => {
      h.container.querySelector("#option-picker-2").click();
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.deepEqual(h.state.calls, [{ id: "read-agent", role: "admin" }]);
    assert.equal(h.container.textContent.includes("Role for Reader"), false);
    assert.equal([...h.container.querySelectorAll("span")].filter(span => span.textContent === "Admin").length, 2);
    assert.deepEqual(h.state.notices, ["Reader is now Admin"]);
  } finally { h.close(); }
});

test("failed save keeps the previous chip and shows the API error", async () => {
  const h = harness({ failSave: true });
  try {
    h.click(h.buttons()[0]);
    await React.act(async () => {
      h.container.querySelector("#option-picker-2").click();
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.ok([...h.container.querySelectorAll("span")].some(span => span.textContent === "Read"));
    assert.deepEqual(h.state.notices, ["Save refused"]);
  } finally { h.close(); }
});

test("Escape closes only the picker without saving", () => {
  const h = harness();
  try {
    h.click(h.buttons()[0]);
    React.act(() => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(h.container.textContent.includes("Role for Reader"), false);
    assert.deepEqual(h.state.calls, []);
  } finally { h.close(); }
});

test("board-scoped lists remain unchanged even when the team role flag is On", () => {
  const h = harness({ showBoards: false });
  try {
    assert.equal(h.buttons().length, 0);
    assert.equal([...h.container.querySelectorAll("span")].some(span => span.textContent === "Read"), false);
  } finally { h.close(); }
});


test("the row's own flag check hides roles even if a caller requests them", () => {
  const h = harness({ enabled: false, showBoards: false, forceRoles: true });
  try {
    assert.equal([...h.container.querySelectorAll("span")].some(span => span.textContent === "Read"), false);
  } finally { h.close(); }
});

test("changing teams dismisses the previous agent's picker", () => {
  const h = harness();
  try {
    h.click(h.buttons()[0]);
    assert.ok(h.container.textContent.includes("Role for Reader"));
    h.state.teamId = "another-team";
    h.rerender();
    assert.equal(h.container.textContent.includes("Role for Reader"), false);
    assert.deepEqual(h.state.calls, []);
  } finally { h.close(); }
});

test("an owner whose cookie stores a string user ID still gets the role button", () => {
  const h = harness({ userId: "6" });
  try {
    assert.equal(h.buttons().filter(button => button.textContent === "Change role").length, 4);
  } finally { h.close(); }
});
