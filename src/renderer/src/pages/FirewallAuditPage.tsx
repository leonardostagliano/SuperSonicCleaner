import { useState, useCallback, useEffect, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Receipt } from '@/components/shared/Receipt'
import {
  Button,
  Card,
  Checkbox,
  ProgressBar,
  Section,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tag
} from '@/components/ui'
import {
  firewallSummary,
  isRecommended,
  riskTone,
  sortByRisk
} from '@/components/firewall/firewall-view'
import { icons } from '@/lib/icons'
import { formatCount, formatDateTime } from '@/lib/protection-format'
import { useFirewallStore } from '@/stores/firewall-store'
import type {
  FirewallAction,
  FirewallIssue,
  FirewallProfile,
  FirewallRiskLevel,
  FirewallRule,
  FirewallScanProgress
} from '@shared/types'

const ISSUE_KEYS: Record<FirewallIssue, string> = {
  stale: 'issueStale',
  unsigned: 'issueUnsigned',
  'broad-scope': 'issueBroadScope',
  'any-remote': 'issueAnyRemote'
}

const RISK_KEYS: Record<FirewallRiskLevel, string> = {
  high: 'riskHigh',
  medium: 'riskMedium',
  low: 'riskLow'
}

const PROFILE_KEYS: Record<FirewallProfile, string> = {
  Domain: 'profileDomain',
  Private: 'profilePrivate',
  Public: 'profilePublic',
  Any: 'ruleAny'
}

const PHASE_KEYS: Record<FirewallScanProgress['phase'], string> = {
  enumerating: 'scanProgressEnumerating',
  classifying: 'scanProgressClassifying',
  verifying: 'scanProgressVerifying'
}

const store = useFirewallStore.getState

