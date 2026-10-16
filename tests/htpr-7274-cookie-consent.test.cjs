const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(__dirname, "..", "src") },
});

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  return new Proxy(storage, {
    ownKeys: () => [...data.keys()],
    getOwnPropertyDescriptor: (_target, key) =>
      data.has(key) ? { enumerable: true, configurable: true, value: data.get(key) } : undefined,
  });
}

function fakeBrowser({ hostname = "app.hypertask.ai", protocol = "https:", local = {}, session = {}, cookies = {} } = {}) {
  const jar = new Map(Object.entries(cookies).map(([name, value]) => [name, { value, attributes: {} }]));
  const writes = [];
  const listeners = new Map();
  global.document = {
    get cookie() {
      return [...jar].map(([name, { value }]) => `${name}=${value}`).join("; ");
    },
    set cookie(raw) {
      writes.push(raw);
      const [pair, ...rest] = raw.split(";").map((part) => part.trim());
      const [name, value] = pair.split("=");
      const attributes = Object.fromEntries(
        rest.map((part) => {
          const [key, attr] = part.split("=");
          return [key.toLowerCase(), attr ?? true];
        }),
      );
      if (attributes["max-age"] === "0") jar.delete(name);
      else jar.set(name, { value, attributes });
    },
  };
  global.window = {
    location: { hostname, protocol },
    localStorage: memoryStorage(local),
    sessionStorage: memoryStorage(session),
    addEventListener: (type, fn) => listeners.set(fn, type),
    removeEventListener: (_type, fn) => listeners.delete(fn),
    dispatchEvent: (event) => {
      [...listeners].filter(([, type]) => type === event.type).forEach(([fn]) => fn(event));
      return true;
    },
  };
  global.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  return { jar, writes, window: global.window };
}

const consent = jiti(path.join(__dirname, "../src/lib/cookieConsent.ts"));

test("a fresh visitor has no choice, so the banner shows and tracking waits", () => {
  fakeBrowser();
  assert.equal(consent.getCookieConsent(), null);
});

test("accepting writes the shared hypertask.ai cookie the website also reads", () => {
  const browser = fakeBrowser();
  consent.setCookieConsent("all");
  const stored = browser.jar.get("ht_cookie_consent");
  assert.equal(stored.value, "all");
  assert.equal(stored.attributes.domain, ".hypertask.ai");
  assert.equal(stored.attributes.path, "/");
  assert.equal(stored.attributes["max-age"], "15552000");
  assert.equal(stored.attributes.samesite, "Lax");
  assert.equal(stored.attributes.secure, true);
  assert.equal(consent.getCookieConsent(), "all");
});

test("a choice made on hypertask.ai is honoured by the app", () => {
  fakeBrowser({ cookies: { ht_cookie_consent: "essential" } });
  assert.equal(consent.getCookieConsent(), "essential");
});

test("an old guest-board choice moves into the shared cookie once", () => {
  const browser = fakeBrowser({ local: { ht_cookie_consent: "all" } });
  assert.equal(consent.getCookieConsent(), "all");
  assert.equal(browser.jar.get("ht_cookie_consent").value, "all");
  assert.equal(browser.window.localStorage.getItem("ht_cookie_consent"), null);
});

test("rejecting removes PostHog and attribution storage but keeps the app's own data", () => {
  const browser = fakeBrowser({
    cookies: { ph_posthog_hypertask: "x", utm_data: "x", ip: "1.2.3.4", userAgent: "ua", session: "keep" },
    local: { ph_posthog_hypertask: "x", "recoil-persist": "keep" },
    session: { ph_posthog_hypertask_primary_window_exists: "x" },
  });
  consent.setCookieConsent("essential");
  assert.deepEqual([...browser.jar.keys()].sort(), ["ht_cookie_consent", "session"]);
  assert.deepEqual(Object.keys(browser.window.localStorage), ["recoil-persist"]);
  assert.deepEqual(Object.keys(browser.window.sessionStorage), []);
  assert.ok(browser.writes.some((raw) => raw.startsWith("ph_posthog_hypertask=") && raw.includes("Domain=.hypertask.ai")));
});

test("accepting keeps the app's existing storage untouched", () => {
  const browser = fakeBrowser({ cookies: { session: "keep" }, local: { "recoil-persist": "keep" } });
  consent.setCookieConsent("all");
  assert.equal(browser.jar.get("session").value, "keep");
  assert.equal(browser.window.localStorage.getItem("recoil-persist"), "keep");
});

test("listeners hear the new choice so tracking can start or stop at once", () => {
  fakeBrowser();
  const heard = [];
  const stop = consent.onCookieConsentChange((value) => heard.push(value));
  consent.setCookieConsent("all");
  stop();
  consent.setCookieConsent("essential");
  assert.deepEqual(heard, ["all"]);
});

test("previews and localhost keep the choice on their own host", () => {
  const browser = fakeBrowser({ hostname: "localhost", protocol: "http:" });
  consent.setCookieConsent("all");
  const stored = browser.jar.get("ht_cookie_consent");
  assert.equal(stored.attributes.domain, undefined);
  assert.equal(stored.attributes.secure, undefined);
  assert.equal(consent.consentCookieDomain("hypertask-git-x.vercel.app"), null);
  assert.equal(consent.consentCookieDomain("hypertask.ai"), ".hypertask.ai");
});
