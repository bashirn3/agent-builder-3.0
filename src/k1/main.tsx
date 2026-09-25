import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/geist'
import { ClerkProvider } from '@clerk/react'
import App from './App'
import { CLERK_PUBLISHABLE_KEY, clerkEnabled, SessionProvider } from './auth/session'
import { navigateTo } from './routes'
import './k1.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {clerkEnabled ? (
      <ClerkProvider
        publishableKey={CLERK_PUBLISHABLE_KEY}
        signInUrl="/#/signin"
        signUpUrl="/#/signup"
        afterSignOutUrl="/#/signin"
        routerPush={(to) => navigateTo(to, false)}
        routerReplace={(to) => navigateTo(to, true)}
      >
        <SessionProvider><App /></SessionProvider>
      </ClerkProvider>
    ) : (
      <SessionProvider><App /></SessionProvider>
    )}
  </React.StrictMode>,
)
