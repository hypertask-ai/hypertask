const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/loadModule.cjs');
const React = require('react');
const { JSDOM } = require('jsdom');

const layoutKey = 'htpr-9277-boat-dev-model';
const agentKey = 'htpr-7552-agent-code-signin';
const flags = { HTPR_9277_BOAT_DEV_MODEL_FLAG: layoutKey, HTPR_7552_AGENT_CODE_SIGNIN_FLAG: agentKey };

async function withLogin(props, check) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/login' });
  dom.window.PublicKeyCredential = function PublicKeyCredential() {};
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).concat('fetch').map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const calls = [];
  let root;
  try {
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    globalThis.fetch = async (url, options) => {
      calls.push({ url, ...options });
      return { ok: true, json: async () => ({ success: true }) };
    };
    const mocks = {
      'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
      'next/navigation': { useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push() {} }) },
      'next/font/google': { Newsreader: () => ({ className: 'newsreader' }) },
      'next/image': { default: ({ priority, ...rest }) => React.createElement('img', rest) },
      './Login-2-AB-test': { default: () => null },
      '@/lib/fonts/ibmPlexMono': { ibmPlexMono: { className: 'mono' } },
      '@/components/LoadingSpinners/LoadingSpinner1': { default: () => null },
      '@/hooks/General/useAuth': { useAuth: () => ({ isAuthenticating: false, loginWithGoogle: (...args) => calls.push({ provider: 'google', args }) }) },
      '@/hooks/MultiPages/useFunnelCookies': { default: () => ({ isFunnelUserAndTutorialCompleted: false }) },
      '@/hooks/General/useUTMs': { useUTM: () => ({ getUTMData: () => ({}) }) },
      '@/hooks/useFlag': { useFlag: () => false },
      '@/lib/flags/keys': {},
      '@/lib/auth/betterAuthClient': { authClient: { signIn: { social: async (options) => { calls.push(options); return {}; } } } },
      '@/lib/configs/auth.config': { default: { onboarding: {}, redirect: { afterLogin: '/my-tasks' }, emailLink: { troubleshootingUrl: 'https://hypertask.ai/help' } } },
      '@/lib/auth/safeReturnTo': { parseSafeReturnTo: () => null, POST_LOGIN_REDIRECT_STORAGE_KEY: 'returnTo' },
      '@/lib/analytics/signupIdentityClient': { getSignupContextInput: async () => ({}) },
      '@/utils/undoActions/helperFuncs': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    };
    const Component = loadModule('src/app/login/LoginComponent.tsx', mocks).default;
    root = require('react-dom/client').createRoot(dom.window.document.getElementById('root'));
    await React.act(async () => root.render(React.createElement(Component, props)));
    await check({ container: dom.window.document.getElementById('root'), calls, dom });
  } finally {
    if (root) await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('flag off preserves the full existing login regardless of the agent flag', async () => {
  let before;
  await withLogin({}, ({ container }) => { before = container.innerHTML; });
  await withLogin({ boatDevModel: false, agentCodeSignIn: true }, ({ container }) => {
    assert.equal(container.innerHTML, before);
    assert.match(container.textContent, /Free collaborative project boards for the agent/);
    assert.ok(container.querySelector('[aria-label="Pricing"]'));
    assert.equal(container.querySelector('a[href="/login/agent"]'), null);
  });
});

for (const agentCodeSignIn of [false, true]) {
  test(`new people block keeps Google, email and passkey; agent entry ${agentCodeSignIn ? 'present' : 'hidden'}`, async () => {
    await withLogin({ boatDevModel: true, agentCodeSignIn }, ({ container }) => {
      assert.match(container.textContent, /Sign in to Hypertask/);
      assert.ok(container.querySelector('#login-button'));
      assert.ok(container.querySelector('input[type="email"]'));
      assert.match(container.textContent, /Sign in with a passkey/);
      assert.equal(container.querySelector('[aria-label="Pricing"]'), null);
      const entry = container.querySelector('a[href="/login/agent"]');
      assert.equal(Boolean(entry), agentCodeSignIn);
      if (entry) assert.equal(entry.textContent.trim(), 'Sign in an agent');
    });
  });
}

test('still allowed: flag-on Google starts sign-in and email sends the existing sign-in link', async () => {
  const previous = process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED;
  const previousEmail = process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL;
  process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED = '0';
  process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL = '0';
  try {
    await withLogin({ boatDevModel: true, agentCodeSignIn: true }, async ({ container, calls, dom }) => {
      await React.act(async () => container.querySelector('#login-button').click());
      assert.equal(calls[0].provider, 'google');
      const input = container.querySelector('input[type="email"]');
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'person@example.test');
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      await React.act(async () => container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(container.querySelector('#email').value, 'person@example.test');
      await React.act(async () => container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
      const request = calls.find(call => call.url === '/api/auth/send-email-link');
      assert.ok(request);
      assert.equal(request.method, 'POST');
      assert.equal(JSON.parse(request.body).email, 'person@example.test');
      assert.match(container.textContent, /Check your email/);
    });
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED;
    else process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED = previous;
    if (previousEmail === undefined) delete process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL;
    else process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL = previousEmail;
  }
});

test('flag definition stays an improvement released to Owner + QA for design review', () => {
  const definition = loadModule('src/lib/flags/definitions/htpr-9277-boat-dev-model.ts').default;
  assert.equal(definition.key, layoutKey);
  assert.equal(definition.kind, 'improvement');
  assert.equal(definition.defaultMode, 'OWNER_AND_QA');
  assert.match(definition.releaseRisk.reason, /design review/);
});

for (const user of [null, { userId: 985, source: 'legacy' }, { userId: 985, agentId: 'agent', source: 'legacy' }, { userId: 985, source: 'cli-bearer' }]) {
  for (const layout of [false, true]) for (const agent of [false, true]) {
    test(`agent route user=${JSON.stringify(user)} layout=${layout} agent=${agent}`, async () => {
      const approved = [];
      const mocks = {
        'next/headers': { headers: async () => new Headers() },
        'next/navigation': { notFound: () => { throw Error('notFound'); }, redirect: (url) => { throw Error(url); } },
        '@/lib/auth/currentUser': { loadCurrentUser: async () => user },
        '@/lib/auth/devicePairing': { requireDevicePairingEnabled: async (id) => approved.push(id) },
        '@/lib/flags': { ...flags, isFeatureEnabled: async (key, id) => {
          assert.equal(id, user?.userId ?? 0);
          assert.ok([layoutKey, agentKey].includes(key));
          return key === layoutKey ? layout : agent;
        } },
      };
      const allowed = layout && agent && user && !user.agentId && user.source !== 'cli-bearer';
      const expected = !layout || !agent || (user && !allowed) ? 'notFound' : user ? '/cli-auth?agent=1' : '/login?returnTo=%2Flogin%2Fagent';
      await assert.rejects(loadModule('src/app/login/agent/page.ts', mocks).default, error => error.message === expected);
      assert.deepEqual(approved, allowed ? [985] : []);
    });
  }
}

test('server login evaluates both flags for the real session and keeps guests out of restricted UI', async () => {
  for (const userId of [null, 985]) for (const layout of [false, true]) for (const agent of [false, true]) {
    const mocks = {
      'next/headers': { cookies: async () => ({ get: () => undefined }) },
      '@/lib/auth/session': { SESSION_COOKIE: 'ht_session', verifySession: () => userId === null ? null : { id: userId } },
      '@/lib/telemetry/activationAnalytics': { isActivationEligible: async () => false },
      './SignupPageViewed': { default: () => null },
      '@/components/analytics/StoreUTM': { default: () => null },
      './LoginComponent': { default: 'LoginComponent' },
      '@/lib/flags': { ...flags, isFeatureEnabled: async (key, id) => {
        assert.equal(id, userId ?? 0);
        return id === 985 && (key === layoutKey ? layout : agent);
      } },
    };
    const tree = await loadModule('src/app/login/page.tsx', mocks).default();
    const login = tree.props.children[2];
    assert.equal(login.type, 'LoginComponent');
    assert.deepEqual(login.props, layout && userId === 985 ? { boatDevModel: true, agentCodeSignIn: agent } : {});
  }
});
