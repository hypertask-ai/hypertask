import { withoutAuth } from "#with-auth";
export const dynamic = "force-dynamic";

function notFound() {
  return new Response(null, { status: 404 });
}

async function GETHandler() {
  return notFound();
}

async function POSTHandler() {
  return notFound();
}

export const GET = withoutAuth(GETHandler);
export const POST = withoutAuth(POSTHandler);
