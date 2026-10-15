import * as React from "react"

// Tailwind's md and lg (--breakpoint-md, --breakpoint-lg in its default
// theme; a unit test pins them), for code that must agree with the CSS:
// below md the sidebar gives way to the nav drawer; below lg the header
// switcher can show initials.
const BELOW_MD_QUERY = "(width < 48rem)"
export const BELOW_LG_QUERY = "(width < 64rem)"

/**
 * Whether a media query matches, kept up to date. Right from the first render
 * on the client; false on the server and while hydrating, then corrected.
 */
export function useMediaQuery(query: string): boolean {
  // Stable per query, so a re-render does not subscribe again.
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    [query]
  )
  const getSnapshot = React.useCallback(
    () => window.matchMedia(query).matches,
    [query]
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function getServerSnapshot(): boolean {
  return false
}

export function useIsMobile() {
  return useMediaQuery(BELOW_MD_QUERY)
}
