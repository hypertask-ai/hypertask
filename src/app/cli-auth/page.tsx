'use client';

import { Suspense, useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { useFlag } from '@/hooks/useFlag';
import { useSearchParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import useCurrentUser from '@/hooks/General/useCurrentUserCheckFromCookies';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { cn } from '@/utils/undoActions/helperFuncs';
import logo from '@/assets/hypertaskLogoWhite.png';
import darkMark from '@/assets/HTC_without_text.png';
import useDarkMode from '@/hooks/MultiPages/HTC/useDarkMode';
import {
  POST_CLI_NEXT_REDIRECT_KEY,
  parseSafePostCliRedirect,
  CLI_CALLBACK_WINDOW_NAME,
} from '@/lib/auth/safeReturnTo';
import { Copy } from 'lucide-react';

type CliStep = 'consent' | 'loading' | 'error' | 'declined' | 'connected';

type ConnectedPayload = {
  callbackUrl: string;
  code: string;
  nextPath: string | null;
};

function CliAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'relative min-h-[100svh] w-full overflow-hidden',
        'text-white-black bg-pageBackground flex flex-col items-center justify-center p-4 sm:p-8'
      )}
    >
      <div className="relative w-full flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}

function CliAuthCard({ children, agentSignIn = false }: { children: React.ReactNode; agentSignIn?: boolean }) {
  return (
    <div
      className={cn(
        'w-full max-w-md px-8 py-8 sm:py-10',
        agentSignIn ? 'rounded-[4px]' : 'rounded',
        'border border-border-light-gray-thin bg-pageBackground shadow-lg'
      )}
    >
      {children}
    </div>
  );
}

