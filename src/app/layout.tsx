import "@/styles/globals.scss";
import "../../tokens.css";
import { cookies } from "next/headers";
import Provider from "@/utils/Providers";
import PostHogAnalytics from "@/components/Analytics/PostHogAnalytics";
import { SpeedInsights } from "@vercel/speed-insights/next";
import ClientErrorReporter from "@/components/ErrorBoundary/ClientErrorReporter";
import DeploySkewGuard from "@/components/System/DeploySkewGuard";
import FilesImageFallback from "@/components/FilesImageFallback";
import { isMobileDevice } from "@/utils/serverActions";
import authConfig from "@/lib/configs/auth.config";
import { DIV_ID_CONSTANTS } from "@/lib/configs/general.config";
import { inter, INTER_LATIN_FONT_HREF } from "@/lib/fonts/inter";
import { newsreader, NEWSREADER_LATIN_FONT_HREFS } from "@/lib/fonts/newsreader";
import { HTPR_7016_PHONE_BOARD_COLD_START_FLAG, HTPR_7278_MEMORY_ONLY_TRACKING_FLAG } from "@/lib/flags/keys";
import { isFeatureEnabled } from "@/lib/flags";
import { ibmPlexSans, IBM_PLEX_SANS_LATIN_FONT_HREF } from "@/lib/fonts/ibmPlexSans";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  normalizeThemePreference,
  resolveInitialThemeColor,
  resolveThemePreference,
} from "@/lib/themePreferences";
import { buildThemeBootScript } from "@/lib/themeBootScript";
import { buildEarlyAppShellBootstrapScript } from "@/lib/appShellBootstrap/client";
import { getServerBoardDocument } from "@/lib/firstScreen/serverBoardDocument";
import { getServerInboxDocument } from "@/lib/firstScreen/serverInboxDocument";
import type { BoardDisplay } from "@/lib/firstScreen/boardDisplay";

export async function generateViewport() {
  const device = await isMobileDevice();

  return {
    width: "device-width",
    initialScale: 1,
    maximumScale: device.isMobile ? 1 : 1.2,
    userScalable: device.isMobile ? false : true,
    minimumScale: device.isMobile ? 1 : 0.5,
    viewportFit: "cover",
    height: "device-height",
    interactiveWidget: "resizes-content",
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
  const [device, boardDocument, inboxDocument] = await Promise.all([isMobileDevice(), getServerBoardDocument(), getServerInboxDocument()]);
  const firstScreen = boardDocument ?? inboxDocument;
  const deferUnusedBoardFonts = boardDocument?.flags.values[HTPR_7016_PHONE_BOARD_COLD_START_FLAG] === true &&
    (boardDocument.display as BoardDisplay).isMobile &&
    ["amoled", "graphite", "porcelain"].includes(boardDocument.display.theme);
  const analyticsSession = verifySession(
    cookieStore.get(SESSION_COOKIE)?.value,
  );
  const analyticsIsGuest =
    analyticsSession?.email?.endsWith("@demo.hypertask.ai") ?? false;
  const memoryOnlyTracking = await isFeatureEnabled(HTPR_7278_MEMORY_ONLY_TRACKING_FLAG, analyticsSession?.id ?? -1);

  const theme = cookieStore.get(authConfig.cookies.theme) ?? {
    value: authConfig.cookies.defaultTheme,
    name: authConfig.cookies.theme,
  };
  const themeValue = normalizeThemePreference(theme.value) ?? "system";
  const systemLightTheme = resolveThemePreference("system", "light");
  const systemDarkTheme = resolveThemePreference("system", "dark");
  const initialThemeColor = resolveInitialThemeColor(themeValue);
  const themeClassName =
    themeValue === "amoled"
      ? "dark amoled"
      : themeValue === "dia"
        ? "light dia"
        : themeValue === "graphite"
          ? "dark graphite"
          : themeValue === "porcelain"
            ? "light porcelain"
            : themeValue;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${themeClassName} ${inter.variable} ${newsreader.variable} ${ibmPlexSans.variable} ${inter.className}`}
      data-theme={themeValue}
    >
      <head>
        {!deferUnusedBoardFonts && [INTER_LATIN_FONT_HREF, ...NEWSREADER_LATIN_FONT_HREFS].map(href => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
        <script
          id="ht-cached-task-history"
          dangerouslySetInnerHTML={{
            __html: "window.addEventListener('popstate',function(event){window.dispatchEvent(new CustomEvent('cached-task-detail-popstate',{detail:event}));},true);",
          }}
        />
        {firstScreen && ["amoled", "graphite", "porcelain"].includes(firstScreen.display.theme) && (
          <link rel="preload" href={IBM_PLEX_SANS_LATIN_FONT_HREF} as="font" type="font/woff2" crossOrigin="anonymous" />
        )}
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
            ),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var s=JSON.parse(localStorage.getItem('recoil-persist')||'{}');var el=document.documentElement;if(s.appShellRail===false){el.style.setProperty('--app-shell-rail-w','0px');el.setAttribute('data-rail','off');}else if(s.appShellRailExpanded===true){el.style.setProperty('--app-shell-rail-w','130px');}}catch(e){}})();",
          }}
        />
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
        <PostHogAnalytics
          authenticatedUserId={analyticsSession?.id ?? null}
          authenticatedIsGuest={analyticsIsGuest}
          trackingPersistence={memoryOnlyTracking ? "memory" : "localStorage+cookie"}
        />
        <DeploySkewGuard />
        <SpeedInsights />
        <Provider
          initialIsMobile={firstScreen ? (firstScreen.display as BoardDisplay).isMobile : device.isMobile}
          initialIsApple={device.isApple}
          authenticatedUserId={analyticsSession?.id ?? null}
          firstScreen={firstScreen}
        >
          {children}
        </Provider>
      </body>
    </html>
  );
}
