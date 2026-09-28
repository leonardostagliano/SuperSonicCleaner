import type { FirewallRule, FirewallRiskLevel } from '@shared/types'

const RISK_ORDER: Record<FirewallRiskLevel, number> = { high: 0, medium: 1, low: 2 }

/** A copy sorted from high to low risk, then by name; the store's array is never mutated. */
export function sortByRisk(rules: readonly FirewallRule[]): FirewallRule[] {
  return [...rules].sort(
    (a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.displayName.localeCompare(b.displayName)
  )
}

export interface FirewallSummary {
  total: number
  /** Rules with at least one finding: the number the page leads with. */
  flagged: number
  stale: number
  unsigned: number
  broad: number
}

export function firewallSummary(rules: readonly FirewallRule[]): FirewallSummary {
  return {
    total: rules.length,
    flagged: rules.filter((rule) => rule.issues.length > 0).length,
    stale: rules.filter((rule) => rule.issues.includes('stale')).length,
    unsigned: rules.filter((rule) => rule.issues.includes('unsigned')).length,
    broad: rules.filter((rule) => rule.issues.includes('broad-scope')).length
  }
}

/** A rule whose program no longer exists: safe to remove, so pre-selected and recommended. */
export function isRecommended(rule: FirewallRule): boolean {
  return rule.issues.includes('stale')
}

/** Only high risk is painted red; medium and low stay neutral. */
export function riskTone(risk: FirewallRiskLevel): 'danger' | 'neutral' {
  return risk === 'high' ? 'danger' : 'neutral'
}
