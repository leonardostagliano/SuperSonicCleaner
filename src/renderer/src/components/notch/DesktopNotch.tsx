import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from 'react'
import {
  AppWindow,
  Cpu,
  GripVertical,
  GripHorizontal,
  HardDrive,
  MemoryStick,
  Pin,
  PinOff,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NOTCH_MOTION_MS, type NotchState } from '@shared/desktop-notch'
import { BrandWordmark } from '../shared/BrandWordmark'
import './desktop-notch.css'

const percent = (value: number | undefined) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `${Math.round(Math.max(0, Math.min(100, value)))}%`
const gigabytes = (value: number) =>
  (value / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })

export function DesktopNotch() {
  const { t, i18n } = useTranslation('notch')
  const [state, setState] = useState<NotchState | null>(null)
  const [error, setError] = useState(false)
  const [now, setNow] = useState(Date.now)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const motionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialized = useRef(false)
  const expandedRef = useRef(false)
  const hoverDismissed = useRef(false)
  const [nativeCompact, setNativeCompact] = useState(true)
  const api = window.kuduNotch
  const expanded = state?.expanded
  const compactX = state?.compactOffset.x ?? 0
  const compactY = state?.compactOffset.y ?? 0
  const theme = state?.theme
  const language = state?.language

  useEffect(() => {
    document.documentElement.classList.add('desktop-notch-surface')
    let active = true
    let eventSeen = false
    const off = api?.onState((value) => {
      eventSeen = true
      expandedRef.current = value.expanded
      setState(value)
      setError(false)
    })
    void api
      ?.getState()
      .then((value) => {
        if (active && !eventSeen) {
          expandedRef.current = value.expanded
          setState(value)
        }
      })
      .catch(() => {
        if (active) setError(true)
      })
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => {
      active = false
      off?.()
      clearInterval(timer)
      if (closeTimer.current) clearTimeout(closeTimer.current)
      if (motionTimer.current) clearTimeout(motionTimer.current)
      document.documentElement.classList.remove('desktop-notch-surface')
    }
  }, [api])

  const finishCollapse = useCallback(async () => {
    if (expandedRef.current || nativeCompact) return
    try {
      await api?.finishCollapse()
      if (!expandedRef.current) setNativeCompact(true)
    } catch {
      setError(true)
    }
  }, [api, nativeCompact])

  useLayoutEffect(() => {
    if (expanded == null) return
    if (!initialized.current) {
      initialized.current = true
      setNativeCompact(!expanded)
      return
    }
    if (expanded && nativeCompact) setNativeCompact(false)
  }, [expanded, nativeCompact])

  useEffect(() => {
    if (motionTimer.current) clearTimeout(motionTimer.current)
    if (expanded == null || expanded || nativeCompact) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      void finishCollapse()
      return
    }
    motionTimer.current = setTimeout(() => void finishCollapse(), NOTCH_MOTION_MS + 140)
    return () => {
      if (motionTimer.current) clearTimeout(motionTimer.current)
      motionTimer.current = null
    }
  }, [expanded, nativeCompact, finishCollapse])

  useEffect(() => {
    if (!theme || !language) return
    document.documentElement.classList.toggle('light', theme === 'light')
    document.documentElement.classList.toggle('dark', theme === 'dark')
    if (i18n.language !== language) void i18n.changeLanguage(language)
  }, [theme, language, i18n])

  const run = (action: Promise<void> | undefined) => {
    void action?.then(
      () => setError(false),
      () => setError(true)
    )
  }
  const clearCloseTimer = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const keepOpen = () => {
    clearCloseTimer()
    if (state?.expanded) run(api?.setExpanded(true))
  }
  const expand = () => {
    hoverDismissed.current = false
    clearCloseTimer()
    run(api?.setExpanded(true))
  }
  const hoverExpand = () => {
    if (!hoverDismissed.current) expand()
  }
  const collapse = () => {
    clearCloseTimer()
    closeTimer.current = setTimeout(() => run(api?.setExpanded(false)), 450)
  }
  const enterSurface = (target: EventTarget) => {
    if (!state) return
    if (state.expanded) keepOpen()
    else if (nativeCompact && !(target as Element).closest('.notch-drag')) hoverExpand()
  }
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    }
    const direction = directions[event.key]
    if (!direction) return
    event.preventDefault()
    const step = event.shiftKey ? 40 : 10
    run(api?.move(direction[0] * step, direction[1] * step))
  }
  const metrics = state?.metrics
  const stale = !metrics || now - metrics.timestamp > 10000
  const sampleTime = metrics
    ? new Date(metrics.timestamp).toLocaleTimeString(i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : '—'
  const items = [
    {
      id: 'cpu',
      name: 'CPU',
      compactName: 'CPU',
      icon: Cpu,
      value: metrics?.cpu,
      caption: t('cpuDetail'),
      detail: ''
    },
    {
      id: 'memory',
      name: t('memory'),
      compactName: 'RAM',
      icon: MemoryStick,
      value: metrics?.memory.percent,
      caption: t('memoryDetail'),
      detail: metrics
        ? t('used', {
            used: gigabytes(metrics.memory.used),
            total: gigabytes(metrics.memory.total)
          })
        : t('waiting')
    },
    {
      id: 'disk',
      name: t('disk'),
      compactName: t('disk'),
      icon: HardDrive,
      value: metrics?.disk?.percent,
      caption: metrics?.disk ? t('diskDetail', { volume: metrics.disk.volume }) : t('unavailable'),
      detail: metrics?.disk
        ? t('used', { used: gigabytes(metrics.disk.used), total: gigabytes(metrics.disk.total) })
        : t('unavailable')
    }
  ]
  const handle = (
    <button
      className="notch-drag"
      type="button"
      aria-label={t('move')}
      title={t('moveHint')}
      onKeyDown={move}
      onFocus={keepOpen}
    >
      {state?.expanded ? (
        <GripVertical size={16} aria-hidden="true" />
      ) : (
        <GripHorizontal size={16} aria-hidden="true" />
      )}
    </button>
  )

  if (!state || !state.enabled) return null

  return (
    <section
      className={`desktop-notch ${state.expanded ? 'is-expanded' : ''}`}
      style={
        {
          '--compact-x': `${compactX}px`,
          '--compact-y': `${compactY}px`
        } as CSSProperties
      }
      aria-label={t('title')}
      onPointerEnter={(event) => enterSurface(event.target)}
      onPointerLeave={() => {
        hoverDismissed.current = false
        collapse()
      }}
      onFocus={keepOpen}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) collapse()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          hoverDismissed.current = true
          run(api?.setPinned(false))
          run(api?.setExpanded(false))
        }
      }}
    >
      {state && (
        <div
          className="notch-expanded-content"
          aria-hidden={!state.expanded}
          inert={!state.expanded}
          onTransitionEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              event.propertyName === 'transform' &&
              !state.expanded
            )
              void finishCollapse()
          }}
        >
          <header className="notch-header">
            {handle}
            <BrandWordmark size="compact" className="notch-brand" />
            <span
              className={`notch-status ${stale || error ? 'is-stale' : ''}`}
              title={t(error ? 'failed' : stale ? 'waiting' : 'live')}
            >
              <i />
              <span>{t(error ? 'failedShort' : stale ? 'waitingShort' : 'liveShort')}</span>
            </span>
            <button
              type="button"
              className="notch-icon"
              aria-label={t('open')}
              title={t('open')}
              onClick={() => run(api?.openApp())}
            >
              <AppWindow size={15} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="notch-icon"
              aria-label={t(state.pinned ? 'unpin' : 'pin')}
              title={t(state.pinned ? 'unpin' : 'pin')}
              aria-pressed={state.pinned}
              onClick={() => run(api?.setPinned(!state.pinned))}
            >
              {state.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
            <button
              type="button"
              className="notch-icon"
              aria-label={t('hide')}
              title={t('hide')}
              onClick={() => run(api?.setVisible(false))}
            >
              <X size={15} />
            </button>
          </header>
          <div className="notch-metrics">
            {items.map(({ id, name, icon: Icon, value, caption, detail }) => (
              <article
                className={`notch-metric ${id === 'cpu' ? 'notch-metric--hero' : ''}`}
                data-resource={id}
                data-tone={tone(value)}
                key={id}
              >
                <div className="notch-metric-heading">
                  <span className="notch-metric-icon">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <div className="notch-metric-title">
                    <span>{name}</span>
                    <small title={id === 'cpu' ? caption : detail}>
                      {id === 'cpu' ? caption : detail}
                    </small>
                  </div>
                  {id !== 'cpu' && (
                    <strong className="notch-value">
                      <PercentValue value={value} />
                    </strong>
                  )}
                </div>
                {id === 'cpu' && (
                  <div className="notch-reading">
                    <strong className="notch-value">
                      <PercentValue value={value} />
                    </strong>
                    <div className="notch-sample">
                      <span>{t('sample')}</span>
                      <time
                        dateTime={metrics ? new Date(metrics.timestamp).toISOString() : undefined}
                      >
                        {sampleTime}
                      </time>
                    </div>
                  </div>
                )}
                <div
                  className="notch-meter"
                  role={Number.isFinite(value) ? 'meter' : undefined}
                  aria-label={name}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    value == null || !Number.isFinite(value) ? undefined : Math.round(value)
                  }
                >
                  <i
                    style={{
                      transform: `scaleX(${Number.isFinite(value) ? Math.max(0, Math.min(100, value ?? 0)) / 100 : 0})`
                    }}
                  />
                </div>
                {id !== 'cpu' && (
                  <small className="notch-metric-caption" title={caption}>
                    {caption}
                  </small>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
      <div
        className="notch-compact-content"
        aria-hidden={!!state?.expanded}
        inert={!!state?.expanded}
      >
        {handle}
        <button
          className="notch-compact-values"
          type="button"
          onPointerEnter={hoverExpand}
          onFocus={expand}
          onClick={expand}
          aria-label={`${t('expand')}. ${items.map(({ name, value }) => `${name} ${percent(value)}`).join(', ')}`}
          aria-expanded={false}
        >
          {items.map(({ id, name, compactName, value, icon: Icon }) => (
            <span
              className="notch-compact-metric"
              data-tone={tone(value)}
              data-resource={id}
              key={id}
              title={`${name} · ${percent(value)}`}
            >
              <span className="notch-ring">
                <svg viewBox="0 0 40 40" aria-hidden="true">
                  <circle className="notch-ring-track" cx="20" cy="20" r="17" />
                  {value != null && Number.isFinite(value) && (
                    <circle
                      className="notch-ring-value"
                      cx="20"
                      cy="20"
                      r="17"
                      pathLength="100"
                      strokeDasharray="100"
                      strokeDashoffset={100 - Math.max(0, Math.min(100, value))}
                    />
                  )}
                </svg>
                <span className="notch-ring-icon">
                  <Icon size={15} aria-hidden="true" />
                </span>
              </span>
              <small>
                {compactName} <b>{percent(value)}</b>
              </small>
            </span>
          ))}
        </button>
      </div>
    </section>
  )
}

/** Meters are neutral; above 90 % they turn red (spec 3.1). */
function tone(value: number | undefined): string {
  return value == null || !Number.isFinite(value) ? 'unknown' : value > 90 ? 'danger' : 'normal'
}

function PercentValue({ value }: { value: number | undefined }) {
  if (value == null || !Number.isFinite(value)) return <>—</>
  return (
    <>
      {Math.round(Math.max(0, Math.min(100, value)))}
      <span>%</span>
    </>
  )
}
