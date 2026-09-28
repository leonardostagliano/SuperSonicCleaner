import React from 'react'
import ReactDOM from 'react-dom/client'
import { i18nReady } from './i18n'
import { RendererRoot } from './RendererRoot'
import './globals.css'
import './design-tokens.css'
import './pulse.css'
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
      // Use hardcoded colors — CSS variables may not be loaded when the
      // error boundary triggers, which would make the text invisible.
      return (
        <div
          style={{
            padding: 32,
            color: '#fafafa',
            fontFamily: 'system-ui',
            background: '#09090b',
            minHeight: '100vh'
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <pre style={{ color: '#a1a1aa', fontSize: 13, whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: '#27272a',
              color: '#fafafa',
              border: '1px solid #3f3f46',
              borderRadius: 6,
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
