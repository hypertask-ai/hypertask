import {
  resolvedThemeDomMetadata,
  availableThemeOptions,
  type ResolvedTheme,
  type ThemeVisibility,
} from '@/lib/themePreferences'

export const buildThemeBootScript = (
  cookieName: string,
  systemLightTheme: ResolvedTheme,
  systemDarkTheme: ResolvedTheme,
  roundedEnabled = false,
  graphite2Enabled = true,
  visibility?: ThemeVisibility,
): string => {
  const cookiePrefix = JSON.stringify(`${cookieName}=`)
  const lightTheme = JSON.stringify(systemLightTheme)
  const darkTheme = JSON.stringify(systemDarkTheme)
  const supportedThemes = JSON.stringify(
    ["system", ...availableThemeOptions(roundedEnabled, graphite2Enabled, visibility).map(({ value }) => value)],
  )
  const domMetadata = JSON.stringify(resolvedThemeDomMetadata)
  const removableClasses = JSON.stringify([
    'system',
    ...new Set(
      Object.values(resolvedThemeDomMetadata).flatMap(({ classes }) => classes),
    ),
  ])

  return `(function(){try{const prefix=${cookiePrefix};const match=document.cookie.split('; ').find(function(row){return row.indexOf(prefix)===0});let theme=match?match.slice(prefix.length):'system';const retirement=${JSON.stringify(graphite2Enabled && !visibility?.restore)};if(theme==='dark'){theme=retirement?'graphite-2':'graphite';}else if(theme==='light'){theme='porcelain';}else if(retirement&&theme==='graphite'){theme='graphite-2';}else if(retirement&&theme==='dia'){theme='porcelain';}else if(retirement&&theme==='rounded'){theme='system';}const supported=${supportedThemes};if(supported.indexOf(theme)===-1||(theme==='rounded'&&!window.matchMedia('(min-width: 768px)').matches)){theme='system';}let resolved=theme;if(theme==='rounded'){resolved=window.matchMedia('(prefers-color-scheme: dark)').matches?'rounded-dark':'rounded-light';}if(theme==='system'){resolved=window.matchMedia('(prefers-color-scheme: dark)').matches?${darkTheme}:${lightTheme};}const metadata=${domMetadata};const element=document.documentElement;element.classList.remove(...${removableClasses});const selected=metadata[resolved];if(selected){element.classList.add(...selected.classes);element.setAttribute('data-theme',resolved);const themeColor=document.querySelector('meta[name="theme-color"]');if(themeColor){themeColor.setAttribute('content',selected.themeColor);}}}catch{}})();`
}
