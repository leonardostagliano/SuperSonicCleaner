interface GroupItem {
  path: string
  children?: Array<{ path: string }>
}

/** Group whose submenu holds `pathname`; settings, about and AI share the settings group. */
export function activeGroupFor(pathname: string, items: GroupItem[]): string | null {
  const parent = items.find((item) => item.children?.some((child) => child.path === pathname))
  if (parent) return parent.path
  return ['/settings', '/about', '/ai'].includes(pathname) ? '/settings' : null
}

/**
 * Open groups of the full-width sidebar: whatever the user opened, plus the
 * active page's group. Returns the same set when nothing changes.
 */
export function withActiveGroup(
  open: ReadonlySet<string>,
  group: string | null
): ReadonlySet<string> {
  if (!group || open.has(group)) return open
  return new Set([...open, group])
}

export function toggleGroup(open: ReadonlySet<string>, group: string): ReadonlySet<string> {
  const next = new Set(open)
  if (next.has(group)) next.delete(group)
  else next.add(group)
  return next
}
