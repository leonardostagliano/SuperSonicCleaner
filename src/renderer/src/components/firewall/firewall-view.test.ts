import { describe, expect, it } from 'vitest'
import type { FirewallRule } from '@shared/types'
import { firewallSummary, isRecommended, riskTone, sortByRisk, summaryTone } from './firewall-view'

const rule = (over: Partial<FirewallRule>): FirewallRule => ({
  name: over.displayName ?? 'rule',
  displayName: 'rule',
  description: '',
  group: '',
  profiles: [],
  protocol: 'TCP',
  localPort: 'Any',
  remoteAddress: 'Any',
  program: '',
  programResolved: '',
  programExists: true,
  signature: 'signed',
  builtin: false,
  enabled: true,
  issues: [],
  risk: 'low',
  selected: false,
  ...over
})

describe('firewall-view', () => {
  it('sorts a copy by risk, then by name', () => {
    const input = [
      rule({ displayName: 'b', risk: 'low' }),
      rule({ displayName: 'z', risk: 'high' }),
      rule({ displayName: 'a', risk: 'low' }),
      rule({ displayName: 'm', risk: 'medium' })
    ]
    expect(sortByRisk(input).map((r) => r.displayName)).toEqual(['z', 'm', 'a', 'b'])
    expect(input[0].displayName).toBe('b')
  })

  it('counts findings and the rules to review', () => {
    const summary = firewallSummary([
      rule({ issues: ['stale'], risk: 'high' }),
      rule({ issues: ['unsigned', 'any-remote'], risk: 'medium' }),
      rule({ issues: ['broad-scope'], risk: 'high' }),
      rule({})
    ])
    expect(summary).toEqual({ total: 4, flagged: 3, stale: 1, unsigned: 1, broad: 1 })
  })

  it('recommends removing only rules whose program is missing', () => {
    expect(isRecommended(rule({ issues: ['stale'] }))).toBe(true)
    expect(isRecommended(rule({ issues: ['broad-scope'] }))).toBe(false)
  })

  it('shows a summary with no findings in green only when every rule was read', () => {
    const clean = firewallSummary([rule({})])
    const flagged = firewallSummary([rule({ issues: ['stale'] })])
    expect(summaryTone(clean, false)).toBe('ok')
    expect(summaryTone(clean, true)).toBe('neutral')
    expect(summaryTone(flagged, false)).toBe('flagged')
    expect(summaryTone(flagged, true)).toBe('flagged')
  })

  it('paints only high risk red', () => {
    expect(riskTone('high')).toBe('danger')
    expect(riskTone('medium')).toBe('neutral')
    expect(riskTone('low')).toBe('neutral')
  })
})
