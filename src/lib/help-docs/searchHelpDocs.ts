import { HTPR_7825_WHOLE_HELP_ARTICLES_FLAG } from "@/lib/flags/definitions/htpr-7825-whole-help-articles";
import { isFeatureEnabled } from "@/lib/flags";

export const HELP_DOCS_BASE_URL = "https://help.hypertask.ai";

const HELP_DOCS_FETCH_TIMEOUT_MS = 8000;
const HELP_DOCS_CONTENT_LIMIT = 1500;
const HELP_DOCS_FLAG_USER_ID = 0;

type HelpDocsFlagDb = Parameters<typeof isFeatureEnabled>[2];

export interface HelpDocsSearchInput {
  query: string;
  limit: number;
}

interface HelpDocsSearchHit {
  title?: string;
  slug?: string;
  excerpt?: string;
}

interface HelpDocsArticleResponse {
  content?: string;
  article?: { content?: string };
}

export interface HelpDocsArticle {
  title?: string;
  url?: string;
  content: string;
}

export type HelpDocsSearchResponse =
  | {
      success: true;
      articles: HelpDocsArticle[];
      total: number;
    }
  | {
      success: false;
      error: string;
    };

function helpDocsErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error && !error.name.startsWith("Prisma")) {
    return error.message;
  }
  return "Sorry, an error occurred while processing your request.";
}

function helpArticleText(html: string, wholeArticle: boolean) {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return wholeArticle ? text : text.slice(0, HELP_DOCS_CONTENT_LIMIT);
}

export async function searchHelpDocs(
  input: HelpDocsSearchInput,
  fetchImpl: typeof fetch = fetch,
  db?: HelpDocsFlagDb,
): Promise<HelpDocsSearchResponse> {
  try {
    const wholeArticle = await isFeatureEnabled(
      HTPR_7825_WHOLE_HELP_ARTICLES_FLAG,
      HELP_DOCS_FLAG_USER_ID,
      db,
    ).catch(() => true);
    const res = await fetchImpl(
      `${HELP_DOCS_BASE_URL}/api/articles/search/${encodeURIComponent(input.query)}`,
      { signal: AbortSignal.timeout(HELP_DOCS_FETCH_TIMEOUT_MS) }
    );
    if (!res.ok) {
      return { success: false, error: `Help search failed (${res.status})` };
    }

    const hits = (await res.json()) as HelpDocsSearchHit[];
    const top = (Array.isArray(hits) ? hits : []).slice(0, input.limit);
    const articles = await Promise.all(
      top.map(async (hit) => {
        let content = hit.excerpt ?? "";
        if (hit.slug) {
          try {
            const full = await fetchImpl(
              `${HELP_DOCS_BASE_URL}/api/articles/${hit.slug}`,
              { signal: AbortSignal.timeout(HELP_DOCS_FETCH_TIMEOUT_MS) }
            );
            if (full.ok) {
              const doc = (await full.json()) as HelpDocsArticleResponse;
              const html = doc.content ?? doc.article?.content;
              if (html) content = helpArticleText(html, wholeArticle);
            }
          } catch {
          }
        }

        return {
          title: hit.title,
          url: hit.slug
            ? `${HELP_DOCS_BASE_URL}/help/${hit.slug}`
            : undefined,
          content,
        };
      })
    );

    return {
      success: true,
      articles,
      total: articles.length,
    };
  } catch (error) {
    return { success: false, error: helpDocsErrorMessage(error) };
  }
}
