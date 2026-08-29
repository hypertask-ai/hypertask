'use client';

import { Suspense, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import useCurrentUser from '@/hooks/General/useCurrentUserCheckFromCookies';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { cn } from '@/utils/undoActions/helperFuncs';
import logo from '@/assets/hypertaskLogoWhite.png';
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
        'text-white bg-black flex flex-col items-center justify-center p-4 sm:p-8'
      )}
    >
      <div className="relative w-full flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}

function CliAuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'w-full max-w-md rounded-xl px-8 py-8 sm:py-10',
        'border border-[#262626] bg-black shadow-lg'
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
}: {
  id: string;
  label: string;
  value: string;
  copyLabel: string;
  description?: string;
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
      <label className="block text-meta font-semibold text-white" htmlFor={id}>
        {label}
      </label>
      {description ? (
        <p className="text-meta text-[#8a8a8a] leading-relaxed" id={`${id}-description`}>
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
            'flex-1 min-w-0 rounded-md border border-[#262626]',
            'bg-[#0a0a0a] px-3 py-2.5 text-meta sm:text-content text-white font-mono',
            'focus:outline-none focus:border-[#666666]',
            'select-all'
          )}
        />
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 rounded-md border border-[#262626] px-3 py-2.5 text-content text-white hover:bg-white/10 transition-colors"
        >
          <Copy className="text-white" size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

function CliAuthContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentUser = useCurrentUser();
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
      const response = await axios.post('/api/cli/generate-code');
      const code = response.data.code as string;
      const callbackUrl = `http://localhost:${port}/callback?code=${code}`;

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
          /* cross-origin or blocked */
        }
      }
      // if (!delivered) {
      //   const w = window.open(callbackUrl, CLI_CALLBACK_WINDOW_NAME);
      //   if (!w) {
      //     // Pop-up blocked or unavailable — user copies from the page below; no full-page nav.
      //   }
      // }
    } catch (err) {
      const orphan = callbackShellRef.current;
      callbackShellRef.current = null;
      if (orphan && !orphan.closed) {
        try {
          orphan.close();
        } catch {
          /* ignore */
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
    // callbackShellRef.current = window.open(
    //   'about:blank',
    //   CLI_CALLBACK_WINDOW_NAME
    // );
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
            <h1 className="text-heading font-bold text-white">
              Authenticating HyperTask CLI
            </h1>
            <p className="text-[#a3a3a3]">Checking your session…</p>
            <div
              className="h-10 w-10 rounded-full border-2 border-white/25 border-t-white animate-spin"
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
          <h1 className="text-heading font-bold text-white">
            Authenticating HyperTask CLI
          </h1>

          {step === 'declined' && (
            <div className="space-y-4 text-left">
              <p className="text-[#a3a3a3] text-content leading-relaxed">
                You chose not to connect the CLI. You can close this window and
                keep using Hypertask in your browser.
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="w-full px-4 py-2.5 rounded-md border border-[#262626] text-white font-medium hover:bg-white/10 transition-colors"
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
                className="mt-4 w-full px-4 py-2.5 rounded-md bg-white text-black font-semibold shadow-lg hover:bg-gray-50 transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {step === 'consent' && (
            <div className="space-y-6 text-left">
              <p className="text-[#a3a3a3] text-content leading-relaxed">
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
                  className="px-4 py-2.5 rounded-md bg-white text-black font-semibold shadow-lg hover:bg-gray-50 transition-colors"
                >
                  Allow and continue
                </button>
                <button
                  type="button"
                  onClick={handleDecline}
                  className="px-4 py-2.5 rounded-md border border-[#262626] text-white font-medium hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
              </div>
              <p className="text-meta text-[#8a8a8a] text-center">
                Local port: {port}
              </p>
            </div>
          )}

          {step === 'loading' && (
            <div className="space-y-4">
              <p className="text-[#a3a3a3] text-content">
                Generating a sign-in code for your terminal…
              </p>
              <div className="flex justify-center">
                <div
                  className="h-10 w-10 rounded-full border-2 border-white/25 border-t-white animate-spin"
                  aria-hidden
                />
              </div>
            </div>
          )}

          {step === 'connected' && connected && (
            <div className="space-y-4 text-left">
              <p className="text-[#a3a3a3] text-content leading-relaxed">
                A <strong>one-time authorization code</strong> is ready. The CLI sends it to
                Hypertask and gets back the real API token. If you use SSH, CI, or
                a remote host, copy the callback URL or the code below. It expires in
                about 2 minutes.
              </p>
              <p className="text-meta text-[#8a8a8a]">
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
                  className="w-full px-4 py-2.5 rounded-md bg-white text-black font-semibold shadow-lg hover:bg-gray-50 transition-colors"
                >
                  Continue to Hypertask
                </button>
                <button
                  type="button"
                  onClick={handleOpenCallbackInThisTab}
                  className="w-full px-4 py-2.5 rounded-md border border-[#262626] text-white font-medium hover:bg-white/10 transition-colors"
                >
                  I&apos;m on the same device
                </button>
                <p className="text-meta text-[#8a8a8a] text-center">
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
            className="h-10 w-10 rounded-full border-2 border-white/25 border-t-white animate-spin"
            aria-label="Loading"
          />
        </CliAuthShell>
      }
    >
      <CliAuthContent />
    </Suspense>
  );
}
