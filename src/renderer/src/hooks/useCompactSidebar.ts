import { useEffect, useState } from 'react'

const COMPACT_QUERY = '(max-width: 980px)'

/** True while the sidebar is collapsed to icons (submenus open as flyouts). */
export function useCompactSidebar(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches)
  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY)
    const update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return compact
}
