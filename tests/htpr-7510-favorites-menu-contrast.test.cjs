const test = require("node:test");
const assert = require("node:assert/strict");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-7510-favorites-menu-contrast";
const triggerClass = "dropdown border-[1px] border-black items-center relative flex rounded cursor-pointer";
const dividerClass = "border-l-[1px]  px-2 py-[2px] h-full grid place-items-center border-black";
const listClass = "dropdown-menu absolute flex max-h-[364px] w-[244px] cursor-auto flex-col overflow-y-scroll rounded-sm bg-modalBackground shadow-customshadow-2 p-4";
const resetClass = "cursor-pointer font-medium pb-[1px] mb-[8px] ";
const boardClass = "flex h-[36px] cursor-pointer items-center rounded-sm px-3 text-dense font-medium hover:bg-hover-active";

for (const enabled of [false, true]) {
  test(`favorites menu flag ${enabled}: classes, slots, scrolling and selection`, async () => {
    const ui = mount();
    const scrolls = [];
    const writes = [];
    const refetches = [];
    const teams = [{ id: 1, title: "Team", projects: [{ id: 42, title: "Board" }] }];
    const favorites = [];
    const user = { id: 985, UserSettingId: 12 };
    const box = ({ children, className, id }) => React.createElement("div", { className, id }, children);
    const load = loader({
      "@/hooks/useFlag": { useFlag: key => { assert.equal(key, flag); return enabled; } },
      "@/lib/flags/keys": { HTPR_7510_FAVORITES_MENU_CONTRAST_FLAG: flag },
      "@/store": { currentUserAtom: {} },
      "@/lib/state": { useRecoilState: () => [user, () => {}] },
      "@/hooks/MultiPages/useGetAllFavorites": { useGetAllFavorites: () => ({ data: favorites }) },
      "@/hooks/MultiPages/useGetAllTeamsMinimal": { useGetAllTeamsMinimal: () => ({ data: teams }) },
      "@tanstack/react-query": { useQueryClient: () => ({ refetchQueries: query => refetches.push(query) }) },
      "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
      "@/components/Common/CommonModalComponents": { ModalContainerCustom: box, ModalHeaderComp: box },
      "reactstrap": { ModalBody: box },
      "axios": { default: {
        post: async (...args) => writes.push(["post", ...args]),
        put: async (...args) => writes.push(["put", ...args]),
      } },
    });
    HTMLElement.prototype.scrollIntoView = function (options) { scrolls.push({ id: this.id, options }); };
    try {
      const Dialog = load("src/components/Modals/ManageFavorites/index.tsx").default;
      ui.render(React.createElement(Dialog, { onClose() {} }));
      const triggers = [...ui.container.querySelectorAll('[id="dropdownSelectors"]')];
      assert.equal(triggers.length, 10);
      for (const trigger of triggers) {
        assert.equal(trigger.className, enabled ? triggerClass.replace("border-black", "border-border-light-gray-thin") : triggerClass);
        assert.equal(trigger.children[1].className, enabled ? dividerClass.replace("border-black", "border-border-light-gray-thin") : dividerClass);
        React.act(() => trigger.firstElementChild.click());
        const list = ui.container.querySelector("#listContainer");
        assert.equal(list.parentElement, trigger);
        assert.equal(list.style.top, "100%");
        assert.equal(list.style.bottom, "auto");
        assert.equal(list.className, enabled ? `${listClass} text-white-black` : listClass);
        assert.equal(list.firstElementChild.className, enabled ? `${resetClass}text-white-black hover:bg-hover-active` : resetClass);
        assert.equal(list.firstElementChild.textContent, "Do Nothing");
        assert.equal(list.querySelector("span").className, "text-micro font-semibold uppercase tracking-wider text-text-light-gray");
        const board = [...list.querySelectorAll("li")].find(item => item.textContent === "Board");
        assert.equal(board.className, enabled ? `${boardClass} text-white-black` : boardClass);
        assert.equal(ui.container.querySelectorAll('[id="dropdownSelectors"]').length, 10);
        assert.deepEqual(scrolls.at(-1), { id: "listContainer", options: { behavior: "smooth", block: enabled ? "nearest" : "center", inline: "start" } });
        if (trigger !== triggers.at(-1)) React.act(() => trigger.firstElementChild.click());
      }
      assert.equal(scrolls.length, 10);
      const board = [...ui.container.querySelectorAll("#listContainer li")].find(item => item.textContent === "Board");
      await React.act(async () => board.click());
      assert.deepEqual(writes, [["post", "/api/favorites/addEditFavorites", { userSettingId: 12, index: 0, projectId: 42 }]]);
      assert.equal(ui.container.querySelector("#listContainer"), null);
      React.act(() => triggers[0].firstElementChild.click());
      await React.act(async () => ui.container.querySelector("#listContainer li").click());
      assert.deepEqual(writes[1], ["put", "/api/favorites/addEditFavorites", { userSettingId: 12, index: 1, projectId: -1 }]);
      assert.deepEqual(refetches, [{ queryKey: ["getAllFavorites"] }, { queryKey: ["getAllFavorites"] }]);
      assert.equal(ui.container.querySelector("#listContainer"), null);
    } finally {
      ui.close();
    }
  });
}

test("favorites contrast flag is a small default-Everyone bugfix", () => {
  const definition = loader()("src/lib/flags/definitions/htpr-7510-favorites-menu-contrast.ts").default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.shippedOn, "2026-10-21");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length > 0);
  assert.equal(definition.releaseRisk.highRisk, undefined);
});
