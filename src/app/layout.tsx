import { HTPR_8145_PHONE_ZOOM_FLAG } from "@/lib/flags/definitions/htpr-8145-phone-zoom";
import { HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG } from "@/lib/flags/definitions/htpr-7650-ai-chat-open-switches";
import { HTPR_8088_MANUAL_CHAT_FLAG } from "@/lib/flags/definitions/htpr-8088-manual-chat";
import "@/styles/globals.scss";
import "@/styles/tailwindThemes/rounded.css";
import "../../tokens.css";
import { cookies, headers } from "next/headers";
import Provider from "@/utils/Providers";
import { FeatureFlagProvider, SubscribedFeatureFlagProvider } from "@/hooks/useFlag";
import PostHogAnalytics from "@/components/Analytics/PostHogAnalytics";
import { SpeedInsights } from "@vercel/speed-insights/next";
import ClientErrorReporter from "@/components/ErrorBoundary/ClientErrorReporter";
import { AiChipEventRecorder } from "@/lib/ai/AiChipEventRecorder";
import DeploySkewGuard from "@/components/System/DeploySkewGuard";
import FilesImageFallback from "@/components/FilesImageFallback";
import { isMobileDevice } from "@/utils/serverActions";
import authConfig from "@/lib/configs/auth.config";
import { DIV_ID_CONSTANTS } from "@/lib/configs/general.config";
import { inter } from "@/lib/fonts/inter";
import { newsreader } from "@/lib/fonts/newsreader";
import { HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG, HTPR_7278_MEMORY_ONLY_TRACKING_FLAG, HTPR_7978_AI_CHIP_EVENTS_FLAG } from "@/lib/flags/keys";
import { isFeatureEnabled } from "@/lib/flags";
import { ibmPlexSans } from "@/lib/fonts/ibmPlexSans";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  normalizeThemePreference,
  resolvedThemeDomMetadata,
  resolveInitialThemeColor,
  resolveThemePreference,
} from "@/lib/themePreferences";
import { HTPR_7328_ROUNDED_THEME_FLAG, HTPR_7560_FLAG_READER_SUBSCRIBE_FLAG, HTPR_7627_TICKET_FIRST_SCREEN_FLAG } from "@/lib/flags/keys";
import { buildThemeBootScript } from "@/lib/themeBootScript";
import { buildEarlyAppShellBootstrapScript } from "@/lib/appShellBootstrap/client";
import { getServerBoardDocument } from "@/lib/firstScreen/serverBoardDocument";
import { getServerInboxDocument } from "@/lib/firstScreen/serverInboxDocument";
import { getServerTicketShell } from "@/lib/firstScreen/serverTicketShell";
import { getFirstVisitFlagSeed } from "@/lib/firstScreen/serverFlags";
import type { FirstScreenFlags } from "@/lib/firstScreen/contract";
import { HTPR_7718_FIRST_VISIT_FLAG_SEED_FLAG } from "@/lib/flags/definitions/htpr-7718-first-visit-flag-seed";
import type { BoardDisplay } from "@/lib/firstScreen/boardDisplay";
import { buildTicketSidebarBootScript, TICKET_SIDEBAR_BOOT_CSS } from "@/lib/ticketSidebarBoot";
import { HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG, HTPR_7615_SIDEBAR_FIRST_PAINT_FLAG } from "@/lib/flags/keys";

export async function generateViewport() {
  const device = await isMobileDevice();
  const session = verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const phoneZoom = device.isMobile && await isFeatureEnabled(HTPR_8145_PHONE_ZOOM_FLAG, session?.id ?? -1);

  return {
    width: "device-width",
    initialScale: 1,
    maximumScale: device.isMobile ? 1 : 1.2,
    userScalable: device.isMobile ? false : true,
    minimumScale: device.isMobile ? 1 : 0.5,
    viewportFit: "cover",
    height: "device-height",
    interactiveWidget: "resizes-content",
    ...(phoneZoom && { maximumScale: 5, userScalable: true }),
  };
}

