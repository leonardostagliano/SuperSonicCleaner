import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { bottomNavItems, crumbFor, navGroups, navLabel, navLeafFor } from './navigation'
import { icons } from './icons'
import { PAGE_ENTRIES } from '../routes'

describe('crumbFor', () => {
  it('names the sidebar group and the page for a child route', () => {
    const crumb = crumbFor('/cleaner')
    expect(crumb?.group.labelKey).toBe('cleaner')
    expect(crumb?.item.labelKey).toBe('cleaner:pageTitle')
  })

  it('finds pages whose group path is another page', () => {
    const crumb = crumbFor('/disk')
    expect(crumb?.group.labelKey).toBe('diskTools')
    expect(crumb?.item.labelKey).toBe('disk:pageTitle')
    expect(crumbFor('/drivers')?.group.path).toBe('/software')
  })

  it('covers the bottom group: preferences, AI analysis and about', () => {
    expect(crumbFor('/settings')?.group.labelKey).toBe('settings')
    expect(crumbFor('/ai')?.item.labelKey).toBe('ai:title')
    expect(crumbFor('/about')?.item.labelKey).toBe('settings:sectionAbout')
  })

  it('has no crumb for Home, top-level leaves or unknown routes', () => {
    expect(crumbFor('/')).toBeNull()
    expect(crumbFor('/software')).toBeNull()
    expect(crumbFor('/nowhere')).toBeNull()
    expect(crumbFor('')).toBeNull()
  })

  it('gives every routed page a crumb', () => {
    const missing = Object.keys(PAGE_ENTRIES).filter((path) => !crumbFor(path))
    expect(missing).toEqual([])
  })
})

describe('navigation data', () => {
  const leaves = [...navGroups.flatMap((g) => g.items), ...bottomNavItems].flatMap((item) => [
    item,
    ...(item.children ?? [])
  ])

  it('keeps the sidebar order', () => {
    expect(navGroups.map((g) => g.items.map((i) => i.path))).toEqual([
      ['/', '/cleaner', '/malware', '/performance'],
      ['/software', '/disk', '/history']
    ])
    expect(navGroups[1].headingKey).toBe('maintainHeading')
    expect(bottomNavItems.map((i) => i.path)).toEqual(['/settings'])
  })

  it('gives every entry a key, an English fallback and an icon', () => {
    for (const leaf of leaves) {
      expect(leaf.labelKey, leaf.path).toBeTruthy()
      expect(leaf.label, leaf.path).toBeTruthy()
      expect(leaf.icon, leaf.path).toBeTruthy()
    }
  })

  it('keeps the AI glyph for AI analysis alone', () => {
    const aiConcepts = Object.entries(icons).filter(([, icon]) => icon === icons.ai)
    expect(aiConcepts.map(([concept]) => concept)).toEqual(['ai'])
    expect(leaves.filter((leaf) => leaf.icon === icons.ai).map((leaf) => leaf.path)).toEqual([
      '/ai'
    ])
  })

  it('finds a leaf by path, top-level or nested', () => {
    expect(navLeafFor('/')?.labelKey).toBe('dashboard')
    expect(navLeafFor('/large-files')?.labelKey).toBe('largeFiles:pageTitle')
    expect(navLeafFor('/nowhere')).toBeNull()
  })
})

describe('navLabel', () => {
  const calls: unknown[][] = []
  const t = ((...args: unknown[]) => {
    calls.push(args)
    return 'translated'
  }) as unknown as TFunction

  it('translates in the sidebar namespace unless the key names its own', () => {
    calls.length = 0
    expect(navLabel(t, crumbFor('/cleaner')!.group)).toBe('translated')
    expect(calls[0]).toEqual(['cleaner', { ns: 'sidebar', defaultValue: 'Clean up' }])
  })

  it('honours an explicit namespace', () => {
    calls.length = 0
    navLabel(t, {
      path: '/x',
      labelKey: 'title',
      label: 'X',
      icon: navLeafFor('/')!.icon,
      ns: 'ai'
    })
    expect(calls[0]).toEqual(['title', { ns: 'ai', defaultValue: 'X' }])
  })
})
