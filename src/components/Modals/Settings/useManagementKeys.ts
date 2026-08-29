"use client";

import { useCallback, useEffect, useState } from "react";

export type ManagementKeyScope = "management" | "usage" | "full";

export type ManagementKey = {
  id: string;
  name: string | null;
  start: string | null;
  permissions: Record<string, string[]>;
  enabled: boolean;
  lastRequest: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type CreateManagementKeyInput = {
  name: string;
  scope: ManagementKeyScope;
  expiresInDays?: number;
};

export type CreatedManagementKey = {
  key: string;
  apiKey: ManagementKey;
  warning: string;
};

type ApiResponse = {
  success: boolean;
  error?: string;
};

const normalizeKey = (key: ManagementKey): ManagementKey => ({
  ...key,
  id: String(key.id),
});

const readResponse = async <T extends ApiResponse>(response: Response) => {
  const data = (await response.json()) as T;
  if (!response.ok || !data.success) {
    throw new Error(data.error || "Management key request failed");
  }
  return data;
};

export const useManagementKeys = () => {
  const [keys, setKeys] = useState<ManagementKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/mcp/admin/keys", {
        credentials: "include",
      });
      const data = await readResponse<ApiResponse & { keys: ManagementKey[] }>(
        response,
      );
      setKeys(data.keys.map(normalizeKey));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load management keys",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createKey = useCallback(async (input: CreateManagementKeyInput) => {
    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/mcp/admin/keys", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await readResponse<ApiResponse & CreatedManagementKey>(
        response,
      );
      const created = { ...data, apiKey: normalizeKey(data.apiKey) };
      setKeys((current) => [created.apiKey, ...current]);
      return created;
    } finally {
      setIsCreating(false);
    }
  }, []);

  const revokeKey = useCallback(
    async (keyId: string) => {
      setRevokingKeyId(keyId);
      setError(null);
      try {
        const response = await fetch("/api/mcp/admin/keys", {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyId }),
        });
        await readResponse<ApiResponse>(response);
        await refresh();
      } finally {
        setRevokingKeyId(null);
      }
    },
    [refresh],
  );

  return {
    keys,
    error,
    isLoading,
    isCreating,
    isRevoking: revokingKeyId !== null,
    revokingKeyId,
    createKey,
    revokeKey,
    refresh,
  };
};