export function FirewallAuditPage() {
  const { t, i18n } = useTranslation('firewallAudit')
  const lang = i18n.language
  const rules = useFirewallStore((s) => s.rules)
  const scanning = useFirewallStore((s) => s.scanning)
  const applying = useFirewallStore((s) => s.applying)
  const scanProgress = useFirewallStore((s) => s.scanProgress)
  const applyResult = useFirewallStore((s) => s.applyResult)
  const error = useFirewallStore((s) => s.error)
  const hasScanned = useFirewallStore((s) => s.hasScanned)
  const truncated = useFirewallStore((s) => s.truncated)
  const searchQuery = useFirewallStore((s) => s.searchQuery)
  const riskFilter = useFirewallStore((s) => s.riskFilter)
  const programFilter = useFirewallStore((s) => s.programFilter)
  const showBuiltin = useFirewallStore((s) => s.showBuiltin)

  const [pendingAction, setPendingAction] = useState<FirewallAction | null>(null)
  const [lastApply, setLastApply] = useState<{ action: FirewallAction; at: string } | null>(null)
  const isBusy = scanning || applying
  const searchId = useId()

  const handleScan = useCallback(async () => {
    const s = store()
    s.setScanning(true)
    s.setRules([])
    s.setApplyResult(null)
    s.setError(null)
    s.setScanProgress(null)
    s.setTruncated(false)
    setLastApply(null)

    try {
      const result = await window.kudu.firewallScan()
      store().setRules(result.rules)
      // Rules whose program no longer exists are safe to remove: pre-select them.
      store().selectRecommended()
      store().setTruncated(!!result.truncated)
      store().setHasScanned(true)
    } catch (err) {
      toast.error(t('toastScanFailed'))
      store().setError(err instanceof Error ? err.message : t('toastScanFailed'))
    } finally {
      store().setScanning(false)
      store().setScanProgress(null)
    }
  }, [t])

  // Auto-scan on first visit (the scan only reads the rules)
  useEffect(() => {
    if (!hasScanned && !scanning) void handleScan()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleApply = useCallback(
    async (action: FirewallAction) => {
      setPendingAction(null)
      const selected = store().rules.filter((r) => r.selected)
      if (selected.length === 0) return

      store().setApplying(true)
      store().setApplyResult(null)
      store().setError(null)

      try {
        const result = await window.kudu.firewallApply(
          selected.map((r) => ({ name: r.name, action }))
        )
        store().setApplyResult(result)
        setLastApply({ action, at: new Date().toISOString() })
        if (result.succeeded > 0)
          toast.success(
            t(action === 'delete' ? 'rulesDeleted' : 'rulesDisabled', { count: result.succeeded })
          )
        if (result.failed > 0) toast.error(t('rulesFailed', { count: result.failed }))

        // The scan only enumerates enabled rules, so both delete and disable
        // mean the rule should disappear from the list. Prune locally instead
        // of re-scanning — the full re-scan takes 30-90s on a typical system.
        const failedNames = new Set(result.errors.map((e) => e.name).filter(Boolean))
        const requestedNames = new Set(selected.map((r) => r.name))
        store().setRules(
          store().rules.filter((r) => !requestedNames.has(r.name) || failedNames.has(r.name))
        )
      } catch (err) {
        toast.error(t('toastApplyFailed'))
        store().setError(err instanceof Error ? err.message : t('toastApplyFailed'))
      } finally {
        store().setApplying(false)
      }
    },
    [t]
  )

  const filteredRules = useMemo(() => {
    let result = rules

    // Built-in / Microsoft / AppX rules are hidden by default. Stale built-ins
    // are still surfaced because a leftover rule pointing at a removed Windows
    // feature is genuinely worth cleaning up — toggle handles only the noise.
    if (!showBuiltin) result = result.filter((r) => !r.builtin || r.issues.includes('stale'))

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.displayName.toLowerCase().includes(q) ||
          r.group.toLowerCase().includes(q) ||
          r.programResolved.toLowerCase().includes(q)
      )
    }
    if (riskFilter !== 'all') result = result.filter((r) => r.risk === riskFilter)
    if (programFilter === 'with-program') result = result.filter((r) => !!r.programResolved)
    else if (programFilter === 'no-program') result = result.filter((r) => !r.programResolved)
    else if (programFilter === 'stale') result = result.filter((r) => r.issues.includes('stale'))

    return sortByRisk(result)
  }, [rules, searchQuery, riskFilter, programFilter, showBuiltin])

  const builtinCount = useMemo(
    () => rules.filter((r) => r.builtin && !r.issues.includes('stale')).length,
    [rules]
  )

  const summary = firewallSummary(rules)
  const selectedRules = rules.filter((r) => r.selected)
  const selectedCount = selectedRules.length
  const SelectStaleIcon = icons.selectStale
  const WarningIcon = icons.warning

  return (
    <div>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <Button
            variant={hasScanned && rules.length > 0 ? 'ghost' : 'primary'}
            size="lg"
            busy={scanning}
            disabled={applying}
            onClick={() => void handleScan()}
          >
            {scanning ? t('scanningButton') : hasScanned ? t('rescanButton') : t('scanButton')}
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        {error && (
          <Card role="alert" className="flex items-start gap-3">
            <WarningIcon
              size={16}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0 text-[var(--signal-danger)]"
              aria-hidden="true"
            />
            <p className="m-0 min-w-0 flex-1 text-[length:var(--text-13)] break-words text-[var(--signal-danger-text)]">
              {error}
            </p>
            <Button
              variant="ghost"
              icon={X}
              aria-label={t('errorDismiss')}
              onClick={() => store().setError(null)}
            />
          </Card>
        )}

        {scanning && (
          <Section
            title={t('scanProgressTitle')}
            meta={
              scanProgress && scanProgress.total > 0
                ? t('scanProgressCount', {
                    current: formatCount(scanProgress.current, lang),
                    total: formatCount(scanProgress.total, lang)
                  })
                : undefined
            }
          >
            <p className="mb-2 text-[length:var(--text-13)] text-[var(--text-secondary)]">
              {t(PHASE_KEYS[scanProgress?.phase ?? 'enumerating'])}
            </p>
            <ProgressBar
              value={
                scanProgress && scanProgress.total > 0
                  ? scanProgress.current / scanProgress.total
                  : undefined
              }
              label={t('scanProgressLabel')}
            />
            {scanProgress?.currentRule && (
              <p className="mt-2 truncate text-[length:var(--text-12)] text-[var(--text-muted)]">
                {scanProgress.currentRule}
              </p>
            )}
          </Section>
        )}

        {/* A partial rule set is still worth acting on, but it must not read as a
            complete audit — rules Windows never returned aren't "clean". */}
        {truncated && !scanning && (
          <Card className="flex items-start gap-3">
            <WarningIcon
              size={16}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <p className="m-0 text-[length:var(--text-13)] text-[var(--text-secondary)]">
              {t('scanTruncatedNotice')}
            </p>
          </Card>
        )}

        {applyResult && lastApply && (
          <>
            <Receipt
              title={
                lastApply.action === 'delete' ? t('receiptDeletedTitle') : t('receiptDisabledTitle')
              }
              value={
                lastApply.action === 'delete'
                  ? t('rulesDeleted', { count: applyResult.succeeded })
                  : t('rulesDisabled', { count: applyResult.succeeded })
              }
              facts={[
                formatDateTime(lastApply.at, lang),
                lastApply.action === 'delete'
                  ? t('receiptDeleteIrreversible')
                  : t('receiptDisableReversible')
              ]}
              skipped={
                applyResult.failed > 0
                  ? t('receiptFailed', { count: applyResult.failed })
                  : undefined
              }
            />
            {applyResult.errors.length > 0 && (
              <Section title={t('failedHeading')}>
                <Table>
                  <TableHead>
                    <TableHeaderCell>{t('failedColumnRule')}</TableHeaderCell>
                    <TableHeaderCell>{t('failedColumnReason')}</TableHeaderCell>
                  </TableHead>
                  <tbody>
                    {applyResult.errors.map((e, i) => (
                      <TableRow key={`${e.name}-${i}`}>
                        <TableCell>{e.displayName || e.name}</TableCell>
                        <TableCell muted>{e.reason}</TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </Section>
            )}
          </>
        )}

        {!hasScanned && !scanning && (
          <EmptyState
            title={t('emptyStateNoScanTitle')}
            description={t('emptyStateNoScanDesc')}
            checks={[
              { title: t('checkStaleTitle'), detail: t('checkStaleDetail') },
              { title: t('checkUnsignedTitle'), detail: t('checkUnsignedDetail') },
              { title: t('checkScopeTitle'), detail: t('checkScopeDetail') }
            ]}
          />
        )}

        {hasScanned && !scanning && (
          <Card as="section" className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="min-w-0 flex-[1_1_320px]">
              <h2
                className={
                  summary.flagged > 0
                    ? 'm-0 font-[family-name:var(--font-display)] text-[length:var(--text-20)] leading-[1.25] font-semibold tracking-[-0.01em] tabular-nums'
                    : 'm-0 font-[family-name:var(--font-display)] text-[length:var(--text-15)] leading-[1.3] font-semibold text-[var(--signal-ok-text)]'
                }
              >
                {summary.flagged > 0
                  ? t('summaryTitle', { count: summary.flagged })
                  : t('summaryNone')}
              </h2>
              <p className="mt-1 text-[length:var(--text-13)] text-[var(--text-secondary)] tabular-nums">
                {t('summaryFacts', {
                  total: formatCount(summary.total, lang),
                  stale: formatCount(summary.stale, lang),
                  unsigned: formatCount(summary.unsigned, lang),
                  broad: formatCount(summary.broad, lang)
                })}
              </p>
            </div>
            {rules.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  icon={SelectStaleIcon}
                  disabled={isBusy || summary.stale === 0}
                  onClick={() => store().selectRecommended()}
                >
                  {t('selectStale', { count: summary.stale })}
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  busy={applying}
                  disabled={isBusy || selectedCount === 0}
                  onClick={() => setPendingAction('disable')}
                >
                  {selectedCount > 0
                    ? t('disableSelected', { count: selectedCount })
                    : t('disableNone')}
                </Button>
                <Button
                  size="lg"
                  disabled={isBusy || selectedCount === 0}
                  onClick={() => setPendingAction('delete')}
                >
                  {selectedCount > 0
                    ? t('deleteSelected', { count: selectedCount })
                    : t('deleteNone')}
                </Button>
              </div>
            )}
          </Card>
        )}

        {hasScanned && rules.length > 0 && (
          <Section
            title={t('rulesHeading')}
            meta={t('rulesMeta', {
              shown: formatCount(filteredRules.length, lang),
              total: formatCount(rules.length, lang)
            })}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label htmlFor={searchId} className="sr-only">
                {t('searchLabel')}
              </label>
              <input
                id={searchId}
                type="search"
                value={searchQuery}
                onChange={(e) => store().setSearchQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="h-9 min-w-[220px] flex-1 rounded-[var(--radius-control)] border border-[var(--border-medium)] px-3 text-[length:var(--text-13)] text-[var(--text-primary)] outline-none"
              />
              <select
                aria-label={t('riskFilterLabel')}
                value={riskFilter}
                onChange={(e) => store().setRiskFilter(e.target.value as 'all' | FirewallRiskLevel)}
                className="h-9 rounded-[var(--radius-control)] border border-[var(--border-medium)] px-2 text-[length:var(--text-13)] text-[var(--text-primary)]"
              >
                <option value="all">{t('filterAllRisks')}</option>
                <option value="high">{t('filterHighRisk')}</option>
                <option value="medium">{t('filterMediumRisk')}</option>
                <option value="low">{t('filterLowRisk')}</option>
              </select>
              <select
                aria-label={t('programFilterLabel')}
                value={programFilter}
                onChange={(e) =>
                  store().setProgramFilter(
                    e.target.value as 'all' | 'with-program' | 'no-program' | 'stale'
                  )
                }
                className="h-9 rounded-[var(--radius-control)] border border-[var(--border-medium)] px-2 text-[length:var(--text-13)] text-[var(--text-primary)]"
              >
                <option value="all">{t('filterAllRules')}</option>
                <option value="with-program">{t('filterWithProgram')}</option>
                <option value="no-program">{t('filterNoProgram')}</option>
                <option value="stale">{t('filterStaleOnly')}</option>
              </select>
              {builtinCount > 0 && (
                <label
                  className="flex cursor-pointer items-center gap-2 text-[length:var(--text-13)] text-[var(--text-secondary)]"
                  title={t('builtinTooltip', { count: builtinCount })}
                >
                  <Checkbox
                    checked={showBuiltin}
                    onChange={(value) => store().setShowBuiltin(value)}
                    label={t('showBuiltin', { count: builtinCount })}
                  />
                  {t('showBuiltin', { count: builtinCount })}
                </label>
              )}
            </div>

            {filteredRules.length === 0 ? (
              <div className="py-2">
                <p className="m-0 text-[length:var(--text-13)] font-semibold">
                  {t('emptyStateNoMatchTitle')}
                </p>
                <p className="m-0 text-[length:var(--text-13)] text-[var(--text-secondary)]">
                  {t('emptyStateNoMatchDesc')}
                </p>
              </div>
            ) : (
              <Table>
                <TableHead>
                  <TableHeaderCell className="w-8">
                    <span className="sr-only">{t('columnRule')}</span>
                  </TableHeaderCell>
                  <TableHeaderCell>{t('columnRule')}</TableHeaderCell>
                  <TableHeaderCell>{t('columnRisk')}</TableHeaderCell>
                  <TableHeaderCell>{t('columnAccess')}</TableHeaderCell>
                </TableHead>
                <tbody>
                  {filteredRules.map((rule) => (
                    <RuleRow key={rule.name} rule={rule} disabled={isBusy} />
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
        )}
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        onConfirm={() => pendingAction && void handleApply(pendingAction)}
        onCancel={() => setPendingAction(null)}
        title={
          pendingAction === 'delete'
            ? t('confirmDeleteTitle', { count: selectedCount })
            : t('confirmDisableTitle', { count: selectedCount })
        }
        description={pendingAction === 'delete' ? t('confirmDeleteDesc') : t('confirmDisableDesc')}
        details={selectedRules.map((r) => r.displayName || r.name).join('\n')}
        variant={pendingAction === 'delete' ? 'danger' : 'default'}
        confirmLabel={
          pendingAction === 'delete'
            ? t('confirmDeleteLabel', { count: selectedCount })
            : t('confirmDisableLabel', { count: selectedCount })
        }
      />
    </div>
  )
}

function RuleRow({ rule, disabled }: { rule: FirewallRule; disabled: boolean }) {
  const { t } = useTranslation('firewallAudit')
  const recommended = isRecommended(rule)
  // Windows reports unrestricted fields as the English word Any.
  const any = (value: string) => (value === 'Any' ? t('ruleAny') : value)
  const profiles = rule.profiles.length
    ? rule.profiles.map((profile) => t(PROFILE_KEYS[profile] ?? profile)).join(', ')
    : t('ruleAny')
  const access = [
    rule.localPort !== 'Any'
      ? `${any(rule.protocol)} · ${t('rulePort', { port: rule.localPort })}`
      : any(rule.protocol),
    `${t('ruleRemote')} ${any(rule.remoteAddress)} · ${t('ruleProfiles')} ${profiles}`
  ]
  return (
    <TableRow recommended={recommended} selected={rule.selected}>
      <TableCell className="align-top">
        <Checkbox
          checked={rule.selected}
          disabled={disabled}
          onChange={() => store().toggleRule(rule.name)}
          label={t('selectRule', { name: rule.displayName })}
        />
      </TableCell>
      <TableCell className="w-full max-w-0 align-top">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium">{rule.displayName}</span>
          {rule.group && (
            <span className="truncate text-[length:var(--text-12)] text-[var(--text-muted)]">
              {rule.group}
            </span>
          )}
          {recommended && <Tag tone="recommended">{t('recommendedTag')}</Tag>}
        </div>
        {rule.programResolved && (
          <div
            className="truncate font-mono text-[length:var(--text-12)] text-[var(--text-muted)]"
            title={rule.programResolved}
          >
            {rule.programResolved}
          </div>
        )}
        {rule.issues.length > 0 && (
          <div className="text-[length:var(--text-12)] text-[var(--text-secondary)]">
            {rule.issues.map((issue) => t(ISSUE_KEYS[issue] ?? issue)).join(' · ')}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top">
        <Tag tone={riskTone(rule.risk)}>{t(RISK_KEYS[rule.risk])}</Tag>
      </TableCell>
      <TableCell muted className="align-top text-[length:var(--text-12)]">
        {access.map((line) => (
          <div key={line} className="whitespace-nowrap">
            {line}
          </div>
        ))}
      </TableCell>
    </TableRow>
  )
}
