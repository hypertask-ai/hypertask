import type { NextRequest, NextResponse } from 'next/server'

import authConfig from '@/lib/configs/auth.config'
import { themeCookieSeedValue } from '@/lib/themePreferences'

export function getThemeCookieOptions() {
  return {
    httpOnly: false,
    secure: authConfig.cookies.options.secure(),
    sameSite: authConfig.cookies.options.sameSite,
    maxAge: authConfig.cookies.maxAge,
    path: authConfig.cookies.options.path,
  }
}

export function seedResponseThemeCookie(
  request: NextRequest,
  response: NextResponse
): boolean {
  const existingTheme = request.cookies.get(authConfig.cookies.theme)?.value
  const themeToSeed = themeCookieSeedValue(existingTheme)
  if (!themeToSeed) return false

  response.cookies.set(
    authConfig.cookies.theme,
    themeToSeed,
    getThemeCookieOptions()
  )
  return true
}
