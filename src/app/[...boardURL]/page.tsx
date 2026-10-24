import { IUser } from "@/models/model";
import { getServerBoardDocument } from "@/lib/firstScreen/serverBoardDocument";

export const dynamic = "force-dynamic";
export const revalidate = 0;
import { cookies } from "next/headers";
import LandingPage from "./LandingPage";
import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import getFirst from "@/utils/controllers/projects/getFirst";
import NoBoardsEmptyState from "./NoBoardsEmptyState";
import Unauthorized from "../unauthorized/page";
import { buildEarlyBoardBootstrapScript } from "@/lib/boardBootstrap/earlyBoardBootstrap";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  buildBoardRouteTitle,
  type BoardRouteSearchParams,
  resolveBoardRouteTitleRequest,
} from "@/lib/boardRouteTitle";
import { getProjectForValidation } from "@/lib/boardRouteMetadata";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7799_PROJECT_ENTRY_FLAG } from "@/lib/flags/keys";
import {
  buildCanonicalBoardUrl,
  resolveBoardRoutePath,
} from "@/lib/boardRoutePath";

export async function generateMetadata(props: {
  searchParams: Promise<BoardRouteSearchParams>;
}): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value);
  const request = resolveBoardRouteTitleRequest(
    searchParams,
    cookieStore.get("previousBoard")?.value,
  );

  if (!session || !request.projectId) return { title: "Hypertask" };

  const projectValidation = await getProjectForValidation(
    session.id,
    request.projectId,
    request.viewSlug,
  );
  if (!projectValidation.success || !projectValidation.project) {
    return { title: "Hypertask" };
  }

  return {
    title: buildBoardRouteTitle(
      projectValidation.project.title,
      projectValidation.project.viewTitle,
    ),
  };
}

export default async function Page(
  props: {
    params: Promise<{ boardURL?: string[] }>;
    searchParams: Promise<any>;
  }
) {
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const pathResolution = resolveBoardRoutePath(params.boardURL);

  if (pathResolution.kind === "not-found") {
    notFound();
  }
  if (pathResolution.kind === "redirect") {
    redirect(buildCanonicalBoardUrl(pathResolution.projectId, searchParams));
  }

  const missingProjectId = !searchParams?.id || searchParams.id === "undefined" || searchParams.id === "null";
  const firstScreen = await getServerBoardDocument();
  if (firstScreen) {
    return <LandingPage key="board" slugs={String(firstScreen.data.projectId)} user={firstScreen.data.user} authenticated />;
  }
  const cookieStore = await cookies();

  let userObjString: any = cookieStore.get("nookies_user");
  var userObj: IUser;
  try {
    userObj = JSON.parse(userObjString.value);
  } catch (error) {
    console.log("🪵 ~ Page ~ error:", error);
    redirect("/login");
  }

  let previousBoardString = cookieStore.get("previousBoard");
  let slugs = searchParams?.id;

  const projectEntryEnabled = await isFeatureEnabled(HTPR_7799_PROJECT_ENTRY_FLAG, userObj.id);
  if (missingProjectId && projectEntryEnabled) {
    const rememberedId = previousBoardString?.value.split("|&|")[0].match(/^project-([1-9]\d*)$/)?.[1];
    const where = { status: "Normal" as const, ...getProjectWhere(userObj.id) };
    let board;
    try {
      board = rememberedId && Number.isSafeInteger(Number(rememberedId))
        ? await prisma.project.findFirst({ where: { ...where, id: Number(rememberedId) }, select: { id: true } })
        : null;
      board ??= await prisma.project.findFirst({ where, orderBy: { id: "asc" }, select: { id: true } });
    } catch {
      return projectEntryEnabled ? <Unauthorized /> : null;
    }
    if (!board) return <NoBoardsEmptyState user={userObj} />;
    redirect(buildCanonicalBoardUrl(String(board.id), searchParams));
  }

  if (!slugs || slugs === "undefined" || slugs === "null" || slugs === "") {
    console.log("❌ Invalid or missing project ID in URL, resolving valid slug...");
    
    if (previousBoardString?.value) {
      try {
        const [projectId, view] = previousBoardString.value.split('|&|');
        const projectIdNumber = projectId.split("-")[1];
        
        if (projectIdNumber && projectIdNumber !== "undefined" && projectIdNumber !== "null") {
          slugs = projectIdNumber;
        }
      } catch (error) {
        console.log("🪵 ~ Error parsing previousBoard cookie:", error);
      }
    }
    
    if (!slugs || slugs === "undefined" || slugs === "null" || slugs === "") {
      const response: any = await getFirst(userObj.id);
      console.log("🚀 ~ getFirst ~ response:", response);
      if (response?.json?.id) {
        slugs = response.json.id.toString();
      } else {
        return <NoBoardsEmptyState user={userObj} />;
      }
    }
  }


  const titleRequest = resolveBoardRouteTitleRequest(
    searchParams,
    previousBoardString?.value,
  );
  const projectValidation = await getProjectForValidation(
    userObj.id,
    slugs,
    titleRequest.viewSlug,
  );

  if (!projectValidation.success || !projectValidation.project) {
    return <Unauthorized />;
  }


  const accountId = Number(userObj.id);
  const projectId = Number(slugs);
  const signedSession = verifySession(
    cookieStore.get(SESSION_COOKIE)?.value,
  );
  const authenticated = signedSession?.id === accountId;

  return (
    <>
      {Number.isInteger(accountId) &&
      accountId > 0 &&
      Number.isInteger(projectId) &&
      projectId > 0 ? (
        <script
          id="ht-early-board-bootstrap"
          dangerouslySetInnerHTML={{
            __html: buildEarlyBoardBootstrapScript({
              accountId,
              projectId,
            }),
          }}
        />
      ) : null}
      <LandingPage
        key="board"
        slugs={slugs}
        user={userObj}
        authenticated={authenticated}
      />
    </>
  );
}
