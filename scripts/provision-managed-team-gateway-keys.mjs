#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const apiUrl = (
  process.env.HYPERTASK_API_URL ?? "https://app.hypertask.ai"
).replace(/\/$/, "");
const managementKey = process.env.HYPERTASK_MANAGEMENT_KEY?.trim();

if (!managementKey?.startsWith("htmk_")) {
  throw new Error("HYPERTASK_MANAGEMENT_KEY must contain an htmk_ management key");
}

const registryUrl = new URL(
  "../config/managed-team-gateway-keys.json",
  import.meta.url
);
const registry = JSON.parse(await readFile(registryUrl, "utf8"));
const targets = registry.map(({ credentialEnv, ...selector }) => {
  const apiKey = process.env[credentialEnv]?.trim();
  if (!apiKey?.startsWith("vck_")) {
    throw new Error(`${credentialEnv} must contain a vck_ gateway key`);
  }
  return { ...selector, apiKey };
});

const response = await fetch(`${apiUrl}/api/mcp/admin/team-gateway-keys`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${managementKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ targets, removeMatchingLegacyRows: true }),
});
const result = await response.json();

if (!response.ok || !result.success) {
  throw new Error(result.error ?? `Provisioning failed with HTTP ${response.status}`);
}

for (const key of result.keys) {
  console.log(
    `${key.teamId}\t${key.title}\t${key.ownerEmail}\t${key.fingerprint}`
  );
}
