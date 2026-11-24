const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const message = "Part of the team? You're almost there to begin working in Hypertask";

const MobileViewContext = React.createContext(false);

function footer(flagOn) {
  return load("src/components/PageComponents/TaskDetail/SharedTask/Footer/Footer.tsx", {
    "@/models/model": {},
    "@prisma/client": {},
    "next/navigation": { useRouter: () => ({ push() {} }) },
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/hooks/useFlag": { useFlag: () => flagOn },
  }).default;
}

function inviteHtml(mobile, flagOn = true) {
  return renderToStaticMarkup(
    React.createElement(
      MobileViewContext.Provider,
      { value: mobile },
      React.createElement(footer(flagOn), { shareId: "share-9546" }, React.createElement("main", null, "HOME-9")),
    ),
  );
}

function inviteText(html) {
  const dom = new JSDOM(html);
  const sentence = [...dom.window.document.querySelectorAll("p, div, span")].find((node) => {
    const own = [...node.childNodes]
      .filter((child) => child.nodeType === 3)
      .map((child) => child.textContent)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    return own === message;
  });
  const action = [...dom.window.document.querySelectorAll("div")].find((node) => node.textContent === "Sign up or Login");
  return {
    sentence: sentence ? sentence.textContent.replace(/\s+/g, " ").trim() : "",
    actionInsideSentence: sentence ? sentence.textContent.includes("Sign up or Login") : true,
    action: action ? action.textContent : "",
    stacked: Boolean(sentence && sentence.parentElement.className.includes("flex-col")),
    ticket: dom.window.document.querySelector("main")?.textContent ?? "",
  };
}

function followerNames(rows) {
  const relativePath = "src/components/PageComponents/TaskDetail/SharedTask/MainPage/shareFollowers.ts";
  if (!fs.existsSync(path.join(root, relativePath))) return null;
  const { shareFollowerPeople } = load(relativePath, { "@/models/model": {} });
  const people = shareFollowerPeople(rows);
  return people.map((person) => person.displayName);
}

const taskDetailApi = load("src/utils/api/Task Detail/index.ts", {
  "@/models/model": {},
  "@prisma/client": {},
  axios: { default: { post: async () => Promise.reject(new Error("refused")), get: async () => ({}) } },
  "@/utils/api/global/apiHelpers/getTaskDetailMeta": {
    hasSessionCookie: () => false,
    getTaskDetailMeta: async () => ({}),
  },
  "@/lib/constants/APIRouteConstants": { shareLinkRoute: () => "" },
  "@/hooks/General/useGetUserPreferences": { fetchUserPreference: async () => ({}), USER_PREFERENCES_QUERY_KEY: [] },
  "@/lib/storage/uploadViaApi": { uploadFilesViaApi: async () => [] },
  "@/lib/analytics/taskDetailPhaseTimings": { markTaskDetailPhase() {}, TASK_DETAIL_COMMENTS_REQUEST_MARK: "comments" },
});

test("a phone guest sees the invite sentence and the sign-in action on separate lines", () => {
  const phone = inviteText(inviteHtml(true));
  const desktop = inviteText(inviteHtml(false));
  assert.equal(phone.ticket, "HOME-9");
  assert.equal(phone.sentence, message);
  assert.equal(phone.action, "Sign up or Login");
  assert.equal(phone.actionInsideSentence, false);
  assert.equal(phone.stacked, true);
  assert.equal(desktop.sentence, message);
  assert.equal(desktop.action, "Sign up or Login");
  assert.equal(desktop.actionInsideSentence, false);
  assert.equal(desktop.stacked, false);
});

test("the phone layout is revertable by its flag and the desktop row stays the same", () => {
  const flagOff = inviteText(inviteHtml(true, false));
  assert.equal(flagOff.ticket, "HOME-9");
  assert.equal(flagOff.sentence, message);
  assert.equal(flagOff.action, "Sign up or Login");
  assert.equal(flagOff.actionInsideSentence, false);
  assert.equal(flagOff.stacked, false);
  assert.equal(inviteText(inviteHtml(false, false)).stacked, false);
});

test("a shared follower list keeps named people and drops a missing account", () => {
  assert.deepEqual(followerNames(undefined), []);
  assert.deepEqual(
    followerNames([
      { user: null },
      { user: { id: 1, displayName: "Franziska Mayer", photoURL: null } },
      { agent: { id: "agent-1", displayName: "Private agent", photoURL: null } },
    ]),
    ["Franziska Mayer", "Private agent"],
  );
});

test("a refused guest follower read answers with an empty list", async () => {
  assert.deepEqual(await taskDetailApi.getAllFollowers(9546), []);
});
