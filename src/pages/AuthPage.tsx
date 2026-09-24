import { FormEvent, KeyboardEvent, useState } from 'react'
import { ArrowUpIcon, ChatFabIcon, EyeIcon, EyeOffIcon, GoogleMark, LockIcon } from '../ui/icons'

type AuthMode = 'signup' | 'signin'

const RULES = [
  { id: 'len', label: '8 characters or more', test: (value: string) => value.length >= 8 },
  { id: 'lower', label: '1 lowercase letter', test: (value: string) => /[a-z]/.test(value) },
  { id: 'upper', label: '1 uppercase letter', test: (value: string) => /[A-Z]/.test(value) },
  { id: 'num', label: '1 number', test: (value: string) => /\d/.test(value) },
  { id: 'special', label: '1 special character', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
]

function strength(password: string) {
  const passed = RULES.filter((rule) => rule.test(password)).length
  if (!password) return { label: '', passed, tone: '' }
  if (passed < 4) return { label: 'Weak', passed, tone: 'is-weak' }
  return { label: 'Strong', passed, tone: 'is-strong' }
}

export function AuthPage({
  mode,
  onMode,
  onEnter,
}: {
  mode: AuthMode
  onMode: (mode: AuthMode) => void
  onEnter: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [chat, setChat] = useState('I want to book an inspection')
  const [bubbles, setBubbles] = useState([
    'Hi. I am the K1 preview assistant. Ask anything about this demo.',
    'This pane is decorative. It does not sign you in or book appointments.',
  ])
  const meter = strength(password)
  const confirmMatch = confirm.length > 0 && confirm === password
  const canSubmit = mode === 'signin'
    ? email.trim().length > 0 && password.length > 0
    : email.trim().length > 0 && meter.passed === RULES.length && confirmMatch

  const enter = () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    window.setTimeout(() => onEnter(), 420)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) {
      setNotice(mode === 'signup' ? 'Finish the password checks to continue this preview.' : 'Enter an email and password to continue this preview.')
      return
    }
    enter()
  }

  const sendDecor = () => {
    const text = chat.trim()
    if (!text) return
    setBubbles((prev) => [...prev.slice(-3), text])
    setChat('')
  }

  const onDecorKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      sendDecor()
    }
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <span className="auth-mark" aria-hidden="true">w</span>
        <strong>wasup</strong>
      </div>
      <div className="auth-split">
        <form className="auth-form" onSubmit={onSubmit}>
          <h1>{mode === 'signup' ? "Let's get you started" : 'Welcome back'}</h1>
          <p className="auth-lead">
            {mode === 'signup'
              ? 'Preview the K1 workspace. No account is created.'
              : 'Continue into the K1 demo workspace. No password is checked.'}
          </p>
          <button className="auth-method" type="button" onClick={enter} disabled={busy}>
            <GoogleMark />
            {mode === 'signup' ? 'Sign up with Google' : 'Login with Google'}
          </button>
          {mode === 'signin' && (
            <button className="auth-method" type="button" onClick={enter} disabled={busy}>
              <LockIcon />
              Sign in with SSO
            </button>
          )}
          <div className="auth-or"><span>OR</span></div>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            {mode === 'signin' && (
              <button className="auth-inline" type="button" onClick={() => setNotice('Password reset is not connected. Clerk is deferred.')}>
                Forgot password?
              </button>
            )}
            <div className="auth-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button type="button" className="icon-button" onClick={() => setShowPassword((open) => !open)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>
          {mode === 'signup' && password.length > 0 && (
            <div className={`auth-meter ${meter.tone}`}>
              <div className="auth-meter-head">
                <strong>{meter.label}</strong>
                <span aria-hidden="true">
                  {RULES.map((rule, index) => (
                    <i key={rule.id} className={index < meter.passed ? 'is-on' : ''} />
                  ))}
                </span>
              </div>
              <ul>
                {RULES.map((rule) => (
                  <li key={rule.id} className={rule.test(password) ? 'is-pass' : ''}>{rule.label}</li>
                ))}
              </ul>
            </div>
          )}
          {mode === 'signup' && (
            <label className="auth-field">
              <span>Confirm Password</span>
              <div className="auth-input-wrap">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
                <button type="button" className="icon-button" onClick={() => setShowConfirm((open) => !open)} aria-label={showConfirm ? 'Hide confirmation' : 'Show confirmation'}>
                  {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </label>
          )}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? 'Continuing…' : mode === 'signup' ? 'Sign up' : 'Continue'}
          </button>
          <p className="auth-legal">By continuing, you stay in this local preview. Terms and privacy pages are not connected.</p>
          <p className="auth-switch">
            {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}
            {' '}
            <button type="button" onClick={() => onMode(mode === 'signup' ? 'signin' : 'signup')}>
              {mode === 'signup' ? 'Log in' : 'Sign up'}
            </button>
          </p>
        </form>
        <aside className="auth-stage" aria-label="Decorative preview">
          <div className={`auth-composer${chat.trim() ? ' is-filled' : ''}`}>
            <input
              value={chat}
              onChange={(event) => setChat(event.target.value)}
              onKeyDown={onDecorKey}
              placeholder="Message…"
              aria-label="Decorative message"
            />
            <button type="button" className={chat.trim() ? 'is-ready' : ''} onClick={sendDecor} aria-label="Send decorative message">
              <ArrowUpIcon />
            </button>
          </div>
          <div className="auth-bubbles">
            {bubbles.map((text, index) => (
              <p key={`${text}-${index}`}>{text}</p>
            ))}
          </div>
          <span className="chat-fab" aria-hidden="true"><ChatFabIcon /></span>
        </aside>
      </div>
      <p className="auth-copy">© 2026 Wasup</p>
    </div>
  )
}
