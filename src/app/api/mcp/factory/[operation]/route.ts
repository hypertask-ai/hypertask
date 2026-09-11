export const dynamic = "force-dynamic";

function notFound() {
  return new Response(null, { status: 404 });
}

export async function GET() {
  return notFound();
}

export async function POST() {
  return notFound();
}
