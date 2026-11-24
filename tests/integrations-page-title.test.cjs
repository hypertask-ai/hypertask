const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

test("the integrations page names the browser tab", () => {
  const page = loadModule("src/app/integrations/page.tsx", {
    "./IntegrationsComponent": { default: function IntegrationsComponent() { return null; } },
  });
  assert.equal(page.metadata && page.metadata.title, "Integrations");
});
