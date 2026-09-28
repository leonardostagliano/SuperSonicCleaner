import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import { AppWindow, Cpu, HardDrive, MemoryStick, Pin, PinOff, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NOTCH_MOTION_MS, type NotchState } from '@shared/desktop-notch'
import { BrandWordmark } from '../shared/BrandWordmark'
import { hoverExpands, notchHoverZone } from './notch-hover'
import './desktop-notch.css'

const known = (value: number | undefined): value is number =>
  value != null && Number.isFinite(value)
const clampPercent = (value: number) => Math.round(Math.max(0, Math.min(100, value)))
const percent = (value: number | undefined) => (known(value) ? `${clampPercent(value)}%` : '—')
/** Share of a meter to fill, 0…1; unknown values leave it empty. */
const fill = (value: number | undefined) =>
  ({
    '--notch-fill': known(value) ? Math.max(0, Math.min(100, value)) / 100 : 0
  }) as CSSProperties
const gigabytes = (value: number) =>
  (value / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })
/** `C:\` reads as `C:` next to the word for disk; other volumes stay as reported. */
const volumeName = (volume: string) => (/^[a-z]:\\?$/i.test(volume) ? volume.slice(0, 2) : volume)
const TICKS = Array.from({ length: 11 }, (_, index) => index * 10)

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
  const collapse = () => {
    clearCloseTimer()
    closeTimer.current = setTimeout(() => run(api?.setExpanded(false)), 450)
  }
  /** Decides on the element under the pointer, so the grip never opens the panel. */
  const hover = (event: PointerEvent<HTMLElement>) => {
    if (
      state &&
      hoverExpands({
        expanded: state.expanded,
        nativeCompact,
        dismissed: hoverDismissed.current,
        pressed: event.buttons !== 0,
        zone: notchHoverZone(event.target)
      })
    )
      expand()
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
  const disk = metrics?.disk
  const stale = !metrics || now - metrics.timestamp > 10000
  const status = error ? 'failed' : stale ? 'waiting' : 'live'
  const sampleTime = metrics
    ? new Date(metrics.timestamp).toLocaleTimeString(i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : '—'
  const cpu = { id: 'cpu', name: 'CPU', icon: Cpu, value: metrics?.cpu }
  const rows = [
    {
      id: 'memory',
      name: t('memory'),
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
      name: disk ? `${t('disk')} ${volumeName(disk.volume)}` : t('disk'),
      icon: HardDrive,
      value: disk?.percent,
      caption: disk ? t('diskDetail', { volume: disk.volume }) : t('unavailable'),
      detail: disk
        ? `${t('used', { used: gigabytes(disk.used), total: gigabytes(disk.total) })} · ${t(
            'free',
            { free: gigabytes(Math.max(0, disk.total - disk.used)) }
          )}`
        : t('unavailable')
    }
  ]
  const readouts = [cpu, ...rows]
  const grip = (layout: 'compact' | 'header') => (
    <button
      className={`notch-drag notch-drag--${layout}`}
      type="button"
      aria-label={t('move')}
      title={t('moveHint')}
      onKeyDown={move}
      onFocus={keepOpen}
    >
      <span className="notch-grip" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <i key={index} />
        ))}
      </span>
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
      onPointerEnter={() => {
        if (state.expanded) keepOpen()
      }}
      onPointerOver={hover}
      onPointerMove={hover}
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
          {grip('header')}
          <BrandWordmark size="compact" className="notch-brand" />
          <span className="notch-status" data-status={status} title={t(status)}>
            <i />
            <span>{t(`${status}Short`)}</span>
          </span>
          <span className="notch-tools">
            <button
              type="button"
              className="notch-icon"
              aria-label={t('open')}
              title={t('open')}
              onClick={() => run(api?.openApp())}
            >
              <AppWindow size={16} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="notch-icon"
              aria-label={t(state.pinned ? 'unpin' : 'pin')}
              title={t(state.pinned ? 'unpin' : 'pin')}
              aria-pressed={state.pinned}
              onClick={() => run(api?.setPinned(!state.pinned))}
            >
              {state.pinned ? (
                <PinOff size={16} strokeWidth={1.75} />
              ) : (
                <Pin size={16} strokeWidth={1.75} />
              )}
            </button>
            <button
              type="button"
              className="notch-icon"
              aria-label={t('hide')}
              title={t('hide')}
              onClick={() => run(api?.setVisible(false))}
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </span>
        </header>
        <div className="notch-hero" data-resource="cpu" data-tone={tone(cpu.value)}>
          <div className="notch-hero-label" title={t('cpuDetail')}>
            <Cpu size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>CPU · {t('cpuDetail')}</span>
          </div>
          <strong className="notch-hero-value">
            <PercentValue value={cpu.value} />
          </strong>
          <div className="notch-scale">
            <span className="notch-ticks" aria-hidden="true">
              {TICKS.map((tick) => (
                <i key={tick} />
              ))}
            </span>
            <Meter className="notch-scale-track" label={t('cpuDetail')} value={cpu.value} />
          </div>
          <div className="notch-scale-meta">
            <span>0</span>
            <span>
              {t('sample')}{' '}
              <time dateTime={metrics ? new Date(metrics.timestamp).toISOString() : undefined}>
                {sampleTime}
              </time>
            </span>
            <span>100</span>
          </div>
        </div>
        <div className="notch-rows">
          {rows.map(({ id, name, icon: Icon, value, caption, detail }) => (
            <article className="notch-row" data-resource={id} data-tone={tone(value)} key={id}>
              <div className="notch-row-top">
                <span className="notch-row-name" title={caption}>
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span>{name}</span>
                </span>
                <strong className="notch-row-value">
                  <PercentValue value={value} />
                </strong>
              </div>
              <small className="notch-row-detail" title={detail}>
                {detail}
              </small>
              <Meter className="notch-row-bar" label={caption} value={value} />
            </article>
          ))}
        </div>
        <footer className="notch-footer">
          <button type="button" className="notch-open" onClick={() => run(api?.openApp())}>
            {t('open')}
          </button>
        </footer>
      </div>
      <div
        className="notch-compact-content"
        aria-hidden={!!state.expanded}
        inert={!!state.expanded}
      >
        {grip('compact')}
        <button
          className="notch-compact-values"
          type="button"
          onFocus={expand}
          onClick={expand}
          aria-label={`${t('expand')}. ${readouts.map(({ name, value }) => `${name} ${percent(value)}`).join(', ')}`}
          aria-expanded={false}
        >
          {readouts.map(({ id, name, value, icon: Icon }) => (
            <span
              className="notch-compact-metric"
              data-tone={tone(value)}
              data-resource={id}
              key={id}
              title={`${name} · ${percent(value)}`}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              <b>
                <PercentValue value={value} />
              </b>
              <span className="notch-mini" aria-hidden="true">
                <i style={fill(value)} />
              </span>
            </span>
          ))}
        </button>
      </div>
    </section>
  )
}

/** Meters are neutral; above 90 % they turn red (spec 3.1). */
function tone(value: number | undefined): string {
  return !known(value) ? 'unknown' : value > 90 ? 'danger' : 'normal'
}

function Meter({
  className,
  label,
  value
}: {
  className: string
  label: string
  value: number | undefined
}) {
  return (
    <div
      className={`notch-meter ${className}`}
      role={known(value) ? 'meter' : undefined}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known(value) ? Math.round(value) : undefined}
    >
      <i style={fill(value)} />
    </div>
  )
}

function PercentValue({ value }: { value: number | undefined }) {
  if (!known(value)) return <>—</>
  return (
    <>
      {clampPercent(value)}
      <small>%</small>
    </>
  )
}
