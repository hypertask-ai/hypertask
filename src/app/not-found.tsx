import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth/getSessionUser";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This server component must expose its gate directly to CI.
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7184_NOT_FOUND_THEMED_FLAG } from "@/lib/flags/definitions/htpr-7184-not-found-themed";

export default async function NotFound() {
  const sessionUser = await getSessionUser(new Headers(await headers())).catch(() => null);
  const themed = await isFeatureEnabled(HTPR_7184_NOT_FOUND_THEMED_FLAG, sessionUser?.userId ?? 0).catch(() => true);

  return (
    <div className={`min-h-screen flex items-center justify-center px-4 ${themed ? "bg-pageBackground text-white-black" : ""}`}>
      <h1 className="text-display font-semibold pr-6 mr-6 border-r border-border-light-gray-thin">404</h1>
      <h2 className="text-content">This page could not be found.</h2>
    </div>
  );
}
