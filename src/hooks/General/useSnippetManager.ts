import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import toast from "react-hot-toast";
import {
  USER_PREFERENCES_QUERY_KEY,
  useGetUserPreferences,
  type IUserPreferences,
} from "@/hooks/General/useGetUserPreferences";
import { setCachedSnippets, type ISnippet } from "@/lib/snippets";

interface ISaveSnippet {
  editingId: string | null;
  title: string;
  content: string;
  isEmpty: boolean;
}

const useSnippetManager = () => {
  const queryClient = useQueryClient();
  const { data: preferences } = useGetUserPreferences();
  const snippets = preferences.snippets ?? [];

  useEffect(() => setCachedSnippets(snippets), [snippets]);

  const savePreferences = useMutation({
    mutationFn: async (nextSnippets: ISnippet[]) => {
      const response = await axios.post("/api/users/preferences", {
        snippets: nextSnippets,
      });
      return response.data.settings as IUserPreferences;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, settings);
      setCachedSnippets(settings.snippets ?? []);
    },
  });

  const saveSnippet = async ({
    editingId,
    title,
    content,
    isEmpty,
  }: ISaveSnippet) => {
    const snippetTitle = title.trim();
    if (!snippetTitle) {
      toast.error("Snippet title is required");
      return null;
    }
    if (isEmpty) {
      toast.error("Snippet content is required");
      return null;
    }

    const existing = snippets.find((snippet) => snippet.id === editingId);
    const snippet: ISnippet = {
      id: existing?.id ?? crypto.randomUUID(),
      title: snippetTitle,
      content,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const nextSnippets = existing
      ? snippets.map((item) => (item.id === existing.id ? snippet : item))
      : [...snippets, snippet];

    try {
      await savePreferences.mutateAsync(nextSnippets);
      toast.success(existing ? "Snippet updated" : "Snippet created");
      return snippet;
    } catch (error) {
      toast.error(
        axios.isAxiosError(error) && error.response?.data?.error
          ? error.response.data.error
          : "Failed to save snippet",
      );
      return null;
    }
  };

  const deleteSnippet = async (snippet: ISnippet) => {
    try {
      await savePreferences.mutateAsync(
        snippets.filter((item) => item.id !== snippet.id),
      );
      toast.success("Snippet deleted");
      return true;
    } catch {
      toast.error("Failed to delete snippet");
      return false;
    }
  };

  return {
    snippets,
    saveSnippet,
    deleteSnippet,
    isPending: savePreferences.isPending,
  };
};

export default useSnippetManager;
