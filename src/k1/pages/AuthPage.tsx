import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { FormEvent, useEffect, useId, useRef, useState } from 'react'
import { ArrowUp, Check, Eye, EyeOff, MessageSquareMore } from 'lucide-react'
import { ease } from '../../lib/motion'
import { K1Mark } from '../shell/Shell'
import { Collapse } from '../ui/overlay'
import { Spinner } from '../ui/controls'
import { go, href, previewSession } from '../routes'

type Mode = 'signin' | 'signup'

const RULES = [
  { key: 'length', label: '8 characters or more', test: (value: string) => value.length >= 8 },
  { key: 'upper', label: '1 uppercase letter', test: (value: string) => /[A-Z]/.test(value) },
  { key: 'lower', label: '1 lowercase letter', test: (value: string) => /[a-z]/.test(value) },
  { key: 'number', label: '1 number', test: (value: string) => /\d/.test(value) },
  { key: 'special', label: '1 special character', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
]

const TYPED = [
  'Can I book an inspection for ABC-123?',
  'Is K1 Espoo open on Saturday?',
  'What should I bring to the inspection?',
]

function strength(score: number) {
  if (score >= 5) return { label: 'Strong', tone: 'strong' }
  if (score >= 3) return { label: 'Fair', tone: 'fair' }
  return { label: 'Weak', tone: 'weak' }
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}

function PasswordField({ id, label, value, onChange, autoComplete, invalid, describedBy }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  invalid?: boolean
  describedBy?: string
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="k1-field">
      <label htmlFor={id}>{label}</label>
      <div className="k1-input-wrap">
        <input
          id={id}
          className="k1-input k1-input--password"
          type={shown ? 'text' : 'password'}
          value={value}
          placeholder="••••••••••"
          autoComplete={autoComplete}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" className="k1-input-wrap__action" aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={shown} onClick={() => setShown((next) => !next)}>
          {shown ? <Eye size={16} strokeWidth={1.75} /> : <EyeOff size={16} strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  )
}

function TypingComposer() {
  const reduced = useReducedMotion()
  const [phrase, setPhrase] = useState(0)
  const [count, setCount] = useState(reduced ? TYPED[0].length : 0)
  useEffect(() => {
    if (reduced) return
    const text = TYPED[phrase]
    const done = count >= text.length
    const timer = window.setTimeout(() => {
      if (done) {
        setPhrase((index) => (index + 1) % TYPED.length)
        setCount(0)
      } else {
        setCount((value) => value + 1)
      }
    }, done ? 2200 : 55 + Math.random() * 60)
    return () => window.clearTimeout(timer)
  }, [count, phrase, reduced])
  const text = TYPED[phrase].slice(0, count)
  return (
    <div className="k1-auth-composer" aria-hidden="true">
      <div className="k1-auth-composer__box">
        <span className="k1-auth-composer__text">{text}<span className="k1-caret" /></span>
        <span className="k1-auth-composer__send"><ArrowUp size={16} strokeWidth={2.25} /></span>
      </div>
    </div>
  )
}

export function AuthPage({ mode }: { mode: Mode }) {
  const signup = mode === 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [deferred, setDeferred] = useState<null | 'google' | 'email'>(null)
  const [greetingOpen, setGreetingOpen] = useState(true)
  const noticeRef = useRef<HTMLDivElement>(null)
  const ids = { email: useId(), password: useId(), confirm: useId(), rules: useId(), error: useId() }

  useEffect(() => {
    setAttempted(false)
    setDeferred(null)
    setSubmitting(false)
    setPassword('')
    setConfirm('')
  }, [mode])

  const score = RULES.filter((rule) => rule.test(password)).length
  const meter = strength(score)
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const errors = [
    !emailValid && 'Enter a valid email address.',
    !password && 'Enter a password.',
    signup && password && score < 5 && 'Choose a password that meets every rule below.',
    signup && confirm !== password && 'Passwords do not match.',
  ].filter(Boolean) as string[]

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (errors.length) return
    setSubmitting(true)
    window.setTimeout(() => {
      setSubmitting(false)
      setDeferred('email')
    }, 900)
  }

  useEffect(() => {
    if (deferred) window.setTimeout(() => noticeRef.current?.focus(), 240)
  }, [deferred])

  const enterPreview = () => {
    previewSession.start()
    go({ page: 'playground' })
  }

  return (
    <div className="k1-auth">
      <a className="k1-auth__brand" href={href({ page: signup ? 'signup' : 'signin' })}>
        <K1Mark size={22} />
        <span>K1 Katsastus</span>
      </a>
      <div className="k1-auth__card">
        <section className="k1-auth__form-side">
          <form className="k1-auth__form" onSubmit={submit} noValidate aria-describedby={attempted && errors.length ? ids.error : undefined}>
            <h1>{signup ? "Let's get you started" : 'Welcome back'}</h1>
            <p className="k1-auth__lede">{signup ? 'Securely create your account in seconds.' : 'Sign in to the K1 booking agent workspace.'}</p>

            <button type="button" className="k1-btn k1-btn--outline k1-btn--block" onClick={() => setDeferred('google')}>
              <GoogleMark />
              {signup ? 'Sign up with Google' : 'Continue with Google'}
            </button>
            <div className="k1-or"><span>OR</span></div>

            <div className="k1-field">
              <label htmlFor={ids.email}>Email</label>
              <input
                id={ids.email}
                className="k1-input"
                type="email"
                value={email}
                placeholder="name@example.com"
                autoComplete="email"
                aria-invalid={(attempted && !emailValid) || undefined}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <PasswordField
              id={ids.password}
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete={signup ? 'new-password' : 'current-password'}
              invalid={attempted && (!password || (signup && score < 5))}
              describedBy={signup ? ids.rules : undefined}
            />

            {signup && (
              <Collapse open={password.length > 0}>
                <div className="k1-strength" id={ids.rules}>
                  <div className="k1-strength__head">
                    <span className={`k1-strength__label is-${meter.tone}`} aria-live="polite">{meter.label}</span>
                    <span className="k1-strength__bars" aria-hidden="true">
                      {RULES.map((rule, index) => <span key={rule.key} className={index < score ? `is-${meter.tone}` : undefined} />)}
                    </span>
                  </div>
                  <ul className="k1-strength__rules">
                    {RULES.map((rule) => {
                      const met = rule.test(password)
                      return (
                        <li key={rule.key} className={met ? 'is-met' : undefined}>
                          <span className="k1-strength__dot" aria-hidden="true"><Check size={10} strokeWidth={3} /></span>
                          {rule.label}
                          <span className="k1-sr">{met ? ' — met' : ' — not met'}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </Collapse>
            )}

            {signup && (
              <PasswordField
                id={ids.confirm}
                label="Confirm Password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                invalid={attempted && confirm !== password}
              />
            )}

            <AnimatePresence initial={false}>
              {attempted && errors.length > 0 && (
                <motion.p
                  id={ids.error}
                  className="k1-auth__error"
                  role="alert"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease }}
                >
                  {errors[0]}
                </motion.p>
              )}
            </AnimatePresence>

            <Collapse open={deferred !== null}>
              <div className="k1-auth__notice" ref={noticeRef} tabIndex={-1} role="status">
                <strong>{deferred === 'google' ? 'Google sign-in is not connected yet.' : 'Accounts are not connected yet.'}</strong>
                <p>Clerk integration is still pending, so {signup ? 'no account was created' : 'no one was signed in'} and nothing was sent. You can open the development preview instead — it shows sample Activity and Leads, not customer records.</p>
                <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={enterPreview}>Open development preview</button>
              </div>
            </Collapse>

            <button type="submit" className="k1-btn k1-btn--primary k1-btn--block k1-auth__submit" disabled={submitting} aria-busy={submitting}>
              {submitting && <Spinner />}
              {signup ? 'Sign up' : 'Log in'}
            </button>

            {signup && <p className="k1-auth__terms">By continuing, you agree to our Terms of Service and Privacy Policy.</p>}
            <p className="k1-auth__switch">
              {signup ? 'Already have an account?' : "Don't have an account?"}{' '}
              <a href={href({ page: signup ? 'signin' : 'signup' })}>{signup ? 'Login' : 'Sign up'}</a>
            </p>
          </form>
        </section>
        <section className="k1-auth__art" aria-hidden="true">
          <TypingComposer />
        </section>
      </div>
      <p className="k1-auth__copy">© 2026 Wasup · K1 Katsastus</p>

      <div className="k1-auth__widget">
        <AnimatePresence>
          {greetingOpen && (
            <motion.div
              className="k1-auth__greetings"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease }}
            >
              <p>👋 Hi! I am the K1 booking assistant.</p>
              <p>I can help customers book a vehicle inspection.</p>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          type="button"
          className="k1-auth__fab"
          aria-label={greetingOpen ? 'Hide assistant greeting' : 'Show assistant greeting'}
          aria-expanded={greetingOpen}
          onClick={() => setGreetingOpen((open) => !open)}
        >
          <MessageSquareMore size={20} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
