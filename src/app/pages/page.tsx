import { notFound } from "next/navigation";

import { requireServerCookieUser } from "@/lib/auth/serverUser";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- Server route gates the Pages screen.
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7298_STANDALONE_PAGES_FLAG } from "@/lib/flags/definitions/htpr-7298-standalone-pages";
import { HTPR_7309_PAGES_SCREENS_FLAG } from "@/lib/flags/definitions/htpr-7309-pages-screens";
import PagesListScreen from "./PagesListScreen";

export const metadata = { title: "Pages" };

export default async function Pages() {
  const user = await requireServerCookieUser();
  const pagesEnabled = await isFeatureEnabled(HTPR_7309_PAGES_SCREENS_FLAG, user.id);
  if (!(await isFeatureEnabled(HTPR_7298_STANDALONE_PAGES_FLAG, user.id))) notFound();
  return pagesEnabled ? <PagesListScreen currentUser={user} /> : notFound();
}