function CopyableField({
  id,
  label,
  value,
  copyLabel,
  description,
  agentSignIn = false,
}: {
  id: string;
  label: string;
  value: string;
  copyLabel: string;
  description?: string;
  agentSignIn?: boolean;
}) {
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${copyLabel} copied to clipboard.`);
    } catch {
      toast.error('Copy failed. Select the text in the field and copy manually (Ctrl/Cmd+C).');
    }
  };

  return (
    <div className="space-y-1.5 text-left">
      <label className="block text-meta font-semibold text-white-black" htmlFor={id}>
        {label}
      </label>
      {description ? (
        <p className="text-meta text-text-light-gray leading-relaxed" id={`${id}-description`}>
          {description}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2">
        <input
          id={id}
          readOnly
          value={value}
          aria-describedby={description ? `${id}-description` : undefined}
          className={cn(
            'flex-1 min-w-0 border border-border-light-gray-thin',
            agentSignIn ? 'rounded-[4px]' : 'rounded',
            'bg-comment-description px-3 py-2.5 text-meta sm:text-content text-white-black font-mono',
            'focus:outline-none focus:border-border-light-gray-thin',
            'select-all'
          )}
        />
        <button
          type="button"
          onClick={onCopy}
          className={cn(
            "shrink-0 border border-border-light-gray-thin px-3 py-2.5 text-content text-white-black hover:bg-hover-active transition-colors",
            agentSignIn ? "rounded-[4px]" : "rounded"
          )}
        >
          <Copy className="text-white-black" size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

function CliAuthContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentUser = useCurrentUser();
  const agentCodeSignInEnabled = useFlag('htpr-7552-agent-code-signin');
  const [step, setStep] = useState<CliStep>('consent');
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<ConnectedPayload | null>(null);
  const callbackShellRef = useRef<Window | null>(null);

  const port = searchParams?.get('port') || '3456';

  const runAuthorize = useCallback(async () => {
    setError(null);
    setConnected(null);
    setStep('loading');
    try {
      const callbackPort = Number(port);
      if (
        port.length > 5 || /[^0-9]/.test(port) ||
        !Number.isInteger(callbackPort) || callbackPort < 1 || callbackPort > 65535
      ) {
        throw new Error('Invalid CLI callback port');
      }
      const response = await axios.post('/api/cli/generate-code');
      const code = response.data.code as string;
      const callbackUrl = `http://localhost:${callbackPort}/callback?code=${encodeURIComponent(code)}`;

      const rawNext = localStorage.getItem(POST_CLI_NEXT_REDIRECT_KEY);
      const nextPath = parseSafePostCliRedirect(rawNext);
      localStorage.removeItem(POST_CLI_NEXT_REDIRECT_KEY);

      setConnected({ callbackUrl, code, nextPath });
      setStep('connected');

      const shell = callbackShellRef.current;
      callbackShellRef.current = null;

      let delivered = false;
      if (shell && !shell.closed) {
        try {
          shell.location.href = callbackUrl;
          delivered = true;
        } catch {
        }
      }
    } catch (err) {
      const orphan = callbackShellRef.current;
      callbackShellRef.current = null;
      if (orphan && !orphan.closed) {
        try {
          orphan.close();
        } catch {
        }
      }
      console.error('Failed to generate CLI auth code', err);
      toast.error('Failed to connect to CLI. Please try again.');
      setError('Failed to generate authentication code.');
      setStep('error');
    }
  }, [port]);

  const handleAllow = () => {
    if (!currentUser) return;
    void runAuthorize();
  };

  const handleDecline = () => {
    setStep('declined');
  };

  const handleClose = () => {
    router.push('/');
  };

  const handleTryAgain = () => {
    setError(null);
    setStep('consent');
  };

  const handleOpenCallbackInThisTab = () => {
    if (connected) {
      window.location.href = connected.callbackUrl;
    }
  };

  const handleConnectedContinue = () => {
    if (!connected) return;
    if (connected.nextPath) {
      router.push(connected.nextPath);
    } else {
      router.push('/');
    }
  };

  if (agentCodeSignInEnabled && searchParams?.get('agent') === '1') return <AgentSignIn />;

  if (!currentUser) {
    return (
      <CliAuthShell>
        <CliAuthCard>
          <div className="flex flex-col items-center text-center space-y-6">
            <Image
              src={logo}
              alt="Hypertask"
              className="object-contain"
              width={200}
              height={28}
            />
            <h1 className="text-heading font-bold text-white-black">
              Authenticating HyperTask CLI
            </h1>
            <p className="text-text-light-gray">Checking your session…</p>
            <div
              className="h-10 w-10 rounded-full border-2 border-border-light-gray-thin border-t-white-black animate-spin"
              aria-hidden
            />
          </div>
        </CliAuthCard>
      </CliAuthShell>
    );
  }

  return (
    <CliAuthShell>
      <CliAuthCard>
        <div className="flex flex-col items-stretch text-center space-y-6">
          <Image
            src={logo}
            alt="Hypertask"
            className="object-contain self-center"
            width={200}
            height={28}
          />
          <h1 className="text-heading font-bold text-white-black">
            Authenticating HyperTask CLI
          </h1>

          {step === 'declined' && (
            <div className="space-y-4 text-left">
              <p className="text-text-light-gray text-content leading-relaxed">
                You chose not to connect the CLI. You can close this window and
                keep using Hypertask in your browser.
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="w-full px-4 py-2.5 rounded border border-border-light-gray-thin text-white-black font-medium hover:bg-hover-active transition-colors"
              >
                Close
              </button>
            </div>
          )}

          {step === 'error' && error && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-4 text-left">
              <p className="text-red-200 text-content">{error}</p>
              <button
                type="button"
                onClick={handleTryAgain}
                className="mt-4 w-full px-4 py-2.5 rounded bg-shadcn-primary text-primary-foreground font-semibold shadow-lg hover:bg-hover-active transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {step === 'consent' && (
            <div className="space-y-6 text-left">
              <p className="text-text-light-gray text-content leading-relaxed">
                The Hypertask CLI is asking to link to your account and receive
                a short-lived sign-in code. Only continue if you started this
                from a terminal you trust. Click{' '}
                <span className="whitespace-nowrap">Allow and continue</span> to
                generate the sign-in code and callback URL to copy in your
                terminal.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 sm:justify-center">
                <button
                  type="button"
                  onClick={handleAllow}
                  className="px-4 py-2.5 rounded bg-shadcn-primary text-primary-foreground font-semibold shadow-lg hover:bg-hover-active transition-colors"
                >
                  Allow and continue
                </button>
                <button
                  type="button"
                  onClick={handleDecline}
                  className="px-4 py-2.5 rounded border border-border-light-gray-thin text-white-black font-medium hover:bg-hover-active transition-colors"
                >
                  Cancel
                </button>
              </div>
              <p className="text-meta text-text-light-gray text-center">
                Local port: {port}
              </p>
            </div>
          )}

          {step === 'loading' && (
            <div className="space-y-4">
              <p className="text-text-light-gray text-content">
                Generating a sign-in code for your terminal…
              </p>
              <div className="flex justify-center">
                <div
                  className="h-10 w-10 rounded-full border-2 border-border-light-gray-thin border-t-white-black animate-spin"
                  aria-hidden
                />
              </div>
            </div>
          )}

          {step === 'connected' && connected && (
            <div className="space-y-4 text-left">
              <p className="text-text-light-gray text-content leading-relaxed">
                A <strong>one-time authorization code</strong> is ready. The CLI sends it to
                Hypertask and gets back the real API token. If you use SSH, CI, or
                a remote host, copy the callback URL or the code below. It expires in
                about 2 minutes.
              </p>
              <p className="text-meta text-text-light-gray">
                If a window opened to localhost, the CLI on this computer may
                connect automatically. You can still use copy when the browser
                and terminal are on different machines.
              </p>
              <CopyableField
                id="cli-callback-url"
                label="Callback URL"
                value={connected.callbackUrl}
                copyLabel="Callback URL"
                description="Full link for the same machine, or to paste in the CLI if it asks for a URL."
              />
              <CopyableField
                id="cli-auth-code"
                label="One-time authorization code"
                value={connected.code}
                copyLabel="One-time code"
                description="The CLI exchanges it for your authentication token."
              />
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleConnectedContinue}
                  className="w-full px-4 py-2.5 rounded bg-shadcn-primary text-primary-foreground font-semibold shadow-lg hover:bg-hover-active transition-colors"
                >
                  Continue to Hypertask
                </button>
                <button
                  type="button"
                  onClick={handleOpenCallbackInThisTab}
                  className="w-full px-4 py-2.5 rounded border border-border-light-gray-thin text-white-black font-medium hover:bg-hover-active transition-colors"
                >
                  I&apos;m on the same device
                </button>
                <p className="text-meta text-text-light-gray text-center">
                  Use this when your browser and terminal are on the same machine.
                </p>
              </div>
            </div>
          )}
        </div>
      </CliAuthCard>
    </CliAuthShell>
  );
}

