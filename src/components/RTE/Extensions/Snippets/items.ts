import { getSnippets } from "@/lib/snippets";

const getSuggestionItems = async ({ query }: { query: string }) => {
  const snippets = await getSnippets();
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) return snippets;

  return snippets.filter((snippet) =>
    snippet.title.toLowerCase().includes(normalizedQuery),
  );
};

export default getSuggestionItems;
