import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import i18next from 'i18next'

export { formatBytes, formatSpeed, NO_VALUE } from './format'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(num: number): string {
  return num.toLocaleString()
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return i18next.t('common:justNow')
  if (minutes < 60) return i18next.t('common:minutesAgo', { minutes })
  if (hours < 24) return i18next.t('common:hoursAgo', { hours })
  if (days < 7) return i18next.t('common:daysAgo', { days })
  return d.toLocaleDateString()
}
