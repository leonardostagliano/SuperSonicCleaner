import { useState, type ReactNode } from 'react'
import { Package } from 'lucide-react'

export function AppIcon({
  iconDataUrl,
  small = false,
  fallback
}: {
  iconDataUrl?: string
  small?: boolean
  fallback?: ReactNode
}) {
  const [failedSource, setFailedSource] = useState<string | undefined>()
  const source =
    iconDataUrl?.startsWith('data:image/png;base64,') && iconDataUrl.length <= 65_536
      ? iconDataUrl
      : undefined
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl ${small ? 'h-8 w-8' : 'h-10 w-10'}`}
      style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}
      aria-hidden="true"
    >
      {source && failedSource !== source ? (
        <img
          src={source}
          alt=""
          className={small ? 'h-6 w-6 object-contain' : 'h-8 w-8 object-contain'}
          onError={() => setFailedSource(source)}
          draggable={false}
        />
      ) : (
        fallback || <Package className="h-5 w-5" style={{ color: 'var(--text-muted)' }} />
      )}
    </div>
  )
}
