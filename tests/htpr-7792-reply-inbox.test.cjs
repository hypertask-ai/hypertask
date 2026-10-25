const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-7792-reply-inbox";
const task = { id: 42, projectId: 15, _count: { notifications: 0 }, notifications: [] };
const row = { id: 71, taskId: 42, projectId: 15, userId: 985, status: "Normal" };

for (const missingCache of [false, true]) for (const enabled of [false, true]) for (const inboxFlow of [null, "true"]) for (const advance of [false, true]) {
  test(`reply uses current inbox membership: missing=${missingCache}, flag=${enabled}, flow=${inboxFlow}, advance=${advance}`, async () => {
    const view = mount();
    const saves = [];
    let editable = true;
    let html = "<p>Reply</p>";
    let notifications = missingCache ? undefined : [];
    const client = { getQueryData: () => notifications && ({ notifications }), setQueryData: () => {}, invalidateQueries: async () => {} };
    const mocks = {
      "@/lib/flags/keys": { HTPR_7792_REPLY_INBOX_FLAG: flag, HTPR_7659_ARCHIVE_EVERY_SEND_FLAG: "old-archive" },
      "@/hooks/useFlag": { useFlag: key => key === flag ? enabled : key === "old-archive" },
      "@tanstack/react-query": { useQueryClient: () => client },
      "@/hooks/Inbox/useGetNotifications": { prefetchInboxQuery: async () => { assert.equal(editable, false); html = "<p>Late change</p>"; notifications = [row]; } },
      "@/lib/state": { useRecoilState: () => [{ id: 985 }, () => {}], useSetRecoilState: () => () => {} },
      "@/store": {},
      "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: { inboxAdvanceOnSend: advance } }) },
      "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
      "./Tiptap": { default: () => ({ editor: { isEmpty: false, getHTML: () => html, getText: () => "Reply", setEditable: value => { editable = value; }, commands: { blur: () => {}, setContent: () => {} } } }) },
      "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ parsedTask: JSON.stringify(task) }) },
      "next/navigation": { useRouter: () => ({}), useSearchParams: () => new URLSearchParams(inboxFlow ? `inboxFlow=${inboxFlow}` : "") },
      "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({}) },
      "@/hooks/General/useMobileVisualViewport": { useMobileVisualViewport: () => null },
      "@/hooks/MultiPages/AIChat/useCommentToAiChat": { useCommentToAiChat: () => ({}) },
      "@/utils/api/Task Detail": {},
    };
    const load = loader(mocks);
    const { useTaskDetailEditorState } = load("src/components/RTE/useTaskDetailEditorState.tsx");
    const { useTaskDetailEditorSave } = load("src/components/RTE/useTaskDetailEditorSave.tsx");
    let context, actions;
    function Composer() {
      context = {
        ...useTaskDetailEditorState({ mode: "create-comment", allowEdit: true, id: "comment", handleSave: async params => { saves.push(params); return true; } }),
        invalidateUserDrafts: () => {},
      };
      actions = useTaskDetailEditorSave(() => context);
      return null;
    }
    try {
      view.render(React.createElement(Composer));
      assert.equal(context.inInbox, false);
      await React.act(async () => { assert.equal(await actions.sendComment(), true); });
      assert.equal(saves.length, 1);
      assert.equal(saves[0].content, "<p>Reply</p>");
      assert.equal(editable, true);
      assert.equal(saves[0].inbox, enabled);
      assert.equal(saves[0].navigateToNext, enabled && inboxFlow === "true" && advance);
      assert.equal(saves[0].inboxFlow, inboxFlow);
    } finally { view.close(); }
  });
}
