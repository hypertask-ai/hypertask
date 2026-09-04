import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isFeatureEnabled } from "@/lib/flags";
import { isValidUser } from "@/utils/edgeHelpers";

const CACHE_CONTROL = "private, s-maxage=3600, stale-while-revalidate=86400";
const NO_STORE = "private, no-store";
const PREVIEW_FLAG = "htpr-6116-figma-node-preview";
const UPSTREAM_TIMEOUT_MS = 5000;
const MAX_OEMBED_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_IMAGES_BYTES = 256 * 1024;
const MAX_PREVIEW_IMAGES = 6;

type FigmaOembed = {
  thumbnailUrl: string;
  title: string;
  width: number;
  height: number;
};

type FigmaTarget = {
  fileKey: string;
  nodeId: string | null;
};

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

const parseFigmaTarget = (url: URL): FigmaTarget | null => {
  const match = url.pathname.match(
    /^\/(?:design|file|proto|board)\/([A-Za-z0-9]{22,128})(?:\/|$)/,
  );
  if (!match) return null;

  const rawNodeId = url.searchParams.get("node-id");
  if (rawNodeId === null) return { fileKey: match[1], nodeId: null };
  if (!/^\d{1,10}[:-]\d{1,10}$/.test(rawNodeId)) return null;

  return { fileKey: match[1], nodeId: rawNodeId.replace("-", ":") };
};

const readJson = async (response: Response, maxBytes: number) => {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes || !response.body) {
    await response.body?.cancel();
    throw new Error("Figma returned an invalid preview");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("Figma returned an invalid preview");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return JSON.parse(new TextDecoder().decode(body));
};

const fetchJson = async (
  url: URL,
  maxBytes: number,
  token?: string,
): Promise<unknown> => {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(token ? { "X-Figma-Token": token } : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Figma preview is unavailable");
  return readJson(response, maxBytes);
};

const isHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.port
    );
  } catch {
    return false;
  }
};

const getOembed = async (figmaUrl: URL): Promise<FigmaOembed> => {
  const oEmbedUrl = new URL("https://www.figma.com/api/oembed");
  oEmbedUrl.searchParams.set("url", figmaUrl.toString());
  const data = (await fetchJson(oEmbedUrl, MAX_OEMBED_BYTES)) as Record<
    string,
    unknown
  >;

  if (
    !isHttpsUrl(data.thumbnail_url) ||
    typeof data.title !== "string" ||
    typeof data.width !== "number" ||
    typeof data.height !== "number"
  ) {
    throw new Error("Figma returned an invalid preview");
  }

  return {
    thumbnailUrl: data.thumbnail_url,
    title: data.title,
    width: data.width,
    height: data.height,
  };
};

const getRenderedImages = async (
  target: FigmaTarget,
  token: string,
): Promise<{
  title?: string;
  previewImages: { url: string; name: string }[];
}> => {
  let nodes: { id: string; name: string }[];
  let title: string | undefined;

  if (target.nodeId) {
    nodes = [{ id: target.nodeId, name: "Figma frame" }];
  } else {
    const fileUrl = new URL(
      `https://api.figma.com/v1/files/${encodeURIComponent(target.fileKey)}`,
    );
    fileUrl.searchParams.set("depth", "2");
    const file = (await fetchJson(fileUrl, MAX_FILE_BYTES, token)) as {
      name?: unknown;
      document?: { children?: unknown };
    };
    title = typeof file.name === "string" ? file.name : undefined;
    const firstPage = Array.isArray(file.document?.children)
      ? file.document.children[0]
      : null;
    const children =
      firstPage && typeof firstPage === "object" && "children" in firstPage
        ? firstPage.children
        : null;
    nodes = (Array.isArray(children) ? children : [])
      .filter((node): node is { id: string; name: string; type: string } =>
        Boolean(
          node &&
          typeof node === "object" &&
          "type" in node &&
          node.type === "FRAME" &&
          "id" in node &&
          typeof node.id === "string" &&
          /^\d{1,10}:\d{1,10}$/.test(node.id) &&
          "name" in node &&
          typeof node.name === "string",
        ),
      )
      .slice(0, MAX_PREVIEW_IMAGES)
      .map(({ id, name }) => ({ id, name }));
  }

  if (nodes.length === 0) return { title, previewImages: [] };

  const imagesUrl = new URL(
    `https://api.figma.com/v1/images/${encodeURIComponent(target.fileKey)}`,
  );
  imagesUrl.searchParams.set("ids", nodes.map(({ id }) => id).join(","));
  imagesUrl.searchParams.set("format", "png");
  imagesUrl.searchParams.set("scale", "1");
  const rendered = (await fetchJson(imagesUrl, MAX_IMAGES_BYTES, token)) as {
    images?: unknown;
  };
  const images =
    rendered.images && typeof rendered.images === "object"
      ? (rendered.images as Record<string, unknown>)
      : {};

  return {
    title,
    previewImages: nodes.flatMap(({ id, name }) =>
      isHttpsUrl(images[id]) ? [{ url: images[id], name }] : [],
    ),
  };
};

export async function GET(request: NextRequest) {
  // Embeds only render for signed-in users, so this must not be an open
  // fetch proxy for anonymous callers.
  const cookieStore = await cookies();
  const { isValid, user } = isValidUser(cookieStore.get("nookies_user")?.value);
  if (!isValid || !user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const figmaUrl = parseFigmaUrl(request.nextUrl.searchParams.get("url"));
  if (!figmaUrl) {
    return NextResponse.json(
      { error: "A valid figma.com URL is required" },
      { status: 400 },
    );
  }

  try {
    // Besides supplying the fallback, a successful public oEmbed lookup keeps
    // the company token from exposing a private file through this route.
    const fallback = await getOembed(figmaUrl);
    const token = process.env.FIGMA_ACCESS_TOKEN?.trim();
    const enabled = token
      ? await isFeatureEnabled(PREVIEW_FLAG, Number(user.id)).catch(() => false)
      : false;
    const target = enabled ? parseFigmaTarget(figmaUrl) : null;
    const fileAllowed = process.env.FIGMA_PREVIEW_FILE_KEYS?.split(",").some(
      (fileKey) => fileKey.trim() === target?.fileKey,
    );
    if (!token || !target || !fileAllowed) {
      return NextResponse.json(fallback, {
        headers: { "Cache-Control": CACHE_CONTROL },
      });
    }

    try {
      const rendered = await getRenderedImages(target, token);
      if (rendered.previewImages.length > 0) {
        return NextResponse.json(
          {
            ...fallback,
            title: rendered.title ?? fallback.title,
            previewImages: rendered.previewImages,
          },
          { headers: { "Cache-Control": NO_STORE } },
        );
      }
    } catch {
      // Files outside the token's access and Figma quota failures keep the
      // existing cover rather than breaking the embed.
    }

    return NextResponse.json(fallback, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
  } catch {
    return NextResponse.json(
      { error: "Figma preview is unavailable" },
      { status: 502 },
    );
  }
}
