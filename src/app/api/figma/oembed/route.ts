import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidUser } from "@/utils/edgeHelpers";

const CACHE_CONTROL = "private, s-maxage=3600, stale-while-revalidate=86400";
const UPSTREAM_TIMEOUT_MS = 5000;
// Figma's oEmbed payload is a few hundred bytes; anything larger is not it.
const MAX_RESPONSE_BYTES = 64 * 1024;

const parseFigmaUrl = (value: string | null) => {
  if (!value) return null;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      (hostname !== "figma.com" && !hostname.endsWith(".figma.com"))
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
};

export async function GET(request: NextRequest) {
  // Embeds only render for signed-in users, so this must not be an open
  // fetch proxy for anonymous callers.
  const cookieStore = await cookies();
  const { isValid, user } = isValidUser(
    cookieStore.get("nookies_user")?.value
  );
  if (!isValid || !user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const figmaUrl = parseFigmaUrl(request.nextUrl.searchParams.get("url"));
  if (!figmaUrl) {
    return NextResponse.json(
      { error: "A valid figma.com URL is required" },
      { status: 400 }
    );
  }

  const oEmbedUrl = new URL("https://www.figma.com/api/oembed");
  oEmbedUrl.searchParams.set("url", figmaUrl.toString());

  try {
    const response = await fetch(oEmbedUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Figma preview is unavailable" },
        { status: 502 }
      );
    }

    // Read as text with a cap so an unexpectedly large body cannot be parsed
    // straight into memory.
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) {
      return NextResponse.json(
        { error: "Figma returned an invalid preview" },
        { status: 502 }
      );
    }

    const data = JSON.parse(body);
    if (
      typeof data.thumbnail_url !== "string" ||
      typeof data.title !== "string" ||
      typeof data.width !== "number" ||
      typeof data.height !== "number"
    ) {
      return NextResponse.json(
        { error: "Figma returned an invalid preview" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        thumbnailUrl: data.thumbnail_url,
        title: data.title,
        width: data.width,
        height: data.height,
      },
      { headers: { "Cache-Control": CACHE_CONTROL } }
    );
  } catch {
    return NextResponse.json(
      { error: "Figma preview is unavailable" },
      { status: 502 }
    );
  }
}
