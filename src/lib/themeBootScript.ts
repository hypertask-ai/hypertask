import {
  resolvedThemeDomMetadata,
  themeOptions,
  type ResolvedTheme,
} from '@/lib/themePreferences'

export const buildThemeBootScript = (
  cookieName: string,
  systemLightTheme: ResolvedTheme,
  systemDarkTheme: ResolvedTheme,
  roundedEnabled = false,
): string => {
  const cookiePrefix = JSON.stringify(`${cookieName}=`)
  const lightTheme = JSON.stringify(systemLightTheme)
  const darkTheme = JSON.stringify(systemDarkTheme)
  const supportedThemes = JSON.stringify(
    themeOptions.filter(({ value }) => value !== "rounded" || roundedEnabled).map(({ value }) => value),
  )
  const domMetadata = JSON.stringify(resolvedThemeDomMetadata)
  const removableClasses = JSON.stringify([
    'system',
    ...new Set(
      Object.values(resolvedThemeDomMetadata).flatMap(({ classes }) => classes),
    ),
  ])

  return `(function(){try{const prefix=${cookiePrefix};const match=document.cookie.split('; ').find(function(row){return row.indexOf(prefix)===0});let theme=match?match.slice(prefix.length):'system';if(theme==='dark'){theme='graphite';}else if(theme==='light'){theme='porcelain';}const supported=${supportedThemes};if(supported.indexOf(theme)===-1){theme='system';}let resolved=theme;if(theme==='rounded'){resolved=window.matchMedia('(prefers-color-scheme: dark)').matches?'rounded-dark':'rounded-light';}if(theme==='system'){resolved=window.matchMedia('(prefers-color-scheme: dark)').matches?${darkTheme}:${lightTheme};}const metadata=${domMetadata};const element=document.documentElement;element.classList.remove(...${removableClasses});const selected=metadata[resolved];if(selected){element.classList.add(...selected.classes);element.setAttribute('data-theme',resolved);const themeColor=document.querySelector('meta[name="theme-color"]');if(themeColor){themeColor.setAttribute('content',selected.themeColor);}}}catch{}})();`
}
