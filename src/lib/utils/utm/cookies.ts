/**
 * Client-side cookie utilities for UTM tracking
 * Single source of truth for cookie operations
 */

import { UTM_COOKIE_EXPIRY_DAYS } from "@/lib/constants/utm";

/**
 * Set a cookie with expiration
 */
export function setCookie(
  name: string,
  value: string,
  days: number = UTM_COOKIE_EXPIRY_DAYS
): void {
  if (typeof document === "undefined") {
    return;
  }

  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(
    value
  )};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

/**
 * Get a cookie value by name
 */
export function getCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const nameEQ = name + "=";
  const ca = document.cookie.split(";");
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === " ") c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0)
      return decodeURIComponent(c.substring(nameEQ.length, c.length));
  }
  return null;
}

