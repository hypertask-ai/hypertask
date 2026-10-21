const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(__dirname, "..", "src") },
});

function fakeBrowser({ cookie = "", local = {} } = {}) {
  const data = new Map(Object.entries(local));
  const listeners = [];
  global.document = { cookie };
  global.window = {
    localStorage: {
      getItem: (key) => (data.has(key) ? data.get(key) : null),
      setItem: (key, value) => data.set(key, String(value)),
    },
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const index = listeners.findIndex((entry) => entry.type === type && entry.fn === fn);
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatchEvent: (event) =>
      listeners.filter((entry) => entry.type === event.type).forEach((entry) => entry.fn(event)),
  };
  global.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  return { data };
}

const consent = () => jiti("@/lib/cookieConsent");
const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("a rejection saved as the shared consent cookie is still honoured", () => {
  fakeBrowser({ cookie: "other=1; ht_cookie_consent=essential" });
  assert.equal(consent().getCookieConsent(), "essential");
});

test("the older localStorage choice still counts when no cookie is set", () => {
  fakeBrowser({ local: { ht_cookie_consent: "all" } });
  assert.equal(consent().getCookieConsent(), "all");
});

test("no saved choice reads as null", () => {
  fakeBrowser();
  assert.equal(consent().getCookieConsent(), null);
});

test("saving a choice stores it and tells listeners at once", () => {
  const { data } = fakeBrowser();
  const heard = [];
  const stop = consent().onCookieConsentChange((value) => heard.push(value));
  consent().setCookieConsent("essential");
  stop();
  consent().setCookieConsent("all");
  assert.equal(data.get("ht_cookie_consent"), "all");
  assert.deepEqual(heard, ["essential"]);
});

test("rejecting stops browser tracking and attribution skips after a rejection", () => {
  assert.match(
    source("src/components/Analytics/PostHogAnalytics.tsx"),
    /onCookieConsentChange\([\s\S]*?consent !== "essential"[\s\S]*?stopSessionRecording\(\);[\s\S]*?opt_out_capturing\(\);/,
  );
  assert.match(
    source("src/components/analytics/StoreUTM.tsx"),
    /if \(getCookieConsent\(\) !== "essential"\) void captureUTMData\(\);/,
  );
});

test("the banner is back to guests without an account only", () => {
  assert.match(
    source("src/components/ProviderGlobal/GloablProviders.tsx"),
    /\{!currentUser && <CookieConsentBanner \/>\}/,
  );
  assert.match(
    source("src/components/Global/CookieConsentBanner.tsx"),
    /setShouldRender\(isGuestCookieUser\(\) && getCookieConsent\(\) === null\)/,
  );
});
