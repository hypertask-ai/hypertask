import { redirect } from "next/navigation";

import PageEditor from "./PageEditor";
import { requireServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import { getPage } from "@/utils/controllers/pages/pageService";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export default async function Page(props: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await props.params;
  const currentUser = await requireServerCookieUser();
  const page = await getPage({ publicId });

  if (!page) {
    redirect("/");
  }

  const ok = await prisma.task.findFirst({
    where: {
      id: page.taskId,
      project: {
        status: "Normal",
        ...getProjectWhere(currentUser.id, null),
      },
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
