# Scratch notes: Chatbase login (observed)

Do not treat this as the final report. Measurements from live inspection on 2026-09-23.

## Tool capability (verified)

- Open official site: yes (`https://www.chatbase.co/`)
- Inspect rendered pages: yes (snapshot + CDP)
- Interact with controls: yes (click, fill, lock)
- Screenshots: yes (`browser_take_screenshot`)
- Recordings: not supported by available browser tools
- Transition timing: CDP/observation only; no video capture
- Viewport used for login: 1920×1080 @ 2x DPR

Screenshot note: captured PNGs show garbled Latin text (font subset/encoding in the capture pipeline). Live DOM text and CDP measurements are authoritative.

## Entry points

- Marketing header **Login** → `https://www.chatbase.co/auth/signin`
- Also present on marketing: Start free trial, Get a demo (not followed; out of scope)
- Related auth URLs observed in DOM: `/auth/signup`, `/auth/sso`, `/auth/password-reset`

## Login composition (measured)

- URL: `https://www.chatbase.co/auth/signin`
- Title: Sign In - Chatbase
- Split layout: left form column 960×1080 white; right aside 960×1080 `rgb(44, 65, 179)`
- Form column content width: 452px, left offset 254px
- Header in form column: 32px tall, space-between, y=48
- Brand: Chatbase wordmark top-left
- Secondary header action: “Create a new account” (outline pill)
- H1 “Welcome back”: Inter 28px / 600 / letter-spacing -1.12px / line-height 36.4px
- Subtitle “Log in to access your Chatbase account.”: 16px / 400 / muted gray
- Auth options offered: Login with Google (button), Sign in with SSO (link to `/auth/sso`), email+password
- Microsoft button: **not present** on the live page (present in the user-supplied older screenshot)
- OR divider between social and email
- Email label 14px/500, field 452×40, radius 8px, placeholder `name@example.com`
- Password label 14px/500, field 452×40, radius 8px, placeholder bullets
- Show/Hide password: 36×36 button, aria-label Show password → Hide password, `aria-pressed` true when visible; input type password → text
- Forgot password? link aligned with password label
- Primary Login: 452×40, radius 8px, near-black fill, white 14px/500
- Login disabled + opacity 0.5 when both fields empty
- Login enables after email only (empty password still allowed)
- Footer: © 2026 Chatbase Inc. · Terms · Privacy
- Right panel: decorative chat-widget mock + partner logos on indigo
- Fonts loaded: Inter (UI), Proza Display (marketing), Geist also referenced
- Cloudflare Turnstile hidden field present

## Focus

- Email/password outline: 1.5px muted gray, offset -1px (inset-like). No strong colored ring observed via computed style.

## Empty-password validation (tested once)

- Trigger: email filled, password empty, click Login
- Login briefly became `loading Login` + disabled
- Then inline error: “Please enter your password”
- Error: 13px / 500 / destructive red; Password label also turned red
- Password field border stayed the same gray (no red border)
- Form height 236 → 264 (+28px); Login y 752 → 766
- Layout shifted downward slightly; no overlay
- Focus moved to password field
- Fields and email value preserved

## Google SSO

- Click “Login with Google” navigated same tab to Google Accounts identifier
- Continue-to label: chatbase.co
- Email prefilled by auditor: bashirsani.dev@gmail.com
- Password / 2FA: awaiting user; not entered by auditor
- Post-login landing: **Not verified**
- 2026-09-23 later check: user reported being signed in, but Cursor browser tabs still showed Google identifier / Chatbase `/auth/signin`. Likely signed in in a different browser profile. Cursor-controlled browser has no Chatbase session cookie.

## SSO page (read-only snapshot)

- URL: `https://www.chatbase.co/auth/sso`
- Title: SSO Sign In - Chatbase
- Heading: “SSO Sign In”
- Helper: “Enter your work email to sign in with your company SSO.”
- Field: Work Email, placeholder `you@company.com`
- Primary: “Continue with SSO” (disabled when empty)
- Header: Chatbase mark + “Sign in” link back
- Same split-layout pattern as email login (aside present at 1440)
- Not submitted (would start a real SSO flow)

## Responsive login (emulated)

- 1440×900: still 50/50 split; form 452px; left column 720px; form x=134
- 1024×768: still 50/50; columns 512px; form 452px with only ~30px side inset — cramped; marketing panel clipped
- 390×844: aside `display:none` (`hidden lg:flex lg:w-1/2`); form 350×236; 20px inset; header 56px; extra “Don’t have an account? Create a new account” at bottom
- Touch targets: Google and Login 40px tall (below 44px)
- Screenshot capture at 390 still rendered a wide canvas; CDP measurements are authoritative
- Reduced-motion media query: false in this session; Chatbase reduced-motion **not verified**

## Unverified on login

- Successful login destination
- Onboarding after login
- Invalid-credential error (not tested; would require guessing)
- SSO (SAML) page internals
- Signup / password-reset flows
- Loading spinner visual (observed name “loading Login” only; screenshot missed the brief state)
- Reduced motion
- Mobile login (not yet resized)
