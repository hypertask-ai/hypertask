/** @type {import('next').NextConfig} */

const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

// Stable id for THIS build, inlined into the client bundle + served from
// /api/version so an open tab can tell when a newer deploy is live and quietly
// reload itself (deploy-skew guard, HTPR-4574). Prefer Vercel's git SHA; fall
// back to the checked-out HEAD for VPS/prebuilt builds; "dev" disables the
// check when neither is available.
function resolveBuildId() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  try {
    return require("child_process")
      .execSync("git rev-parse --short HEAD")
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: resolveBuildId(),
  },
  distDir: process.env.BUILD_DIR || ".next",
  productionBrowserSourceMaps: true,
  reactStrictMode: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "img.freepik.com",
      },
      {
        protocol: "https",
        hostname: "framerusercontent.com",
      },
      {
        protocol: "https",
        hostname: "cdn.jsdelivr.net",
      },

      {
        protocol: "https",
        hostname: "files.hypertask.app",
      },
      {
        // Uploads moved to files.hypertask.app, but rows written before that
        // still carry the legacy bucket URL. next/image throws on an
        // unconfigured host, and that throw takes the whole page into the error
        // boundary, so a single old avatar blanked the calendar (HTPR-4760).
        protocol: "https",
        hostname: "hypertasks.s3.us-east-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "ui-avatars.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "media.licdn.com",
      },
      {
        protocol: "https",
        hostname: "images.pexels.com",
      },
    ],
  },
  experimental: {
    // webpackBuildWorker: true,
    // Tree-shake heavy barrel-export libs so only the icons/helpers actually
    // imported get bundled, not the whole package (HTPR-3815).
    optimizePackageImports: ["react-icons", "@heroicons/react", "date-fns"],
    serverActions: {
      allowedOrigins: [
        "https://app.hypertasks.ai",
        "https://app.hypertask.ai",
        "localhost:3000",
        "app.hypertasks.ai",
        "app.hypertask.ai",
        "https://hypertask.ai",
      ],
    },
  },
  async redirects() {
    return [
      {
        // /timers is a pure alias for the running-timers view. It used to be a
        // page that threw redirect() during render. Next cannot answer with a
        // 307 once the response has started streaming, so it shipped the
        // redirect inside the flight payload instead: the browser got 200, and
        // the /timers segment rendered in React before being swapped for /time.
        // A subtree throwing during render while the router transitions its
        // state to a new promise is one of the trigger conditions for
        // facebook/react#33580, which throws React #310 ("Rendered more hooks
        // than during the previous render") out of the App Router itself
        // (HTPR-4753; same React bug as HTPR-4071). Redirecting here keeps the
        // /timers URL working without ever rendering it. Auth is unchanged:
        // /time does its own requireServerCookieUser().
        source: "/timers",
        destination: "/time?running=1",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "/api/mcp/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        // CORS for general API routes
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET,DELETE,PATCH,POST,PUT,OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value:
              "Authorization, Idempotency-Key, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
          },
        ],
      },
      {
        // WordPress signup route - completely exclude from global CORS
        source: "/api/auth/wordpress-signup",
        headers: [{ key: "X-Custom-CORS", value: "handled-by-middleware" }],
      },
    ];
  },
  webpack(config, { dev, isServer, nextRuntime }) {
    if (!dev && !isServer) {
      config.devtool = "hidden-nosources-source-map";
    }

    if (nextRuntime === "edge") {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        ioredis: require.resolve("./src/lib/ioredis-edge-shim.ts"),
      };
    }

    // react-joyride's ESM build references ReactDOM.unmountComponentAtNode /
    // unstable_renderSubtreeIntoContainer in a dead `!isReact16` branch that
    // React 19 no longer exports, which trips webpack's strict ESM named-export
    // check. Force its CJS build, where the same dead code is a plain
    // require() call webpack doesn't statically validate.
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "react-joyride$": require.resolve("react-joyride"),
    };

    return config;
  },
};

// PWA / service-worker caching is intentionally DISABLED. It previously
// precached the app shell + JS bundles, which pinned devices to stale bundles
// so new deploys didn't reach users. `public/service-worker.js` and
// `public/sw.js` are now self-destructing stubs that unregister the old worker
// and clear its caches on the next update check. Do NOT re-enable `withPWA`
// (below) without a proper update-on-reload / skipWaiting strategy, or the
// stale-bundle problem comes back. Firebase push uses a separate worker
// (public/firebase-messaging-sw.js) and is unaffected.
const withPWA = require("next-pwa")({
  dest: "public",

  scope: "/",
  // disable: process.env.NODE_ENV === 'development',
  register: true,
  // scope: '/app',
  sw: "service-worker.js",
  //...
});
// module.exports = withPWA(nextConfig);
module.exports = nextConfig;
