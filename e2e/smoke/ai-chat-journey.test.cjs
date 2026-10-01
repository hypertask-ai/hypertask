const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");

const root = path.resolve(__dirname, "../..");
let journey;
let browser;
const register = (title, _options, callback) => {
  if (title === "ai chat replies") journey = callback;
};
register.beforeEach = register.afterEach = register.setTimeout = () => {};
register.skip = (condition) => assert.equal(condition, false, "journey must not skip");

// Keep negative fixtures fast without changing the live journey's timeout.
const fixtureExpect = (value, message) => {
  const matchers = expect(value, message);
  return new Proxy(matchers, {
    get(target, property) {
      if (property === "toHaveCount") {
        return (count, options) => target.toHaveCount(count, { ...options, timeout: 1_500 });
      }
      return target[property];
    },
  });
};
const playwrightPath = require.resolve("@playwright/test");
const originalModule = require.cache[playwrightPath];
require.cache[playwrightPath] = {
  id: playwrightPath,
  filename: playwrightPath,
  loaded: true,
  exports: { test: register, expect: fixtureExpect },
};
try {
  const jiti = require("jiti")(__filename, {
    interopDefault: true,
    cache: false,
    alias: { "@": path.join(root, "src") },
  });
  jiti(path.join(root, "e2e/smoke/journeys.spec.ts"));
} finally {
  require.cache[playwrightPath] = originalModule;
}
assert.equal(typeof journey, "function", "load the real journey, not a copy");

test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser?.close(); });

async function runJourney({ history = true, reply = "Hypertask helps teams organize work." } = {}) {
  const page = await browser.newPage({ baseURL: "http://127.0.0.1:3100" });
  try {
    await page.route("**/chat**", (route) => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html>
        <button id="new-chat">New chat</button>
        <div id="messages"></div>
        <div id="ai-chat-tiptap-editor"><div class="ProseMirror" contenteditable="true"></div></div>
        <script>
          const messages = document.querySelector('#messages');
          const editor = document.querySelector('.ProseMirror');
          function add(text, delivered = true) {
            const message = document.createElement('div');
            message.className = 'submessage-container ' + (delivered ? 'delivered' : 'typing');
            const content = document.createElement('div');
            content.className = 'content-html';
            content.textContent = text;
            message.append(content);
            messages.append(message);
            return message;
          }
          if (${history}) {
            add('In one short sentence, what is Hypertask?');
            add('An old reply must not satisfy this run.');
          }
          document.querySelector('#new-chat').onclick = () => {
            // Session creation is asynchronous, not an immediate DOM reset.
            setTimeout(() => {
              messages.replaceChildren();
              window.history.replaceState({}, '', '/chat/fixture-session');
              editor.focus();
            }, 50);
          };
          editor.onkeydown = (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const prompt = editor.textContent;
            editor.textContent = '';
            add(prompt);
            const reply = ${JSON.stringify(reply)};
            if (reply === null) return;
            const response = add(reply, false);
            setTimeout(() => response.className = 'submessage-container delivered', 50);
          };
        </script>`,
    }));
    await journey({ page });
    assert.equal(await page.locator('.submessage-container.delivered').count(), 2);
  } finally {
    await page.close();
  }
}

test("AI journey starts a fresh chat despite saved history", () => runJourney());
test("AI journey also works for an account without messages", () => runJourney({ history: false }));
test("saved replies cannot conceal a missing new reply", async () => {
  await assert.rejects(runJourney({ reply: null }), /no AI reply arrived/);
});
test("AI journey rejects an empty reply", async () => {
  await assert.rejects(runJourney({ reply: "" }), /AI reply was empty/);
});
test("AI journey rejects a prompt echo", async () => {
  await assert.rejects(runJourney({ reply: "In one short sentence, what is Hypertask?" }), /not an AI reply/);
});
for (const reply of [
  "Sorry, an error occurred while processing your request.",
  "Stream cancelled.",
  "Sorry, I'm having trouble responding right now.",
]) {
  test(`AI journey rejects failure text: ${reply}`, async () => {
    await assert.rejects(runJourney({ reply }), /AI reply was an error/);
  });
}
