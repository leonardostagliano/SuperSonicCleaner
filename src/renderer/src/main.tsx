import React from 'react'
import ReactDOM from 'react-dom/client'
import { i18nReady } from './i18n'
import { RendererRoot } from './RendererRoot'
import './globals.css'
import './design-tokens.css'
import './controls.css'
// After the tokens and the legacy sheets, so equal-specificity legacy rules never win.
import './components/ui/ui.css'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      // Tokens with system colours as the fallback: the text stays readable
      // even when the stylesheets are what failed to load.
      return (
        <div
          style={{
            padding: 32,
            color: 'var(--text-primary, CanvasText)',
            fontFamily: 'system-ui',
            background: 'var(--page-bg, Canvas)',
            minHeight: '100vh'
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <pre
            style={{ color: 'var(--text-muted, GrayText)', fontSize: 13, whiteSpace: 'pre-wrap' }}
          >
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: 'var(--surface, ButtonFace)',
              color: 'var(--text-primary, ButtonText)',
              border: '1px solid var(--border-strong, ButtonBorder)',
              borderRadius: 'var(--radius-control, 6px)',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

if (import.meta.env.DEV) {
  import('@axe-core/react').then((axe) => {
    axe.default(React, ReactDOM, 1000)
  })
}

// Render after the selected locale is available, avoiding untranslated keys
// while its local chunk is loading on a cold start.
void i18nReady.then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <RendererRoot />
      </ErrorBoundary>
    </React.StrictMode>
  )
})
