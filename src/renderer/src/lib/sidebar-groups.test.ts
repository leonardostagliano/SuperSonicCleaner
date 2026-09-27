import { describe, it, expect } from 'vitest'
import { activeGroupFor, toggleGroup, withActiveGroup } from './sidebar-groups'

const items = [
  { path: '/cleaning', children: [{ path: '/cleaner' }, { path: '/registry' }] },
  { path: '/software', children: [{ path: '/updates' }, { path: '/drivers' }] },
  { path: '/' }
]

describe('sidebar groups', () => {
  it('finds the group that contains the route', () => {
    expect(activeGroupFor('/drivers', items)).toBe('/software')
    expect(activeGroupFor('/', items)).toBeNull()
  })

  it('treats settings, about and AI as the settings group', () => {
    expect(activeGroupFor('/about', items)).toBe('/settings')
    expect(activeGroupFor('/ai', items)).toBe('/settings')
  })

  it('adds the active group without closing the ones the user opened', () => {
    const open = new Set(['/cleaning'])
    const next = withActiveGroup(open, '/software')
    expect([...next].sort()).toEqual(['/cleaning', '/software'])
  })

  it('keeps the same set when nothing changes, so React skips the render', () => {
    const open = new Set(['/software'])
    expect(withActiveGroup(open, '/software')).toBe(open)
    expect(withActiveGroup(open, null)).toBe(open)
  })

  it('toggles a group', () => {
    const open = new Set(['/software'])
    expect([...toggleGroup(open, '/software')]).toEqual([])
    expect([...toggleGroup(open, '/cleaning')].sort()).toEqual(['/cleaning', '/software'])
  })
})
