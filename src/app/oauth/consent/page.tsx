import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { Metadata } from "next";
import prisma from "@/lib/prisma";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { verifyConsentToken } from "@/lib/oauth/consent";
import { cn } from "@/utils/undoActions/helperFuncs";

export const metadata: Metadata = {
  title: "Approve connection - Hypertask",
  robots: "noindex, nofollow",
};

export const dynamic = "force-dynamic";

const PANEL =
  "min-h-[100svh] w-full flex items-center justify-center bg-pageBackground text-white-black p-8";
const PRIMARY_BUTTON =
  "w-full py-3 px-6 mb-3 bg-shadcn-primary text-primary-foreground font-medium rounded-[5px] transition-colors";
const SECONDARY_BUTTON =
  "block w-full py-3 px-6 text-text-light-gray hover:bg-hover-active hover:text-white-black font-medium rounded-[5px] transition-colors";

/** Registered client names are attacker-supplied. Strip anything that could disguise
 * the name (control and bidi characters) and cap the length before showing it. */
function safeClientName(name: string | null | undefined): string {
  if (!name) return "An unnamed app";
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "")
    .trim();
  return cleaned.length === 0 ? "An unnamed app" : cleaned.slice(0, 80);
}

/** Custom schemes like cursor:// have no origin (URL.origin is the string "null"),
 * and those are exactly the desktop clients this screen is most often shown for. */
function redirectOrigin(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return url.origin === "null" ? redirectUri : url.origin;
  } catch {
    return redirectUri;
  }
}

function Fallback({ heading, message }: { heading: string; message: string }) {
  return (
    <div className={cn(PANEL)}>
      <div className="w-full max-w-md flex flex-col items-center text-center">
        <Image
          src="/loginLogoMain.png"
          alt="Hypertask logo"
          className="object-contain mb-3"
          width={48}
          height={48}
        />
        <h1 className="text-heading font-semibold text-white-black mb-2">{heading}</h1>
        <p className="text-text-light-gray text-content mb-6">{message}</p>
        <Link href="/" className={cn(SECONDARY_BUTTON, "max-w-[288px]")}>
          Return to Hypertask
        </Link>
      </div>
    </div>
  );
}

/**
 * HTPR-6200: the approve step for /oauth/authorize. It only renders for a request
 * carrying a consent token this server signed for this session, so nobody can link
 * a user straight into an approve screen for a connector of their choosing.
 */
export default async function OAuthConsentPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const single = (key: string): string => {
    const value = searchParams?.[key];
    return typeof value === "string" ? value : "";
  };

  const clientId = single("client_id");
  const redirectUri = single("redirect_uri");
  const codeChallenge = single("code_challenge");
  const agentId = single("agent_id");
  const consentToken = single("consent_token");

  const cookieStore = await cookies();
  const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value);

  if (
    !session ||
    !verifyConsentToken(consentToken, {
      userId: session.id,
      clientId,
      redirectUri,
      codeChallenge,
      agentId: agentId || null,
    })
  ) {
    return (
      <Fallback
        heading="Connection request expired"
        message="Start the connection again from the app you were using."
      />
    );
  }

  const client = await prisma.oAuthClient.findUnique({
    where: { client_id: clientId },
    select: { client_name: true },
  });

  if (!client) {
    return (
      <Fallback
        heading="Connection request could not be completed"
        message="This app is no longer registered with Hypertask."
      />
    );
  }

  const clientName = safeClientName(client.client_name);

  return (
    <div className={cn(PANEL)}>
      <div className="w-full max-w-md flex flex-col items-center text-center">
        <Image
          src="/loginLogoMain.png"
          alt="Hypertask logo"
          className="object-contain mb-3"
          width={48}
          height={48}
        />

        <h1 className="text-heading font-semibold text-white-black mb-2">
          {clientName} wants to connect to your Hypertask account
        </h1>

        <p className="text-text-light-gray text-content mb-4">
          If you approve, it can read and change everything you can: your boards, tasks, comments
          and files. You can disconnect it later in settings.
        </p>

        <div className="w-full text-left rounded-[5px] border border-border-light-gray-thin p-4 mb-6">
          <p className="text-text-light-gray text-meta mb-1">Access is sent to</p>
          <p className="text-white-black text-content break-all mb-3">{redirectOrigin(redirectUri)}</p>
          <p className="text-text-light-gray text-meta">
            Hypertask has not verified this app. Only approve it if you just asked it to connect.
          </p>
        </div>

        <form method="post" action="/oauth/authorize" className="w-full">
          <input type="hidden" name="response_type" value="code" />
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          <input type="hidden" name="code_challenge_method" value="S256" />
          <input type="hidden" name="state" value={single("state")} />
          <input type="hidden" name="agent_id" value={agentId} />
          <input type="hidden" name="consent_token" value={consentToken} />
          <button type="submit" className={cn(PRIMARY_BUTTON)}>
            Approve and connect
          </button>
        </form>

        <Link href="/" className={cn(SECONDARY_BUTTON)}>
          Cancel
        </Link>
      </div>
    </div>
  );
}
