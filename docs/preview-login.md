# Preview login (auto-sign-in for Vercel previews)

Every pushed branch gets a Vercel preview at `hypertasks-prod-git-<branch>-hypertaskai.vercel.app`. Opening one for Valentin must land him **already logged in** — never on a login wall. Use the tool; don't do the steps by hand.

## Tool

```bash
preview-login <preview-url> [email]   # ~/.local/bin/preview-login, default valentin.yeo@gmail.com
```

Prints ONE URL that clears Vercel SSO and auto-signs-in. Open it in his real browser:

```bash
zsb navigate "$(preview-login https://hypertasks-prod-git-<branch>-hypertaskai.vercel.app valentin@hypertask.ai)" --new-tab
```

**Open the magic URL in a real browser (zsb → his Edge), not headless curl.** The app sign-in runs client-side (`useEmailAuth`), and the VPS IP is bot-challenged by Vercel ("Security Checkpoint, Code 21") while his residential IP is not.

## The three gates it handles

1. **Vercel SSO (deployment protection).** Previews are SSO-gated. The tool appends `?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`, which sets the HttpOnly `_vercel_jwt` cookie that then rides on the app's `/api/*` fetches. The bypass secret is read live from the Vercel API (`GET /v9/projects/<id>` → `protectionBypass`). Same link works to share a preview with a person off the Vercel team; the secret is embedded, so rotate it afterward if the link leaked.
2. **App login token.** Mints an email-link JWT `{sub: email}`, 15-min, one-time. CRITICAL: prod/preview env sets `JWT_ISSUER = https://app.hypertask.ai` (NOT the local default `hypertask`) and `JWT_AUDIENCE = email-link`; signing with the wrong issuer returns `Invalid or expired token`. Values are decrypted from Vercel env at run time. Opening `<preview>/login?token=<jwt>` triggers `useEmailAuth` → `/api/auth/verify-email-token` → Firebase custom-token sign-in → redirect into the app.
3. **Bot challenge.** Drive the browser flow in real Edge via `zsb` (residential IP). `curl` from the VPS is fine for the API calls but cannot complete the client-side sign-in.

## Config

The Vercel project id and the JWT env-var ids are baked into `~/.local/bin/preview-login`; Vercel token/team come from `~/.config/val-staging/credentials.env`. If the Vercel project changes, update the ids in that script. (Kept in the script, not here, so no ids sit in a doc.)

## Do not publish this

This is internal login/bypass mechanics — never host it on a public URL (`yeoux.net`, `hypertask.app`, the R2 worker, anywhere). It lives in the repo only.
