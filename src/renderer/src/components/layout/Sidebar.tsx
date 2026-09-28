import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { icons } from '@/lib/icons'
import { bottomNavItems, navGroups, type NavGroupItem, type NavLeaf } from '@/lib/navigation'
import { useAppUpdateStore } from '@/stores/app-update-store'
import { useUpdaterStore } from '@/stores/updater-store'
import { useDriverStore } from '@/stores/driver-store'
import { useGameModeStore } from '@/stores/game-mode-store'
import { usePlatform } from '@/hooks/usePlatform'
import { useSettingsStore } from '@/stores/settings-store'
import { activeGroupFor, toggleGroup, withActiveGroup } from '@/lib/sidebar-groups'
import { useCompactSidebar } from '@/hooks/useCompactSidebar'
import { prefetchRoute } from '@/routes'

type SubItemDef = NavLeaf & { badge?: boolean }

interface NavItemDef extends NavGroupItem {
  children?: SubItemDef[]
}

function useBottomNavItems(): NavItemDef[] {
  const updateState = useAppUpdateStore((s) => s.status.state)
  const showUpdateBadge = updateState === 'available' || updateState === 'downloaded'

  return bottomNavItems.map((item) => ({
    ...item,
    children: item.children?.map((child) =>
      child.path === '/about' ? { ...child, badge: showUpdateBadge } : child
    )
  }))
}

/** Pending updates are what the app recommends doing (amber); an active Game Mode is a state. */
const badgeTone = (path: string) =>
  path === '/game-mode' || path === '/performance' ? 'neutral' : 'recommended'

// Map nav paths to badge counts from stores
function useBadgeCounts(): Record<string, number> {
  const softwareUpdaterNotifications = useSettingsStore(
    (s) => s.settings.softwareUpdaterNotifications ?? true
  )
  const updaterApps = useUpdaterStore((s) => s.apps)
  const driverUpdates = useDriverStore((s) => s.updates)
  const gameModeActive = useGameModeStore((s) => s.active)

  const softwareUpdateCount = softwareUpdaterNotifications ? updaterApps.length : 0
  const updatesCount = softwareUpdateCount + driverUpdates.length

  return {
    '/updates': softwareUpdateCount,
    '/software': updatesCount,
    '/drivers': driverUpdates.length,
    '/game-mode': gameModeActive ? 1 : 0
  }
}