export default function CliAuthPage() {
  return (
    <Suspense
      fallback={
        <CliAuthShell>
          <div
            className="h-10 w-10 rounded-full border-2 border-border-light-gray-thin border-t-white-black animate-spin"
            aria-label="Loading"
          />
        </CliAuthShell>
      }
    >
      <CliAuthContent />
    </Suspense>
  );
}

const resultSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(["PENDING", "CLAIMED", "APPROVED", "DELIVERED", "CONNECTED", "DENIED", "EXPIRED"]),
  expiresAt: z.string().datetime(),
  clientName: z.string().nullable(),
  boardUrl: z.string().regex(/^\/projects\/project-\d+$/).optional(),
});
const startSchema = z.object({ id: z.string().uuid(), code: z.string(), expiresAt: z.string().datetime() });
type Flow = z.infer<typeof resultSchema>;
const PRIMARY = "w-full py-3 px-6 mb-3 bg-shadcn-primary text-primary-foreground font-medium rounded-[4px] transition-colors";
const SECONDARY = "block w-full py-3 px-6 text-text-light-gray hover:bg-hover-active hover:text-white-black font-medium rounded-[4px] transition-colors";

async function request(action: string, body: object): Promise<unknown> {
  const response = await fetch(`/api/cli/device/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Could not complete agent sign-in. Try again.");
  return response.json();
}

function usePaintedDark() {
  const [paintedDark, setPaintedDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setPaintedDark(root.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return paintedDark;
}

function AgentSignIn() {
  const { effectiveTheme } = useDarkMode();
  const paintedDark = usePaintedDark();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!flow || ["CONNECTED", "DENIED", "EXPIRED"].includes(flow.state)) return;
    const id = flow.id;
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (document.visibilityState === "visible") {
          const next = resultSchema.parse(await request("status", { id }));
          if (!disposed) setFlow(next);
        }
      } catch {
        if (!disposed) setError("Connection check failed. Try again.");
      } finally {
        if (!disposed) timeout = setTimeout(poll, 5000);
      }
    };
    timeout = setTimeout(poll, 5000);
    return () => { disposed = true; clearTimeout(timeout); };
  }, [flow?.id, flow?.state]);

  useEffect(() => {
    if (!flow) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(flow.expiresAt) - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [flow?.expiresAt]);

  async function start() {
    setBusy(true); setError(null);
    try {
      const next = startSchema.parse(await request("start", {}));
      setCode(next.code);
      setRemaining(300);
      setFlow({ id: next.id, expiresAt: next.expiresAt, state: "PENDING", clientName: null });
    } catch {
      setError("Could not start agent sign-in. Try again.");
    } finally { setBusy(false); }
  }

  async function decide(action: "approve" | "deny") {
    if (!flow) return;
    setBusy(true); setError(null);
    try {
      await request(action, { id: flow.id });
      setFlow(resultSchema.parse(await request("status", { id: flow.id })));
    } catch {
      setError("Could not complete agent sign-in. Try again.");
    } finally { setBusy(false); }
  }

  const expired = flow !== null && ["PENDING", "CLAIMED", "APPROVED", "EXPIRED"].includes(flow.state) && remaining === 0;
  return (
    <CliAuthShell>
      <CliAuthCard agentSignIn>
        <div className="flex flex-col items-center text-center">
          <Image src={paintedDark || effectiveTheme === 'dark' ? '/loginLogoMain.png' : darkMark} alt="Hypertask logo" width={47} height={59} className="object-contain mb-3" />
          <h1 className="text-heading font-semibold mb-2">Sign in an agent</h1>
          <p className="text-content text-text-light-gray mb-6">Create a free board for your agent.</p>
          {error && <p role="alert" className="text-content text-text-light-gray mb-4">{error}</p>}
          {!flow || expired || flow.state === "DENIED" ? (
            <>
              {flow && <p className="text-content text-text-light-gray mb-4">{expired ? "This code expired." : "Connection declined."}</p>}
              <button type="button" className={PRIMARY} disabled={busy} onClick={start}>{busy ? "Starting…" : "Get a five-minute code"}</button>
            </>
          ) : flow.state === "CONNECTED" ? (
            <>
              <p role="status" className="text-content mb-4">Your agent is connected.</p>
              {flow.boardUrl && <Link href={flow.boardUrl} className={PRIMARY}>Open your agent’s board</Link>}
            </>
          ) : (
            <>
              {code && <div className="w-full mb-4"><CopyableField agentSignIn id="agent-login-command" label="Run this with your agent" value={`hypertask login --code ${code}`} copyLabel="Sign-in command" /></div>}
              <div className="w-full mb-4"><CopyableField agentSignIn id="agent-mcp-server" label="Or add this MCP server, then approve its new board" value="https://mcp.hypertask.ai/mcp" copyLabel="MCP server" /></div>
              <p className="text-meta text-text-light-gray mb-4" role="status">Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</p>
              {flow.state === "CLAIMED" ? (
                <>
                  <p className="text-content mb-4">{flow.clientName} is asking to connect.</p>
                  <p className="text-content text-text-light-gray mb-4">Approve only the agent you just started. It can read and change its new board only.</p>
                  <button type="button" className={PRIMARY} disabled={busy} onClick={() => decide("approve")}>{busy ? "Connecting…" : "Approve and connect"}</button>
                  <button type="button" className={SECONDARY} disabled={busy} onClick={() => decide("deny")}>Decline</button>
                </>
              ) : <p className="text-content text-text-light-gray mb-4">{flow.state === "PENDING" ? "Waiting for your agent…" : flow.state === "DELIVERED" && remaining === 0 ? "Credential issued. Run hypertask project list to finish connecting." : "Waiting for your agent to finish…"}</p>}
            </>
          )}
          <Link href="/" className={SECONDARY}>Return to Hypertask</Link>
        </div>
      </CliAuthCard>
    </CliAuthShell>
  );
}