export default async function RootLayout(
  {
    children,
  }: {
    children: React.ReactNode;
  }
) {
  const cookieStore = await cookies();
  const analyticsSession = verifySession(
    cookieStore.get(SESSION_COOKIE)?.value,
  );
  const firstScreenPromise = Promise.all([isMobileDevice(), getServerBoardDocument(), getServerInboxDocument(), getServerTicketShell()]);
  let identifyEventIds = false;
  if (analyticsSession) {
    try {
      const [enabled] = await Promise.all([
        isFeatureEnabled(HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG, analyticsSession.id),
        firstScreenPromise,
      ]);
      if (enabled) identifyEventIds = true;
    } catch {}
  }
  const [device, boardDocument, inboxDocument] = await firstScreenPromise;
  const phoneZoom = device.isMobile && await isFeatureEnabled(HTPR_8145_PHONE_ZOOM_FLAG, analyticsSession?.id ?? -1);
  const ticketShellEnabled = await isFeatureEnabled(HTPR_7627_TICKET_FIRST_SCREEN_FLAG, analyticsSession?.id ?? -1);
  const shellSeed = ticketShellEnabled ? await getServerTicketShell() : null;
  const firstScreen = boardDocument ?? inboxDocument;
  let flagSeed: FirstScreenFlags | null = null;
  if (analyticsSession && !firstScreen && !shellSeed) {
    try {
      const requestHeaders = await headers();
      if (requestHeaders.get("rsc") !== "1" && await isFeatureEnabled(HTPR_7718_FIRST_VISIT_FLAG_SEED_FLAG, analyticsSession.id)) {
        flagSeed = await getFirstVisitFlagSeed(analyticsSession.id);
      }
    } catch {}
  }
  const analyticsIsGuest =
    analyticsSession?.email?.endsWith("@demo.hypertask.ai") ?? false;
  const chipEventsFlag = await isFeatureEnabled(HTPR_7978_AI_CHIP_EVENTS_FLAG, analyticsSession?.id ?? -1);
  const memoryOnlyTracking = await isFeatureEnabled(HTPR_7278_MEMORY_ONLY_TRACKING_FLAG, analyticsSession?.id ?? -1);

  const sidebarFirstPaint = analyticsSession ? await isFeatureEnabled(HTPR_7615_SIDEBAR_FIRST_PAINT_FLAG, analyticsSession.id) : false;
  const sidebarFlags = analyticsSession && sidebarFirstPaint ? await Promise.all([
    isFeatureEnabled(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG, analyticsSession.id),
    isFeatureEnabled(HTPR_8088_MANUAL_CHAT_FLAG, analyticsSession.id),
  ]) : null;
  const [keepAiChatClosed = false, manualChat = false] = sidebarFlags ?? [];
  let autoOpenSwitchesUserId: number | null = null;
  if (analyticsSession && sidebarFlags && await isFeatureEnabled(HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG, analyticsSession.id)) {
    autoOpenSwitchesUserId = analyticsSession.id;
  }

  const theme = cookieStore.get(authConfig.cookies.theme) ?? {
    value: authConfig.cookies.defaultTheme,
    name: authConfig.cookies.theme,
  };
  const roundedEnabled = await isFeatureEnabled(HTPR_7328_ROUNDED_THEME_FLAG, analyticsSession?.id ?? -1);
  const flagReaderSubscribe = await isFeatureEnabled(HTPR_7560_FLAG_READER_SUBSCRIBE_FLAG, analyticsSession?.id ?? -1);
  const savedTheme = roundedEnabled
    ? normalizeThemePreference(theme.value, true)
    : normalizeThemePreference(theme.value);
  const themeValue = savedTheme ?? "system";
  const systemLightTheme = resolveThemePreference("system", "light");
  const systemDarkTheme = resolveThemePreference("system", "dark");
  const initialThemeColor = resolveInitialThemeColor(themeValue);
  const initialResolvedTheme = resolveThemePreference(themeValue, "dark");
  const themeClassName = themeValue === "system"
    ? "system"
    : resolvedThemeDomMetadata[initialResolvedTheme].classes.join(" ");

  return (
    <html
      lang="en"
      data-phone-zoom={phoneZoom ? "true" : undefined}
      suppressHydrationWarning
      className={`${themeClassName} ${inter.variable} ${newsreader.variable} ${ibmPlexSans.variable} ${inter.className}`}
      data-theme={themeValue === "rounded" ? initialResolvedTheme : themeValue}
    >
      <head>
        <script
          id="ht-cached-task-history"
          dangerouslySetInnerHTML={{
            __html: "window.addEventListener('popstate',function(event){window.dispatchEvent(new CustomEvent('cached-task-detail-popstate',{detail:event}));},true);",
          }}
        />
        <meta
          name="theme-color"
          content={initialThemeColor}
          suppressHydrationWarning
        />
        <script
          dangerouslySetInnerHTML={{
            __html: buildThemeBootScript(
              authConfig.cookies.theme,
              systemLightTheme,
              systemDarkTheme,
              roundedEnabled,
            ),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var s=JSON.parse(localStorage.getItem('recoil-persist')||'{}');var el=document.documentElement;if(s.appShellRail===false){el.style.setProperty('--app-shell-rail-w','0px');el.setAttribute('data-rail','off');}else if(s.appShellRailExpanded===true){el.style.setProperty('--app-shell-rail-w','130px');}}catch(e){}})();",
          }}
        />
        {sidebarFlags && (
          <>
            <style dangerouslySetInnerHTML={{ __html: TICKET_SIDEBAR_BOOT_CSS }} />
            <script
              dangerouslySetInnerHTML={{
                __html: buildTicketSidebarBootScript({
                  keepClosed: keepAiChatClosed,
                  overlayTicket: true,
                  autoOpenSwitches: autoOpenSwitchesUserId !== null,
                  manualChat,
                  userId: autoOpenSwitchesUserId,
                }),
              }}
            />
          </>
        )}
        <meta
          name="description"
          content="Hypertask - AI-powered Project Boards"
        />
      </head>
      <body style={{fontFamily:"inherit !important"}} id={DIV_ID_CONSTANTS.bodyLayout}>
        <div id="portal-root"></div>
        {analyticsSession ? (
          <script
            id="ht-early-app-shell-bootstrap"
            dangerouslySetInnerHTML={{
              __html: buildEarlyAppShellBootstrapScript({
                accountId: analyticsSession.id,
                betterAuthEnabled: process.env.BETTER_AUTH_ENABLED === "1",
              }),
            }}
          />
        ) : null}
        <FilesImageFallback />
        <ClientErrorReporter />
        {chipEventsFlag && analyticsSession && !analyticsIsGuest ? <AiChipEventRecorder /> : null}
        <PostHogAnalytics
          authenticatedUserId={analyticsSession?.id ?? null}
          authenticatedIsGuest={analyticsIsGuest}
          identifyEventIds={identifyEventIds}
          trackingPersistence={memoryOnlyTracking ? "memory" : "localStorage+cookie"}
        />
        <DeploySkewGuard />
        <SpeedInsights />
        <Provider
          initialIsMobile={firstScreen ? (firstScreen.display as BoardDisplay).isMobile : device.isMobile}
          initialIsApple={device.isApple}
          authenticatedUserId={analyticsSession?.id ?? null}
          firstScreen={firstScreen}
          shellSeed={shellSeed}
          flagSeed={flagSeed}
          flagProvider={flagReaderSubscribe ? SubscribedFeatureFlagProvider : FeatureFlagProvider}
        >
          {children}
        </Provider>
      </body>
    </html>
  );
}