export function Sidebar() {
  const { t } = useTranslation('sidebar')
  const location = useLocation()
  const badgeCounts = useBadgeCounts()
  const { features } = usePlatform()
  const compact = useCompactSidebar()
  // Full width: any number of groups stay open. Compact: one flyout at a time.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [flyout, setFlyout] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const [fade, setFade] = useState('')

  // Filter nav items based on platform features.
  const filteredNavGroups = navGroups.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => {
        if (item.path === '/registry' && !features.registry) return false
        if (item.path === '/game-mode' && !features.gameMode) return false
        return true
      })
      .map((item) => {
        if (!item.children) return item
        const filtered = item.children.filter((child) => {
          if (child.path === '/game-mode' && !features.gameMode) return false
          if (child.path === '/registry' && !features.registry) return false
          if (child.path === '/debloater' && !features.debloater) return false
          if (child.path === '/drivers' && !features.drivers) return false
          if (child.path === '/context-menu' && !features.contextMenu) return false
          if (child.path === '/firewall' && !features.firewallAudit) return false
          return true
        })
        return { ...item, children: filtered }
      })
      .filter((item) => {
        if (item.children && item.children.length === 0) return false
        return true
      })
  }))

  // Route changes and leaving compact mode reopen the active group; nothing else closes
  useEffect(() => {
    if (compact) {
      setFlyout(null)
      return
    }
    const allItems = [...navGroups.flatMap((group) => group.items)]
    setExpanded((open) => withActiveGroup(open, activeGroupFor(location.pathname, allItems)))
  }, [location.pathname, compact])

  // Bring the current page into view once its group has expanded
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(
      () => {
        navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
      },
      reduced ? 0 : 200
    )
    return () => clearTimeout(timer)
  }, [location.pathname])

  // Fade the edges of the nav while there is more to scroll
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const update = () => {
      const top = nav.scrollTop > 2
      const bottom = nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2
      setFade([top && 'top', bottom && 'bottom'].filter(Boolean).join(' '))
    }
    update()
    nav.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(nav)
    for (const child of Array.from(nav.children)) observer.observe(child)
    return () => {
      nav.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  // Compute parent badge counts from visible children only
  const effectiveBadgeCounts = { ...badgeCounts }
  for (const group of filteredNavGroups) {
    for (const item of group.items) {
      if (item.children && item.children.length > 0) {
        effectiveBadgeCounts[item.path] = item.children.reduce(
          (sum, child) => sum + (badgeCounts[child.path] ?? 0),
          0
        )
      }
    }
  }

  const isPathActive = (item: NavItemDef) => {
    if (item.children) {
      return item.children.some((c) => c.path === location.pathname)
    }
    return location.pathname === item.path
  }

  const isOpen = (path: string) => (compact ? flyout === path : expanded.has(path))
  const submenuProps = {
    onToggleSubmenu: (path: string) => {
      if (compact) setFlyout((prev) => (prev === path ? null : path))
      else setExpanded((open) => toggleGroup(open, path))
    },
    onCloseSubmenu: () => setFlyout(null)
  }

  return (
    <div className="kudu-sidebar flex h-full w-[214px] shrink-0 flex-col">
      {/* Logo — doubles as drag region */}
      {/* Nav items */}
      <nav
        ref={navRef}
        data-fade={fade || undefined}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-4"
        aria-label={t('mainNavigation', 'Main navigation')}
      >
        {filteredNavGroups.map((group, gi) => (
          <div
            key={gi}
            className={gi > 0 ? 'mt-5' : ''}
            role={group.headingKey || group.heading ? 'group' : undefined}
            aria-labelledby={group.headingKey || group.heading ? `nav-group-${gi}` : undefined}
          >
            {(group.headingKey || group.heading) && (
              <div className="sidebar-group-heading mb-2 flex items-center gap-2.5 px-3 pt-0.5">
                <span id={`nav-group-${gi}`}>
                  {group.heading ?? (group.headingKey ? t(group.headingKey) : '')}
                </span>
                <div className="sidebar-group-rule h-px flex-1" />
              </div>
            )}
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavItem
                  key={item.path}
                  item={item}
                  badgeCount={effectiveBadgeCounts[item.path]}
                  badgeCounts={effectiveBadgeCounts}
                  isActive={isPathActive(item)}
                  submenuOpen={isOpen(item.path)}
                  {...submenuProps}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <BottomNav
        submenuProps={submenuProps}
        isOpen={isOpen}
        isPathActive={isPathActive}
        badgeCounts={effectiveBadgeCounts}
      />
    </div>
  )
}

function BottomNav({
  submenuProps,
  isOpen,
  isPathActive,
  badgeCounts
}: {
  submenuProps: {
    onToggleSubmenu: (path: string) => void
    onCloseSubmenu: () => void
  }
  isOpen: (path: string) => boolean
  isPathActive: (item: NavItemDef) => boolean
  badgeCounts: Record<string, number>
}) {
  const bottomNavItems = useBottomNavItems()

  return (
    <div className="sidebar-bottom px-3 pb-3 pt-2">
      {bottomNavItems.map((item) => (
        <NavItem
          key={item.path}
          item={item}
          badgeCount={badgeCounts[item.path]}
          badgeCounts={badgeCounts}
          isActive={isPathActive(item)}
          submenuOpen={isOpen(item.path)}
          {...submenuProps}
        />
      ))}
    </div>
  )
}

function NavItem({
  item,
  badge,
  badgeCount,
  badgeCounts,
  isActive: isActiveProp,
  submenuOpen,
  onToggleSubmenu,
  onCloseSubmenu
}: {
  item: NavItemDef
  badge?: boolean
  badgeCount?: number
  badgeCounts?: Record<string, number>
  isActive?: boolean
  submenuOpen?: boolean
  onToggleSubmenu?: (path: string) => void
  onCloseSubmenu?: () => void
}) {
  const { t } = useTranslation('sidebar')
  const location = useLocation()
  const navigate = useNavigate()
  const isActive = isActiveProp ?? location.pathname === item.path
  const hasChildren = item.children && item.children.length > 0
  const itemLabel = item.labelKey
    ? t(item.labelKey, { defaultValue: item.label ?? '' })
    : (item.label ?? '')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const isCompact = useCompactSidebar()
  const shownBadge = badge || (badgeCount != null && badgeCount > 0) ? (badgeCount ?? 1) : null
  // A labelled button is announced by its aria-label alone, and in compact mode the
  // badge is only a dot: the count has to be part of the button's own name.
  const accessibleName = shownBadge === null ? itemLabel : `${itemLabel} (${shownBadge})`

  const handleClick = () => {
    if (hasChildren) {
      onToggleSubmenu?.(item.path)
    } else {
      navigate(item.path)
    }
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        data-active={isActive}
        aria-label={accessibleName}
        title={isCompact ? accessibleName : undefined}
        onClick={handleClick}
        onPointerEnter={() => !hasChildren && prefetchRoute(item.path)}
        onFocus={() => !hasChildren && prefetchRoute(item.path)}
        aria-current={isActive && !hasChildren ? 'page' : undefined}
        aria-expanded={hasChildren ? !!submenuOpen : undefined}
        className="calm-nav-item relative flex w-full items-center gap-2.5 px-2.5 py-2"
      >
        <item.icon
          className="calm-nav-icon shrink-0"
          size={20}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span className="flex-1 text-start">{itemLabel}</span>
        {shownBadge !== null && (
          <span className="nav-badge" data-tone={badgeTone(item.path)} aria-hidden="true">
            {shownBadge}
          </span>
        )}
        {hasChildren && (
          <icons.next
            className="calm-nav-chevron shrink-0"
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        )}
      </button>

      {/* Inline submenu (full-width sidebar): always mounted so it can animate open and
          closed, inert while closed. The compact sidebar uses FlyoutMenu below instead. */}
      {hasChildren && !isCompact && (
        <div
          className="sidebar-submenu-collapse"
          data-open={submenuOpen ? 'true' : 'false'}
          inert={!submenuOpen}
        >
          <div className="sidebar-submenu" role="group" aria-label={`${itemLabel} tools`}>
            {item.children!.map((child) => {
              const isChildActive = location.pathname === child.path
              const childLabel = child.labelKey
                ? t(child.labelKey, { defaultValue: child.label ?? '' })
                : (child.label ?? '')
              return (
                <button
                  key={child.path}
                  type="button"
                  onClick={() => navigate(child.path)}
                  onPointerEnter={() => prefetchRoute(child.path)}
                  onFocus={() => prefetchRoute(child.path)}
                  aria-current={isChildActive ? 'page' : undefined}
                  title={childLabel}
                  className="sidebar-submenu-item"
                >
                  <child.icon aria-hidden="true" size={16} strokeWidth={1.75} />
                  <span>{childLabel}</span>
                  {(badgeCounts?.[child.path] ?? 0) > 0 && (
                    <b data-tone={badgeTone(child.path)}>{badgeCounts![child.path]}</b>
                  )}
                  {child.badge && <b data-tone="neutral">{t('updateBadge')}</b>}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {hasChildren && submenuOpen && isCompact && (
        <FlyoutMenu
          buttonRef={buttonRef}
          popoverRef={popoverRef}
          items={item.children!}
          badgeCounts={badgeCounts}
          onSelect={(path) => {
            navigate(path)
            onCloseSubmenu?.()
          }}
          onClose={() => {
            onCloseSubmenu?.()
            buttonRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

function FlyoutMenu({
  buttonRef,
  popoverRef,
  items,
  badgeCounts,
  onSelect,
  onClose
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>
  popoverRef: React.RefObject<HTMLDivElement | null>
  items: SubItemDef[]
  badgeCounts?: Record<string, number>
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation('sidebar')
  const location = useLocation()
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    // If near the bottom of the screen, open upward
    const spaceBelow = window.innerHeight - rect.top
    const menuHeight = items.length * 36 + 12 // approx
    const top = spaceBelow < menuHeight + 20 ? rect.bottom - menuHeight : rect.top
    setPos({ top, left: rect.right + 6 })
  }, [buttonRef, items.length])

  // Auto-focus first menu item on open
  useEffect(() => {
    const firstItem = popoverRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
    firstItem?.focus()
  }, [popoverRef])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const menuItems = popoverRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    if (!menuItems?.length) return
    const currentIndex = Array.from(menuItems).indexOf(document.activeElement as HTMLElement)

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        menuItems[(currentIndex + 1) % menuItems.length].focus()
        break
      case 'ArrowUp':
        e.preventDefault()
        menuItems[(currentIndex - 1 + menuItems.length) % menuItems.length].focus()
        break
      case 'Home':
        e.preventDefault()
        menuItems[0].focus()
        break
      case 'End':
        e.preventDefault()
        menuItems[menuItems.length - 1].focus()
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  return (
    <div
      ref={popoverRef}
      className="sidebar-flyout fixed z-[200]"
      style={{ top: pos.top, left: pos.left }}
      onKeyDown={handleKeyDown}
    >
      <div role="menu" className="sidebar-flyout-menu w-56 py-1.5">
        {items.map((child) => {
          const isChildActive = location.pathname === child.path
          const childLabel = child.labelKey
            ? t(child.labelKey, { defaultValue: child.label ?? '' })
            : (child.label ?? '')
          return (
            <button
              key={child.path}
              role="menuitem"
              onClick={() => onSelect(child.path)}
              onPointerEnter={() => prefetchRoute(child.path)}
              onFocus={() => prefetchRoute(child.path)}
              data-current={isChildActive || undefined}
              className="sidebar-flyout-item flex w-full items-center gap-2.5 px-3.5 py-2 text-start"
            >
              <child.icon className="shrink-0" size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className="flex-1">{childLabel}</span>
              {(badgeCounts?.[child.path] ?? 0) > 0 && (
                <span className="nav-badge" data-tone={badgeTone(child.path)}>
                  {badgeCounts![child.path]}
                </span>
              )}
              {child.badge && (
                <span className="nav-badge" data-tone="neutral">
                  {t('updateBadge')}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
