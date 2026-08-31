import "@/styles/globals.scss";
import "../../tokens.css";
import { cookies } from "next/headers";
import Provider from "@/utils/Providers";
import PostHogAnalytics from "@/components/Analytics/PostHogAnalytics";
import ClientErrorReporter from "@/components/ErrorBoundary/ClientErrorReporter";
import DeploySkewGuard from "@/components/System/DeploySkewGuard";
import { isMobileDevice } from "@/utils/serverActions";
import authConfig from "@/lib/configs/auth.config";
import { DIV_ID_CONSTANTS } from "@/lib/configs/general.config";
import { inter } from "@/lib/fonts/inter";
import { newsreader } from "@/lib/fonts/newsreader";
import { ibmPlexSans } from "@/lib/fonts/ibmPlexSans";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  normalizeThemePreference,
  resolveInitialThemeColor,
  resolveThemePreference,
} from "@/lib/themePreferences";
import { buildThemeBootScript } from "@/lib/themeBootScript";

export async function generateViewport() {
  const device = await isMobileDevice(); // execute the function

  return {
    width: "device-width",
    initialScale: 1,
    maximumScale: device.isMobile ? 1 : 1.2,
    userScalable: device.isMobile ? false : true,
    minimumScale: device.isMobile ? 1 : 0.5,
    viewportFit: "cover",
    height: "device-height",
    // Lift page content above the on-screen keyboard instead of letting it overlay
    // (fixes the comment field hiding behind the keyboard on mobile web + the app shell).
    interactiveWidget: "resizes-content",
  };
}

export default async function RootLayout(
  {
    // Layouts must accept a children prop.
    // This will be populated with nested layouts or pages
    children,
  }: {
    children: React.ReactNode;
  }
) {
  const cookieStore = await cookies();
  // Seed device contexts from the request so mobile hydration starts in the
  // correct state. The old client-side correction rerendered the complete app
  // provider subtree immediately after hydration and made a server-action
  // round trip solely to identify Apple devices.
  const device = await isMobileDevice();
  // Performance identity comes from the HTTP-only, HMAC-signed session. The
  // client-writable nookies_user cookie is a claim, not authentication.
  const analyticsSession = verifySession(
    cookieStore.get(SESSION_COOKIE)?.value,
  );
  const analyticsIsGuest =
    analyticsSession?.email?.endsWith("@demo.hypertask.ai") ?? false;

  const theme = cookieStore.get(authConfig.cookies.theme) ?? {
    value: authConfig.cookies.defaultTheme,
    name: authConfig.cookies.theme,
  };
  // Legacy "dark"/"light" cookies map onto the standard graphite/porcelain pair.
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
      // The theme boot script below rewrites <html> class + data-theme to the
      // resolved theme (e.g. "system" -> "amoled") before React hydrates, so the
      // server markup intentionally differs from the client. Suppress the
      // hydration warning for this element's own attributes only.
      suppressHydrationWarning
      className={`${themeClassName} ${inter.variable} ${newsreader.variable} ${ibmPlexSans.variable} ${inter.className}`}
      data-theme={themeValue}
    >
      <head>
        <meta
          name="theme-color"
          content={initialThemeColor}
          suppressHydrationWarning
        />
        {/*
          Theme boot: the server applies explicit light/dark from the cookie,
          but cannot resolve "system" (prefers-color-scheme is client-only), so
          system users flashed light-then-dark before ThemeListener's effect ran.
          This blocking script resolves it before first paint. Mirrors ThemeListener.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: buildThemeBootScript(
              authConfig.cookies.theme,
              systemLightTheme,
              systemDarkTheme,
            ),
          }}
        />
        {/*
          Rail-width boot: --app-shell-rail-w only exists once AppShellRail's
          effect sets it, so a cold load paints every rail-padded container at
          the CSS fallback (48px, collapsed) first. Users with the rail
          expanded (130px) or turned off saw that mount animate into place
          (HTPR-5725). For rail-off, it also seeds data-rail="off" so CSS hides
          the default-true SSR rail before hydration removes it (HTPR-5749).
          This reads the same localStorage the appShellRail(Expanded) atoms
          persist to and sets the var before first paint; AppShellRail's own
          effect then confirms the width and clears data-rail if the rail
          actually renders, or leaves the width unread where the rail isn't
          rendered (mobile, rail off). Rail-off is checked first: the two
          persisted flags are independent, so a user who expanded the rail
          and then turned it off entirely must not get 130px.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var s=JSON.parse(localStorage.getItem('recoil-persist')||'{}');var el=document.documentElement;if(s.appShellRail===false){el.style.setProperty('--app-shell-rail-w','0px');el.setAttribute('data-rail','off');}else if(s.appShellRailExpanded===true){el.style.setProperty('--app-shell-rail-w','130px');}}catch(e){}})();",
          }}
        />
        {/* <meta name="viewport" content="width=device-width,height=device-height,initial-scale=1,maximum-scale=1,user-scalable=no,shrink-to-fit=no,viewport-fit=cover"/> */}
        <meta
          name="description"
          content="Hypertask - AI-powered Project Boards"
        />
      </head>
      <body style={{fontFamily:"inherit !important"}} id={DIV_ID_CONSTANTS.bodyLayout}>
        <div id="portal-root"></div>
        <ClientErrorReporter />
        <PostHogAnalytics
          authenticatedUserId={analyticsSession?.id ?? null}
          authenticatedIsGuest={analyticsIsGuest}
        />
        <DeploySkewGuard />
        <Provider
          initialIsMobile={device.isMobile}
          initialIsApple={device.isApple}
          authenticatedUserId={analyticsSession?.id ?? null}
        >
          {children}
        </Provider>
      </body>
    </html>
  );
}
