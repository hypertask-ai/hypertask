import { timingSafeEqual } from "node:crypto";

import { FEATURE_FLAG_QA_USER_ID } from "@/lib/flags";

export const QA_LOGIN_USER_ID = FEATURE_FLAG_QA_USER_ID;
export const QA_LOGIN_PASSWORD_MIN_BYTES = 32;

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
  if (
    !email ||
    Buffer.byteLength(password, "utf8") < QA_LOGIN_PASSWORD_MIN_BYTES
  ) {
    return null;
  }
  return { email, password };
}

export function isQaLoginConfigured(): boolean {
  return getQaLoginConfig() !== null;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  const size = Math.max(leftBuffer.length, rightBuffer.length, 1);
  const paddedLeft = Buffer.alloc(size);
  const paddedRight = Buffer.alloc(size);
  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);
  return (
    timingSafeEqual(paddedLeft, paddedRight) &&
    leftBuffer.length === rightBuffer.length
  );
}

export function qaLoginCredentialsMatch(
  email: string,
  password: string,
  config: QaLoginConfig,
): boolean {
  const emailOk = timingSafeStringEqual(
    normalizeQaLoginEmail(email),
    config.email,
  );
  const passwordOk = timingSafeStringEqual(password, config.password);
  return emailOk && passwordOk;
}
