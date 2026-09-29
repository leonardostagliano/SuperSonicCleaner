import type { PackageManagerName, PackageManagerStatus } from '@shared/types'

/**
 * What the Software updates page says when a check found nothing to install:
 * 'upToDate' only when every included package manager answered; 'partial', naming the
 * managers that did answer, when another one failed or timed out (its note says which);
 * nothing while checking, with updates or ignored apps listed, or when no manager answered.
 */
export function noUpdatesState(params: {
  checked: boolean
  loading: boolean
  packageManagerAvailable: boolean
  pending: number
  ignored: number
  managers: Pick<PackageManagerStatus, 'name' | 'available' | 'error'>[]
}): { kind: 'upToDate' } | { kind: 'partial'; checked: PackageManagerName[] } | null {
  const { checked, loading, packageManagerAvailable, pending, ignored, managers } = params
  if (!checked || loading || !packageManagerAvailable || pending > 0 || ignored > 0) return null
  if (!managers.some((manager) => manager.error)) return { kind: 'upToDate' }
  const answered = managers.filter((manager) => manager.available && !manager.error)
  return answered.length > 0
    ? { kind: 'partial', checked: answered.map((manager) => manager.name) }
    : null
}
