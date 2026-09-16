import { createHash, timingSafeEqual } from "node:crypto";

import { FEATURE_FLAG_QA_USER_ID } from "@/lib/flags";

export const QA_LOGIN_USER_ID = FEATURE_FLAG_QA_USER_ID;

export type QaLoginConfig = {
  email: string;
  password: string;
};

export function normalizeQaLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getQaLoginConfig(): QaLoginConfig | null {
  const email = normalizeQaLoginEmail(process.env.QA_LOGIN_EMAIL ?? "");
  const password = process.env.QA_LOGIN_PASSWORD ?? "";
  if (!email || !password) return null;
  return { email, password };
}

export function isQaLoginConfigured(): boolean {
  return getQaLoginConfig() !== null;
}

export function digestQaLoginValue(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function qaLoginCredentialsMatch(
  email: string,
  password: string,
  config: QaLoginConfig,
): boolean {
  const emailOk = timingSafeEqual(
    digestQaLoginValue(normalizeQaLoginEmail(email)),
    digestQaLoginValue(config.email),
  );
  const passwordOk = timingSafeEqual(
    digestQaLoginValue(password),
    digestQaLoginValue(config.password),
  );
  return emailOk && passwordOk;
}
