import { lazy, Suspense } from 'react'
import { DesktopNotch } from './components/notch/DesktopNotch'

const App = lazy(() => import('./App').then((module) => ({ default: module.App })))

export function RendererRoot() {
  if (new URLSearchParams(window.location.search).has('desktop-notch')) return <DesktopNotch />
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  )
}
