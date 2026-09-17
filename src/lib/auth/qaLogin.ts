import { scryptSync, timingSafeEqual } from "node:crypto";

import { FEATURE_FLAG_QA_USER_ID } from "@/lib/flags";

export const QA_LOGIN_USER_ID = FEATURE_FLAG_QA_USER_ID;
export const QA_LOGIN_PASSWORD_MIN_BYTES = 32;
const QA_LOGIN_SCRYPT_KEYLEN = 64;
const QA_LOGIN_SCRYPT_SALT = Buffer.from("htpr-6536-qa-login");

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

function scryptQaLoginSecret(secret: string): Buffer {
  return scryptSync(secret, QA_LOGIN_SCRYPT_SALT, QA_LOGIN_SCRYPT_KEYLEN, {
    N: 16384,
    r: 8,
    p: 1,
  });
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
  const expected = scryptQaLoginSecret(config.password);
  const given = scryptQaLoginSecret(password);
  const passwordOk =
    expected.length === given.length && timingSafeEqual(expected, given);
  return emailOk && passwordOk;
}
