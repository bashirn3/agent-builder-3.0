import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AuthenticateWithRedirectCallback } from '@clerk/react'
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react'
import { ArrowUp, Check, Eye, EyeOff } from '../ui/icons'
import { ease } from '../../lib/motion'
import { BrandLogo } from '../shell/Shell'
import { Collapse } from '../ui/overlay'
import { Spinner } from '../ui/controls'
import { go, href } from '../routes'
import { authError, useClerkFlow, type AuthFlow, type CodePurpose } from '../auth/flow'
import { clerkEnabled, previewSession } from '../auth/session'

type Mode = 'signin' | 'signup'
type Step = { kind: 'form' } | { kind: 'code'; purpose: CodePurpose } | { kind: 'forgot' } | { kind: 'reset' }

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

function PasswordField({ id, label, value, onChange, autoComplete, invalid, describedBy, action }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  invalid?: boolean
  describedBy?: string
  action?: ReactNode
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="k1-field">
      {action ? <div className="k1-field__head"><label htmlFor={id}>{label}</label>{action}</div> : <label htmlFor={id}>{label}</label>}
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

function StrengthRules({ id, password }: { id: string; password: string }) {
  const score = RULES.filter((rule) => rule.test(password)).length
  const meter = strength(score)
  return (
    <Collapse open={password.length > 0}>
      <div className="k1-strength" id={id}>
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
  )
}

function ClerkAuth({ mode }: { mode: Mode }) {
  const flow = useClerkFlow()
  return <AuthView mode={mode} flow={flow} />
}

export function AuthPage({ mode }: { mode: Mode }) {
  return clerkEnabled ? <ClerkAuth mode={mode} /> : <AuthView mode={mode} flow={null} />
}

export function SsoCallbackPage() {
  return (
    <div className="k1-auth">
      <span className="k1-auth__brand"><BrandLogo height={28} /></span>
      <div className="k1-auth__card">
        <section className="k1-auth__form-side">
          <div className="k1-auth__form k1-auth__pending" role="status">
            <Spinner />
            <p>Signing you in…</p>
            {clerkEnabled && <AuthenticateWithRedirectCallback signInForceRedirectUrl="/#/playground" signUpForceRedirectUrl="/#/playground" />}
          </div>
        </section>
        <section className="k1-auth__art" aria-hidden="true">
          <TypingComposer />
        </section>
      </div>
      <p className="k1-auth__copy">© 2026 Wasup · A-Katsastus</p>
    </div>
  )
}

function AuthView({ mode, flow }: { mode: Mode; flow: AuthFlow | null }) {
  const signup = mode === 'signup'
  const live = clerkEnabled
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<null | 'google' | 'submit' | 'resend'>(null)
  const [resent, setResent] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [serverError, setServerError] = useState('')
  const [deferred, setDeferred] = useState<null | 'google' | 'email'>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const ids = { email: useId(), password: useId(), confirm: useId(), code: useId(), rules: useId(), error: useId() }

  useEffect(() => {
    setStep({ kind: 'form' })
    setAttempted(false)
    setDeferred(null)
    setBusy(null)
    setServerError('')
    setPassword('')
    setConfirm('')
    setCode('')
  }, [mode])

  const moveTo = (next: Step) => {
    setStep(next)
    setAttempted(false)
    setServerError('')
    setResent(false)
    setCode('')
    if (next.kind === 'reset') { setPassword(''); setConfirm('') }
    window.setTimeout(() => headingRef.current?.focus(), 60)
  }

  const score = RULES.filter((rule) => rule.test(password)).length
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const codeValid = /^\d{6}$/.test(code)
  const newPassword = signup || step.kind === 'reset'
  const errors = (step.kind === 'code'
    ? [!codeValid && 'Enter the 6-digit code from the email.']
    : step.kind === 'forgot'
      ? [!emailValid && 'Enter a valid email address.']
      : step.kind === 'reset'
        ? [
            !codeValid && 'Enter the 6-digit code from the email.',
            !password && 'Enter a new password.',
            password && score < 5 && 'Choose a password that meets every rule below.',
            confirm !== password && 'Passwords do not match.',
          ]
        : [
            !emailValid && 'Enter a valid email address.',
            !password && 'Enter a password.',
            signup && password && score < 5 && 'Choose a password that meets every rule below.',
            signup && confirm !== password && 'Passwords do not match.',
          ]
  ).filter(Boolean) as string[]
  const shownError = attempted && errors.length ? errors[0] : serverError

  const run = async (kind: 'google' | 'submit' | 'resend', task: () => Promise<void>) => {
    setBusy(kind)
    setServerError('')
    try {
      await task()
    } catch (error) {
      setServerError(authError(error))
    } finally {
      setBusy(null)
    }
  }

  const google = () => {
    if (!flow) {
      if (!live) setDeferred('google')
      return
    }
    void run('google', () => flow.google(signup))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (errors.length) return
    if (!flow) {
      if (live) return
      setBusy('submit')
      window.setTimeout(() => {
        setBusy(null)
        setDeferred('email')
      }, 900)
      return
    }
    void run('submit', async () => {
      if (step.kind === 'form' && signup) {
        await flow.signUp(email, password)
        moveTo({ kind: 'code', purpose: 'signup' })
      } else if (step.kind === 'form') {
        const result = await flow.signIn(email, password)
        if (result === 'device') moveTo({ kind: 'code', purpose: 'device' })
        else go({ page: 'playground' })
      } else if (step.kind === 'code') {
        await flow.verify(step.purpose, code)
        go({ page: 'playground' })
      } else if (step.kind === 'forgot') {
        await flow.requestReset(email)
        moveTo({ kind: 'reset' })
      } else {
        await flow.reset(code, password)
        go({ page: 'playground' })
      }
    })
  }

  const resend = () => {
    if (!flow) return
    void run('resend', async () => {
      if (step.kind === 'reset') await flow.requestReset(email)
      else if (step.kind === 'code') await flow.resend(step.purpose)
      setResent(true)
    })
  }

  useEffect(() => {
    if (deferred) window.setTimeout(() => noticeRef.current?.focus(), 240)
  }, [deferred])

  const enterPreview = () => {
    previewSession.start()
    go({ page: 'playground' })
  }

  const heading = step.kind === 'code'
    ? 'Check your email'
    : step.kind === 'forgot'
      ? 'Reset your password'
      : step.kind === 'reset'
        ? 'Choose a new password'
        : signup ? "Let's get you started" : 'Welcome back'
  const lede = step.kind === 'code'
    ? step.purpose === 'signup'
      ? <>We sent a 6-digit code to <strong>{email}</strong>. Enter it to confirm your email.</>
      : <>To confirm it’s you on this device, we sent a 6-digit code to <strong>{email}</strong>.</>
    : step.kind === 'forgot'
      ? 'Enter your email and we’ll send you a code to reset your password.'
      : step.kind === 'reset'
        ? <>Enter the code we sent to <strong>{email}</strong> and choose a new password.</>
        : signup ? 'Securely create your account in seconds.' : 'Sign in to the K1 booking agent workspace.'
  const submitLabel = step.kind === 'code'
    ? step.purpose === 'signup' ? 'Verify email' : 'Verify'
    : step.kind === 'forgot'
      ? 'Send code'
      : step.kind === 'reset'
        ? 'Reset password'
        : signup ? 'Sign up' : 'Log in'
  const locked = busy !== null || (live && !flow)

  const codeField = (
    <div className="k1-field">
      <label htmlFor={ids.code}>Code</label>
      <input
        id={ids.code}
        className="k1-input k1-input--code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        placeholder="123456"
        aria-invalid={(attempted && !codeValid) || undefined}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </div>
  )

  const resendLine = (
    <p className="k1-auth__switch">
      Didn’t get it?{' '}
      {resent
        ? <span aria-live="polite">A new code is on its way.</span>
        : <button type="button" className="k1-auth__link" onClick={resend} disabled={locked}>{busy === 'resend' ? 'Sending…' : 'Send a new code'}</button>}
    </p>
  )

  return (
    <div className="k1-auth">
      <a className="k1-auth__brand" href={href({ page: signup ? 'signup' : 'signin' })}>
        <BrandLogo height={28} />
      </a>
      <div className="k1-auth__card">
        <section className="k1-auth__form-side">
          <form className="k1-auth__form" onSubmit={submit} noValidate aria-describedby={shownError ? ids.error : undefined}>
            <h1 ref={headingRef} tabIndex={-1}>{heading}</h1>
            <p className="k1-auth__lede">{lede}</p>

            {step.kind === 'form' && (
              <>
                <button type="button" className="k1-btn k1-btn--outline k1-btn--block" onClick={google} disabled={locked} aria-busy={busy === 'google'}>
                  {busy === 'google' ? <Spinner /> : <GoogleMark />}
                  {signup ? 'Sign up with Google' : 'Continue with Google'}
                </button>
                <div className="k1-or"><span>OR</span></div>
              </>
            )}

            {(step.kind === 'form' || step.kind === 'forgot') && (
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
            )}

            {(step.kind === 'code' || step.kind === 'reset') && codeField}

            {(step.kind === 'form' || step.kind === 'reset') && (
              <PasswordField
                id={ids.password}
                label={step.kind === 'reset' ? 'New password' : 'Password'}
                value={password}
                onChange={setPassword}
                autoComplete={newPassword ? 'new-password' : 'current-password'}
                invalid={attempted && (!password || (newPassword && score < 5))}
                describedBy={newPassword ? ids.rules : undefined}
                action={step.kind === 'form' && !signup && live
                  ? <button type="button" className="k1-auth__link k1-auth__forgot" onClick={() => moveTo({ kind: 'forgot' })}>Forgot password?</button>
                  : undefined}
              />
            )}

            {newPassword && (step.kind === 'form' || step.kind === 'reset') && <StrengthRules id={ids.rules} password={password} />}

            {newPassword && (step.kind === 'form' || step.kind === 'reset') && (
              <PasswordField
                id={ids.confirm}
                label={step.kind === 'reset' ? 'Confirm new password' : 'Confirm Password'}
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                invalid={attempted && confirm !== password}
              />
            )}

            <AnimatePresence initial={false}>
              {shownError && (
                <motion.p
                  key="error"
                  id={ids.error}
                  className="k1-auth__error"
                  role="alert"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease }}
                >
                  {shownError}
                </motion.p>
              )}
            </AnimatePresence>

            {!live && (
              <Collapse open={deferred !== null}>
                <div className="k1-auth__notice" ref={noticeRef} tabIndex={-1} role="status">
                  <strong>{deferred === 'google' ? 'Google sign-in is not connected yet.' : 'Accounts are not connected yet.'}</strong>
                  <p>Clerk integration is still pending, so {signup ? 'no account was created' : 'no one was signed in'} and nothing was sent. You can open the development preview instead — it shows sample Activity and Leads, not customer records.</p>
                  <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={enterPreview}>Open development preview</button>
                </div>
              </Collapse>
            )}

            <button type="submit" className="k1-btn k1-btn--primary k1-btn--block k1-auth__submit" disabled={locked} aria-busy={busy === 'submit'}>
              {busy === 'submit' && <Spinner />}
              {submitLabel}
            </button>

            {step.kind === 'form' && signup && <p className="k1-auth__terms">By continuing, you agree to our Terms of Service and Privacy Policy.</p>}
            {step.kind === 'form' && (
              <p className="k1-auth__switch">
                {signup ? 'Already have an account?' : "Don't have an account?"}{' '}
                <a href={href({ page: signup ? 'signin' : 'signup' })}>{signup ? 'Login' : 'Sign up'}</a>
              </p>
            )}
            {(step.kind === 'code' || step.kind === 'reset') && resendLine}
            {step.kind !== 'form' && (
              <p className="k1-auth__switch k1-auth__switch--tight">
                <button type="button" className="k1-auth__link" onClick={() => moveTo({ kind: 'form' })}>
                  {step.kind === 'code' && step.purpose === 'signup' ? 'Use a different email' : 'Back to login'}
                </button>
              </p>
            )}
          </form>
        </section>
        <section className="k1-auth__art" aria-hidden="true">
          <TypingComposer />
        </section>
      </div>
      <p className="k1-auth__copy">© 2026 Wasup · A-Katsastus</p>

    </div>
  )
}
