const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const file = path.join(root, "src/app/oauth/success/page.tsx");

function renderPage(query) {
  const mocks = {
    "next/navigation": {
      useSearchParams: () => new URLSearchParams(query),
      useRouter: () => ({ push() {} }),
    },
    "next/image": { __esModule: true, default: (props) => React.createElement("img", { alt: props.alt }) },
  };
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "React", compiled)(
    (name) => mocks[name] ?? (name.startsWith("@/") ? jiti(name) : require(name)),
    mod, mod.exports, React,
  );
  return renderToStaticMarkup(React.createElement(mod.exports.default));
}

for (const uri of ["javascript:alert(document.cookie)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "http://evil.example/cb", "vbscript:msgbox(1)"]) {
  for (const code of ["", "&code=abc"]) {
    test(`success page refuses to return to ${uri}${code ? " with code" : ""}`, () => {
      const html = renderPage(`redirect_uri=${encodeURIComponent(uri)}${code}`);
      assert.doesNotMatch(html, /return to client/i);
      assert.match(html, /Return to your MCP client to finish setup/);
    });
  }
}

for (const uri of ["cursor://oauth/callback", "https://claude.ai/api/mcp/callback", "http://localhost:3000/callback"]) {
  test(`success page still offers return to ${uri}`, () => {
    assert.match(renderPage(`redirect_uri=${encodeURIComponent(uri)}`), />Return to client</);
    assert.match(renderPage(`redirect_uri=${encodeURIComponent(uri)}&code=abc`), /Authorize &amp; return to client/);
  });
}
