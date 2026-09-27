import i18next from 'i18next'
import { toast } from 'sonner'
import { summaryMessage, type UpdateSummary } from '@/lib/update-summary'

/** One summary at a time: a new run's toast replaces the previous one. */
export const UPDATE_SUMMARY_TOAST_ID = 'software-update-summary'

const t = (key: string, options?: Record<string, unknown>): string =>
  i18next.t(key, { ns: 'updates', ...options })

/**
 * Tell the user how an update run went, naming the apps. The toast stays until
 * it is dismissed — an install can finish while the user is on another page or
 * away from the app — and shows on every page.
 */
export function showUpdateSummaryToast(summary: UpdateSummary): void {
  const message = summaryMessage(summary, t, i18next.language)
  if (!message) return
  const show =
    message.kind === 'success'
      ? toast.success
      : message.kind === 'warning'
        ? toast.warning
        : toast.error
  show(message.title, {
    id: UPDATE_SUMMARY_TOAST_ID,
    duration: Infinity,
    closeButton: true,
    description: message.lines.length ? (
      <div className="space-y-0.5">
        {message.lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    ) : undefined,
    // Some names were folded into "N more": the updates page lists them all
    ...(message.truncated
      ? {
          action: {
            label: t('softwareUpdater.showAll'),
            onClick: () => {
              window.location.hash = '#/updates'
            }
          }
        }
      : {})
  })
}
