import { redirect } from "next/navigation";

import PageEditor from "./PageEditor";
import { requireServerCookieUser } from "@/lib/auth/serverUser";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This server component gates taskless page access.
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7298_STANDALONE_PAGES_FLAG } from "@/lib/flags/keys";
import prisma from "@/lib/prisma";
import { getPage } from "@/utils/controllers/pages/pageService";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const viewport = {
  maximumScale: 5,
  userScalable: true,
};

export default async function Page(props: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await props.params;
  const currentUser = await requireServerCookieUser();
  const page = await getPage({ publicId, userId: currentUser.id });

  if (!page) {
    redirect("/");
  }

  const origin = await prisma.page.findUnique({
    where: { id: page.id },
    select: { taskId: true },
  });
  if (origin?.taskId == null && !(await isFeatureEnabled(HTPR_7298_STANDALONE_PAGES_FLAG, currentUser.id))) {
    redirect("/");
  }

  const ok = await prisma.project.findFirst({
    where: {
      id: page.projectId,
      status: "Normal",
      ...getProjectWhere(currentUser.id, null),
    },
    select: { id: true },
  });

  if (!ok) {
    redirect("/");
  }

  return (
    <PageEditor
      _page={JSON.stringify(page)}
      _user={JSON.stringify(currentUser)}
    />
  );
}
