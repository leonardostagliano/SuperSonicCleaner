import wordmark from '@/assets/supersonic-wordmark.svg'
import './brand-wordmark.css'

export function BrandWordmark({
  size = 'standard',
  className = ''
}: {
  size?: 'standard' | 'large' | 'compact'
  className?: string
}) {
  return (
    <span className={`brand-wordmark brand-wordmark--${size} ${className}`}>
      <img src={wordmark} alt="SuperSonicCleaner" draggable={false} />
      <span aria-hidden="true">cleaner</span>
    </span>
  )
}
