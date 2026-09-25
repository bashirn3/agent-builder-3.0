import { Component, type ReactNode } from 'react'
import { copy } from '../i18n'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    const t = copy()
    return (
      <div className="k1-state k1-state--crash" role="alert">
        <h1 className="k1-page-title">{t.common.crashTitle}</h1>
        <p>{t.common.crashBody}</p>
        <button type="button" className="k1-btn k1-btn--primary" onClick={() => window.location.reload()}>{t.common.reload}</button>
      </div>
    )
  }
}
