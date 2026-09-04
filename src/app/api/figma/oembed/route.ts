import { NextRequest, NextResponse } from "next/server";
import { getFigmaRequestUser } from "@/app/api/figma/_lib";
import { getFigmaAccessToken } from "@/lib/figma/connection";
import { FIGMA_API_BASE_URL } from "@/lib/figma/paths";

const CACHE_CONTROL = "private, max-age=3600";
const FRAME_CACHE_CONTROL = "private, max-age=86400";
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
      `${FIGMA_API_BASE_URL}/files/${encodeURIComponent(target.fileKey)}`,
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
    `${FIGMA_API_BASE_URL}/images/${encodeURIComponent(target.fileKey)}`,
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

function previewResponse(body: unknown, cacheControl = CACHE_CONTROL) {
  // Connect rotates and disconnect clears the client-readable, non-secret
  // connection version, so cached previews cannot cross authorization states.
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": cacheControl,
      Vary: "Cookie",
    },
  });
}

export async function GET(request: NextRequest) {
  const principal = await getFigmaRequestUser(request);
  if (principal.status === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const figmaUrl = parseFigmaUrl(request.nextUrl.searchParams.get("url"));
  if (!figmaUrl) {
    return NextResponse.json(
      { error: "A valid figma.com URL is required" },
      { status: 400 },
    );
  }

  const target = parseFigmaTarget(figmaUrl);
  const fallbackPromise = getOembed(figmaUrl).catch(() => null);
  if (principal.status !== "allowed" || !target) {
    const fallback = await fallbackPromise;
    return fallback
      ? previewResponse(fallback)
      : NextResponse.json(
          { error: "Figma preview is unavailable" },
          { status: 502 },
        );
  }

  let token: string | null | undefined;
  let rendered: Awaited<ReturnType<typeof getRenderedImages>> | null = null;
  try {
    token = await getFigmaAccessToken(principal.userId);
    if (token) rendered = await getRenderedImages(target, token);
  } catch {
    // A connection or Figma failure keeps the cover and the live embed click.
  }

  const fallback = await fallbackPromise;
  const basePreview = fallback ?? {
    thumbnailUrl: "",
    title: "Figma design",
    width: 16,
    height: 9,
  };
  if (rendered && rendered.previewImages.length > 0) {
    return previewResponse(
      {
        ...basePreview,
        thumbnailUrl: rendered.previewImages[0].url,
        title: rendered.title ?? basePreview.title,
        previewImages: rendered.previewImages,
      },
      FRAME_CACHE_CONTROL,
    );
  }

  return previewResponse({
    ...basePreview,
    ...(fallback ? {} : { previewUnavailable: true }),
    ...(token === null ? { canConnectFigma: true } : {}),
  });
}
