import { IUser } from "@/models/model";
import { cookies } from "next/headers";
import LandingPage from "./LandingPage";
import { Metadata } from "next";
import { redirect } from "next/navigation";
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
    params: Promise<any>;
    searchParams: Promise<any>;
  }
) {
  const searchParams = await props.searchParams;
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

  // Resolve valid slug BEFORE rendering - no redirects!
  if (!slugs || slugs === "undefined" || slugs === "null" || slugs === "") {
    console.log("❌ Invalid or missing project ID in URL, resolving valid slug...");
    
    // Try to use previousBoard cookie as fallback
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
    
    // Last fallback: get first project
    if (!slugs || slugs === "undefined" || slugs === "null" || slugs === "") {
      const response: any = await getFirst(userObj.id);
      console.log("🚀 ~ getFirst ~ response:", response);
      if (response?.json?.id) {
        // Deliberately NO redirect here, despite the URL still lacking ?id=.
        // getFirst() is awaited, so by this point the response has usually begun
        // streaming, and Next cannot answer with a 307 once that happens — it
        // serialises the redirect into the flight payload as an *error*
        // (`"digest":"NEXT_REDIRECT;replace;/project?id=N;307;"`) and some
        // clients render Next's "This page couldn't load" instead of the board
        // (HTPR-4847). Same failure mode as /timers, see the redirects() note in
        // next.config.js (HTPR-4753 / HTPR-4071).
        //
        // Redirecting was redundant anyway: the resolved slug is passed straight
        // to <LandingPage slugs={slugs}> below, and LandingPage already rewrites
        // the URL to ?id=<slug> client-side whenever it is missing or stale. So
        // dropping it renders the board on the first pass instead of rendering,
        // throwing it away, and rendering again — one less full server round-trip
        // on every id-less visit to the app's most-used route.
        slugs = response.json.id.toString();
      } else {
        // ponytail: user has no boards at all. redirect("/") used to bounce back here
        // via middleware and loop until the client hard-reset the session (HTPR-4828).
        // HTPR-4839: out of trial is now the free tier, so everyone lands here.
        return <NoBoardsEmptyState user={userObj} />;
      }
    }
  }

  // Now we always have a valid slug - start timing and continue
  console.time("board");

  // Ultra-fast validation - only check if user has access to this project
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
    // Deliberately NO redirect after the validation await: Next may already be
    // streaming and turn it into a client error. Render the same UI inline
    // instead (HTPR-4856; same failure mode as HTPR-4847 above).
    return <Unauthorized />;
  }

  // View handling and full project loading is now deferred to client-side
  console.timeEnd("board");

  // Always render with valid slug - no redirects means no hook issues!
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
        slugs={slugs}
        user={userObj}
        authenticated={authenticated}
      />
    </>
  );
}
