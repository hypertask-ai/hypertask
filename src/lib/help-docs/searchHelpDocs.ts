export const HELP_DOCS_BASE_URL = "https://help.hypertask.ai";

const HELP_DOCS_FETCH_TIMEOUT_MS = 8000;
const HELP_DOCS_CONTENT_LIMIT = 1500;

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

export async function searchHelpDocs(
  input: HelpDocsSearchInput,
  fetchImpl: typeof fetch = fetch
): Promise<HelpDocsSearchResponse> {
  try {
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
              if (html) {
                content = html
                  .replace(/<[^>]+>/g, " ")
                  .replace(/&nbsp;/g, " ")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, HELP_DOCS_CONTENT_LIMIT);
              }
            }
          } catch {
            // Fall back to the excerpt already returned by search.
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
