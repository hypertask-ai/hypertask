const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const flag = "htpr-7574-invite-picker-latest-members";
const grok = { id: "grok", displayName: "Grok Bot", revokedAt: null };
const membersResponse = (boardAgents = []) => ({
  members: [],
  boardAgents,
  teamMembers: [],
  emailsInvited: [],
});

async function withInvitePicker(flagEnabled, run) {
  const cached = new Map(Object.entries(require.cache));
  const globals = [
    "React", "window", "document", "HTMLElement", "fetch", "IS_REACT_ACT_ENVIRONMENT",
  ];
  const previousGlobals = new Map(
    globals.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)])
  );
  const requests = [];
  const currentProjectAtom = {};
  const currentUserAtom = {};
  const project = { id: 7574, teamId: 15 };
  const user = { id: 42, uid: "user-42" };
  let ownedAgents = [];
  let reactRoot;
  let dom;

  const stubModule = (file, exports) => {
    const filename = file.startsWith("src/")
      ? path.join(root, file)
      : require.resolve(file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };
  const passthrough = ({ children }) => React.createElement("div", null, children);
  const unexpected = () => assert.fail("Unexpected network or notification side effect");
  const props = {
    removeMember: () => undefined,
    addAgentToBoard: () => undefined,
    removeAgentFromBoard: () => undefined,
    inviteNewMember: () => undefined,
    reSendInvite: unexpected,
    cancelInvite: unexpected,
    closeHandler: () => undefined,
    startingScreen: "Home",
  };

  try {
    dom = new JSDOM('<div id="root"></div>', {
      url: "https://app.hypertask.ai/project/7574",
    });
    const browserGlobals = {
      React,
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
      fetch: (url, options) => {
        assert.equal(url, "/api/members/getAll?projectId=7574&teamMembers=true&teamId=15");
        assert.equal(options.method, "GET");
        let resolve;
        const promise = new Promise((done) => { resolve = done; });
        requests.push({ resolve });
        return promise;
      },
    };
    for (const [name, value] of Object.entries(browserGlobals)) {
      Object.defineProperty(global, name, { configurable: true, writable: true, value });
    }

    stubModule("src/hooks/MultiPages/useAgents.ts", {
      useAgents: () => ({ agents: ownedAgents }),
    });
    stubModule("src/hooks/useFlag.tsx", {
      useFlag: (key) => {
        assert.equal(key, flag);
        return flagEnabled;
      },
    });
    stubModule("src/store/index.ts", { currentProjectAtom, currentUserAtom });
    stubModule("src/lib/state.tsx", {
      useRecoilValue: (atom) => {
        if (atom === currentProjectAtom) return project;
        assert.equal(atom, currentUserAtom);
        return user;
      },
    });
    stubModule("src/utils/index.ts", { emailPattern: /\S+@\S+\.\S+/g });
    stubModule("src/hooks/Homepage/Invites/useGetBoardInviteURL.ts", {
      prefixInviteForProject: "board-invite",
      useGetBoardInviteURL: () => ({ data: { inviteLink: "https://example.test/invite" } }),
    });
    stubModule("axios", { default: { post: unexpected } });
    stubModule("@tanstack/react-query", {
      useQueryClient: () => ({ refetchQueries: unexpected }),
    });
    stubModule("react-hot-toast", {
      default: Object.assign(unexpected, { success: unexpected, error: unexpected }),
    });
    stubModule("lucide-react", {
      Bot: () => null,
      Copy: () => null,
      RefreshCw: () => null,
      Share2: () => null,
    });
    stubModule("src/components/Common/GuestLock/GuestSignupOverlay.tsx", {
      default: passthrough,
    });
    stubModule("src/lib/demo/isGuestClient.ts", { isGuestCookieUser: () => false });
    stubModule("src/components/Common/UserAvatar.tsx", { default: () => null });
    stubModule("src/components/Common/CommonModalComponents/index.tsx", {
      ModalContainerCustom: passthrough,
      ModalHeaderComp: ({ header }) => React.createElement("h1", null, header),
      ModalInput: (inputProps) => React.createElement("input", inputProps),
      ModalListContainer: React.forwardRef(({ children }, ref) =>
        React.createElement("ul", { ref }, children)
      ),
      ModalRowElementContainer: ({ children, id }) =>
        React.createElement("li", { id }, children),
    });

    const componentPath = path.join(root, "src/components/Modals/commands/inviteMember.tsx");
    // Each test must import against its own flag and owned-agent closures.
    delete require.cache[componentPath];
    const jiti = createJiti(__filename, {
      interopDefault: true,
      jsx: true,
      fsCache: false,
      alias: { "@": path.join(root, "src") },
    });
    const InviteMember = jiti(componentPath).default;
    const container = document.getElementById("root");
    reactRoot = createRoot(container);
    const render = async (agents) => {
      ownedAgents = agents;
      await React.act(async () => {
        reactRoot.render(React.createElement(InviteMember, props));
      });
    };
    const resolve = async (index, data = membersResponse()) => {
      assert.ok(requests[index], `Request ${index} must be pending`);
      await React.act(async () => {
        requests[index].resolve({ ok: true, json: async () => data });
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    await render([]);
    assert.equal(requests.length, 1, "Initial render starts fetch A");
    await run({ container, requests, render, resolve });
  } finally {
    try {
      if (reactRoot) await React.act(async () => reactRoot.unmount());
    } finally {
      dom?.window.close();
      for (const filename of Object.keys(require.cache)) {
        if (!cached.has(filename)) delete require.cache[filename];
      }
      for (const [filename, previous] of cached) require.cache[filename] = previous;
      for (const [name, descriptor] of previousGlobals) {
        if (descriptor === undefined) delete global[name];
        else Object.defineProperty(global, name, descriptor);
      }
    }
  }
}

test("flag ON ignores a superseded members response and keeps the addable owned agent", async () => {
  await withInvitePicker(true, async ({ container, requests, render, resolve }) => {
    assert.doesNotMatch(container.textContent, /Grok Bot/);
    await render([grok]);
    assert.equal(requests.length, 2, "Owned agents changing starts fetch B");

    await resolve(1);
    assert.match(container.textContent, /Grok Bot/);
    assert.match(container.textContent, /Add to board/);

    await resolve(0);
    assert.match(container.textContent, /Grok Bot/);
    assert.match(container.textContent, /Add to board/);
    assert.equal(requests.length, 2);
  });
});

test("flag OFF preserves the legacy race where the older response drops the owned agent", async () => {
  await withInvitePicker(false, async ({ container, requests, render, resolve }) => {
    await render([grok]);
    assert.equal(requests.length, 2, "Owned agents changing starts fetch B");

    await resolve(1);
    assert.match(container.textContent, /Grok Bot/);
    assert.match(container.textContent, /Add to board/);

    await resolve(0);
    assert.match(container.textContent, /Copy board join link/);
    assert.doesNotMatch(container.textContent, /Grok Bot/);
    assert.doesNotMatch(container.textContent, /Add to board/);
    assert.equal(requests.length, 2);
  });
});

test("flag ON handles in-order responses and does not duplicate a board agent as addable", async () => {
  await withInvitePicker(true, async ({ container, requests, render, resolve }) => {
    const boardAgent = { id: "claude", displayName: "Claude Bot", revokedAt: null };
    await resolve(0, membersResponse([boardAgent]));
    assert.match(container.textContent, /Claude Bot/);
    assert.doesNotMatch(container.textContent, /Grok Bot/);

    await render([grok, boardAgent]);
    assert.equal(requests.length, 2, "Owned agents changing starts fetch B");
    await resolve(1, membersResponse([boardAgent]));

    const rows = [...container.querySelectorAll("li")];
    const grokRows = rows.filter((row) => row.textContent.includes("Grok Bot"));
    const boardRows = rows.filter((row) => row.textContent.includes("Claude Bot"));
    assert.equal(grokRows.length, 1);
    assert.match(grokRows[0].textContent, /Add to board/);
    assert.equal(boardRows.length, 1, "An owned board agent appears only once");
    assert.match(boardRows[0].textContent, /Remove/);
    assert.doesNotMatch(boardRows[0].textContent, /Add to board/);
    assert.equal(requests.length, 2);
  });
});
