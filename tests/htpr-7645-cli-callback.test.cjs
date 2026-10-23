const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { JSDOM } = require('jsdom');
const ts = require('typescript');

const file = path.resolve(__dirname, '../src/app/cli-auth/page.tsx');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  },
  fileName: file,
}).outputText;
const code = 'dummy code+&=?#/%';

async function withPage(query, check) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://app.hypertask.ai/cli-auth',
  });
  const previous = new Map(
    ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [
      key, Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const minted = [];
  const navigated = [];
  const errors = [];
  let root;
  try {
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const mocks = {
      react: React,
      'next/navigation': {
        useSearchParams: () => new URLSearchParams(query),
        useRouter: () => ({ push: (url) => navigated.push(url) }),
      },
      'next/image': { __esModule: true, default: ({ alt }) => React.createElement('img', { alt }) },
      '@/hooks/General/useCurrentUserCheckFromCookies': {
        __esModule: true, default: () => ({ id: 42, email: 'fixture@example.test' }),
      },
      axios: { __esModule: true, default: {
        post: async (url) => { minted.push(url); return { data: { code } }; },
      } },
      'react-hot-toast': { toast: { success() {}, error: (message) => errors.push(message) } },
      '@/utils/undoActions/helperFuncs': { cn: (...values) => values.join(' ') },
      '@/assets/hypertaskLogoWhite.png': { __esModule: true, default: 'fixture.png' },
      '@/lib/auth/safeReturnTo': {
        POST_CLI_NEXT_REDIRECT_KEY: 'fixture-next',
        parseSafePostCliRedirect: () => null,
        CLI_CALLBACK_WINDOW_NAME: 'fixture-callback',
      },
      'lucide-react': { Copy: () => React.createElement('svg') },
    };
    const mod = { exports: {} };
    const browser = { location: { set href(url) { navigated.push(url); } } };
    new Function('require', 'module', 'exports', 'React', 'window', 'localStorage', 'console', compiled)(
      (name) => {
        assert.ok(Object.hasOwn(mocks, name), `unexpected import: ${name}`);
        return mocks[name];
      },
      mod, mod.exports, React, browser, dom.window.localStorage, { error() {} },
    );
    root = require('react-dom/client').createRoot(dom.window.document.getElementById('root'));
    await React.act(async () => root.render(React.createElement(mod.exports.default)));
    const container = dom.window.document.getElementById('root');
    const click = async (label) => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label);
      assert.ok(button, `missing button: ${label}`);
      await React.act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    };
    await check({ container, click, minted, navigated, errors });
  } finally {
    if (root) await React.act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
}

test('CLI authorize refuses malformed callback ports before minting', async () => {
  for (const port of [
    '3456@callback.example.test', '3456/callback', '3456?next=x', '3456#x',
    'abc', '3.5', '1e3', '0x50', ' 3456', '3456 ', '3456\n', '\t3456',
    '+3456', '-1', '0', '00000', '65536', '99999', '123456', '３４５６',
  ]) {
    await withPage(`port=${encodeURIComponent(port)}`, async ({ container, click, minted, navigated, errors }) => {
      await click('Allow and continue');
      assert.match(container.textContent, /Failed to generate authentication code/);
      assert.equal(container.querySelector('#cli-callback-url'), null);
      assert.equal(container.querySelector('#cli-auth-code'), null);
      assert.deepEqual(minted, [], port);
      assert.deepEqual(navigated, [], port);
      assert.equal(errors.length, 1);
    });
  }
});

test('CLI authorize keeps numeric callbacks on localhost', async () => {
  for (const [query, port] of [
    ['', 3456], ['port=', 3456], ['port=4567', 4567],
    ['port=1', 1], ['port=65535', 65535], ['port=00080', 80],
  ]) {
    await withPage(query, async ({ container, click, minted, navigated, errors }) => {
      assert.deepEqual(minted, []);
      await click('Allow and continue');
      assert.deepEqual(minted, ['/api/cli/generate-code']);
      assert.deepEqual(navigated, []);
      assert.deepEqual(errors, []);
      assert.equal(container.querySelector('#cli-auth-code').value, code);
      const callback = container.querySelector('#cli-callback-url').value;
      assert.equal(callback, `http://localhost:${port}/callback?code=${encodeURIComponent(code)}`);
      const url = new URL(callback);
      assert.equal(url.protocol, 'http:');
      assert.equal(url.hostname, 'localhost');
      assert.equal(url.username, '');
      assert.equal(url.password, '');
      assert.equal(url.pathname, '/callback');
      assert.deepEqual([...url.searchParams], [['code', code]]);
      assert.equal(url.hash, '');
      await click("I'm on the same device");
      assert.deepEqual(navigated, [callback]);
    });
  }
});

test('CLI consent cancellation does not mint or navigate', async () => {
  await withPage('port=4567', async ({ container, click, minted, navigated }) => {
    await click('Cancel');
    assert.match(container.textContent, /You chose not to connect the CLI/);
    assert.deepEqual(minted, []);
    assert.deepEqual(navigated, []);
  });
});
