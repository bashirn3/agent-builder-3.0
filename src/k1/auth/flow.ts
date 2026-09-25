import { isClerkAPIResponseError } from '@clerk/react/errors'
import { useSignIn, useSignUp } from '@clerk/react/legacy'
import { useMemo, useRef } from 'react'
import { copy } from '../i18n'

type SignInAttempt = NonNullable<ReturnType<typeof useSignIn>['signIn']>
type SignUpAttempt = NonNullable<ReturnType<typeof useSignUp>['signUp']>

export type CodePurpose = 'signup' | 'device'

export type AuthFlow = {
  google: (signup: boolean) => Promise<void>
  signIn: (email: string, password: string) => Promise<'done' | 'device'>
  signUp: (email: string, password: string) => Promise<void>
  verify: (purpose: CodePurpose, code: string) => Promise<void>
  resend: (purpose: CodePurpose) => Promise<void>
  requestReset: (email: string) => Promise<void>
  reset: (code: string, password: string) => Promise<void>
}


export function authError(error: unknown) {
  if (isClerkAPIResponseError(error)) {
    const first = error.errors[0]
    if (first) return copy().auth.clerk[first.code] ?? first.longMessage ?? first.message
  }
  if (error instanceof Error && error.message) return error.message
  return copy().auth.generic
}

const callbackUrl = () => `${window.location.origin}/#/sso-callback`
const homeUrl = () => `${window.location.origin}/#/playground`

export function useClerkFlow(): AuthFlow | null {
  const signInState = useSignIn()
  const signUpState = useSignUp()
  const attempt = useRef<SignInAttempt | null>(null)
  const registration = useRef<SignUpAttempt | null>(null)

  return useMemo(() => {
    if (!signInState.isLoaded || !signUpState.isLoaded) return null
    const { signIn, setActive } = signInState
    const { signUp } = signUpState

    const activate = async (sessionId: string | null) => {
      if (!sessionId) throw new Error(copy().auth.notFinished)
      await setActive({ session: sessionId })
    }

    const emailFactorId = (current: SignInAttempt) => {
      const factor = current.supportedSecondFactors?.find((item) => item.strategy === 'email_code')
      return factor && 'emailAddressId' in factor ? factor.emailAddressId : undefined
    }

    const sendDeviceCode = async (current: SignInAttempt) => {
      const emailAddressId = emailFactorId(current)
      if (!emailAddressId) throw new Error(copy().auth.unsupportedStep)
      attempt.current = await current.prepareSecondFactor({ strategy: 'email_code', emailAddressId })
    }

    return {
      google: async (signup) => {
        const params = { strategy: 'oauth_google' as const, redirectUrl: callbackUrl(), redirectUrlComplete: homeUrl() }
        if (signup) await signUp.authenticateWithRedirect(params)
        else await signIn.authenticateWithRedirect(params)
      },
      signIn: async (email, password) => {
        const result = await signIn.create({ identifier: email, password })
        attempt.current = result
        if (result.status === 'complete') {
          await activate(result.createdSessionId)
          return 'done'
        }
        if (result.status === 'needs_second_factor' || result.status === 'needs_client_trust') {
          await sendDeviceCode(result)
          return 'device'
        }
        throw new Error(copy().auth.unsupportedStep)
      },
      signUp: async (email, password) => {
        const created = await signUp.create({ emailAddress: email, password })
        registration.current = await created.prepareEmailAddressVerification({ strategy: 'email_code' })
      },
      verify: async (purpose, code) => {
        if (purpose === 'signup') {
          const current = registration.current ?? signUp
          const result = await current.attemptEmailAddressVerification({ code })
          registration.current = result
          if (result.status !== 'complete') throw new Error(copy().auth.needsDetails)
          await activate(result.createdSessionId)
          return
        }
        const current = attempt.current ?? signIn
        const result = await current.attemptSecondFactor({ strategy: 'email_code', code })
        attempt.current = result
        if (result.status !== 'complete') throw new Error(copy().auth.notFinished)
        await activate(result.createdSessionId)
      },
      resend: async (purpose) => {
        if (purpose === 'signup') {
          registration.current = await (registration.current ?? signUp).prepareEmailAddressVerification({ strategy: 'email_code' })
        } else {
          await sendDeviceCode(attempt.current ?? signIn)
        }
      },
      requestReset: async (email) => {
        attempt.current = await signIn.create({ strategy: 'reset_password_email_code', identifier: email })
      },
      reset: async (code, password) => {
        const current = attempt.current ?? signIn
        const result = await current.attemptFirstFactor({ strategy: 'reset_password_email_code', code, password })
        attempt.current = result
        if (result.status === 'complete') return activate(result.createdSessionId)
        if (result.status === 'needs_second_factor' || result.status === 'needs_client_trust') {
          throw new Error(copy().auth.passwordChanged)
        }
        throw new Error(copy().auth.resetNotFinished)
      },
    }
  }, [signInState, signUpState])
}
