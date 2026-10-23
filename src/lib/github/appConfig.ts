import prisma from "@/lib/prisma";

import { decryptGithubAppCredential } from "./appCredentialCipher";

export type GithubAppConfig = {
  appId: string;
  clientId: string;
  clientSecret: string;
  slug: string;
  stateSecret: string;
};

type StoredConfig = { config: GithubAppConfig; privateKey: string; webhookSecret: string };
const CACHE_TTL_MS = 60_000;
let cached: { expiresAt: number; value: Promise<StoredConfig | null> } | null = null;

function validConfig(config: GithubAppConfig): boolean {
  return /^[1-9][0-9]*$/.test(config.appId) &&
    /^[a-z0-9][a-z0-9-]*$/.test(config.slug) &&
    Boolean(config.clientId && config.clientSecret) && config.stateSecret.length >= 32;
}

function envConfig(): GithubAppConfig | null {
  const config = {
    appId: process.env.GITHUB_APP_ID?.trim() ?? "",
    clientId: process.env.GITHUB_APP_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET?.trim() ?? "",
    slug: process.env.GITHUB_APP_SLUG?.trim() ?? "",
    stateSecret: process.env.GITHUB_APP_STATE_SECRET?.trim() ?? "",
  };
  return validConfig(config) ? config : null;
}

export function clearGithubAppConfigCache(): void {
  cached = null;
}

async function readStoredConfig(): Promise<StoredConfig | null> {
  try {
    const row = await prisma.githubAppCredential.findFirst({ where: { revokedAt: null } });
    if (!row) return null;
    const config = {
      appId: row.appId,
      slug: row.slug,
      clientId: row.clientId,
      clientSecret: decryptGithubAppCredential("clientSecret", row.clientSecret),
      stateSecret: decryptGithubAppCredential("stateSecret", row.stateSecret),
    };
    if (!validConfig(config)) return null;
    return {
      config,
      privateKey: decryptGithubAppCredential("privateKey", row.privateKey),
      webhookSecret: decryptGithubAppCredential("webhookSecret", row.webhookSecret),
    };
  } catch {
    return null;
  }
}

function storedConfig(): Promise<StoredConfig | null> {
  if (!cached || cached.expiresAt <= Date.now()) {
    cached = { expiresAt: Date.now() + CACHE_TTL_MS, value: readStoredConfig() };
  }
  return cached.value;
}

export async function hasGithubAppCredential(): Promise<boolean> {
  if (envConfig()) return true;
  return Boolean(await prisma.githubAppCredential.findFirst({
    where: { revokedAt: null }, select: { id: true },
  }));
}

export async function getGithubAppConfig(): Promise<GithubAppConfig | null> {
  return envConfig() ?? (await storedConfig())?.config ?? null;
}

export async function getGithubAppPrivateKey(): Promise<string | null> {
  const value = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  return value ? value.replace(/\\n/g, "\n") : (await storedConfig())?.privateKey ?? null;
}

export async function getGithubAppWebhookSecret(): Promise<string | null> {
  return process.env.GITHUB_APP_WEBHOOK_SECRET?.trim() || (await storedConfig())?.webhookSecret || null;
}
