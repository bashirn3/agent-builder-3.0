# Logging in

Source: https://mobbin.com/flows/89e4bd04-fe27-40a9-98ae-bdf64edd7772  
8 recorded steps. All downloaded and visually inspected.

Mobbin login is a **white split**. Live 2026 login is an **indigo 50/50** at `/auth/signin` (**Previously observed live**). Do not combine them into one exact screen.

Google and SSO completion are **not recorded**. Microsoft is **not in these frames**. Live audit also did not show Microsoft.

Capture emails visible in the frames are not repeated here.

---

## 01 — Marketing home

- **Position / screen ID:** 1 / `cf69146f-f96f-41ce-ac78-dba5aac058f0`
- **What is visible:** Chatbase marketing homepage. Header: Solutions / Resources / Enterprise / Pricing / Sign in / Try for Free. Hero: “AI agents for magical customer experiences.” CTA “Build your agent for free.” Right: AI Actions card (Cal / Book a meeting / Update subscription toggles). Logo row. Different hero from Onboarding 01 (which uses a Cal booking card).
- **What changed:** First frame.
- **What the user appears to be doing:** Arriving from the public site. Sign-in click not yet shown.
- **Known vs inferred:** Home chrome: **Observed in Mobbin**. Live Login in the header goes to `/auth/signin` (**Previously observed live**).
- **Wasup relevance:** Entry from marketing. Wasup may not have this homepage.
- **Unanswered:** Is this still the current marketing hero?

Shared with Logging out 02.

---

## 02 — Welcome back, white split, form filled

- **Position / screen ID:** 2 / `b276a198-6887-48d5-a4a4-2722d786e565`
- **What is visible:** Centered-left “Welcome back / Log in to access your Chatbase account.” Methods: Login with Google, Sign in with SSO, OR email + password, Forgot password, Continue, Sign up link, Terms / Privacy. Right: decorative chat widget on a dotted pane (“I want to up…”). Email uses a work-style address. Password filled, masked. Continue black.
- **What changed:** Marketing home replaced by the auth split.
- **What the user appears to be doing:** On the sign-in form with credentials entered. Navigation click **inferred**.
- **Known vs inferred:** Method list: **Observed in Mobbin**. Live page has the same methods on an indigo split (**Previously observed live**). Decorative chat is marketing chrome, not a live session.
- **Wasup relevance:** Method set is the useful reference. Visual direction is historical.
- **Unanswered:** Does SSO open a domain field? **Unverified.**

---

## 03 — Email changed to a capture Gmail

- **Position / screen ID:** 3 / `c2589960-5c7b-48b0-a9e5-3f27e2825726`
- **What is visible:** Same form. Email field now a Gmail capture account. Decorative chat text changed.
- **What changed:** Email value and right-pane copy.
- **What the user appears to be doing:** Edited the email. **Inferred.**
- **Known vs inferred:** Field change: **Observed in Mobbin**. Continuity vs a splice: possible seam.
- **Wasup relevance:** Low. Shows the form is editable before submit.
- **Unanswered:** Why the decorative chat changed with the email.

---

## 04 — Decorative chat updated again

- **Position / screen ID:** 4 / `8f094db2-17ba-4639-8c66-a28e8d1c98f6`
- **What is visible:** Same filled form. Right decorative chat now “Can you check my active subscriptions?”
- **What changed:** Right-pane copy only. Form looks the same.
- **What the user appears to be doing:** Unclear. May be a capture of the decorative widget cycling.
- **Known vs inferred:** Right-pane change: **Observed in Mobbin**. User action: **Unverified**.
- **Wasup relevance:** None. Do not treat decorative chat as product behavior.
- **Unanswered:** Is the right pane animated independently?

---

## 05 — Invalid email or password

- **Position / screen ID:** 5 / `e370cba8-007b-4a51-8896-900086b67f3e`
- **What is visible:** Red error “Invalid email or password.” Continue still black. Right decorative widget empty (composer only). Same email/password filled.
- **What changed:** Error appeared. Right pane emptied.
- **What the user appears to be doing:** Submitted and failed. Submit click **inferred**.
- **Known vs inferred:** Error copy: **Observed in Mobbin**. Live invalid-credentials **not tested**. Shared with Reset password 01.
- **Wasup relevance:** Generic credential error, not field-level “email invalid.”
- **Unanswered:** Does the error appear without a page reload?

---

## 06 — Login-time two-factor challenge

- **Position / screen ID:** 6 / `0a2ac074-eb51-4253-9071-3f8101ab8ed9`
- **What is visible:** “Two-factor authentication” heading. Six empty digit boxes. Helper: “Lost access to your phone? Use a recovery code.” Continue gray. Decorative chat shows Chatbase AI bubbles on the right.
- **What changed:** Password form replaced by 2FA challenge. Error gone.
- **What the user appears to be doing:** Passed password check on an account that has 2FA. Prior success frame is **not recorded** (05 is the error state — another seam).
- **Known vs inferred:** Challenge chrome: **Observed in Mobbin**. That 05 and 06 are one continuous attempt: **not supported**. Live 2FA **not tested**.
- **Wasup relevance:** Login-time 2FA exists in the reference product. Do not decide Wasup auth options yet.
- **Unanswered:** Recovery-code path is linked, not recorded.

---

## 07 — 2FA digits filled

- **Position / screen ID:** 7 / `21e8aa9d-c0f5-478a-a615-25471e1047db`
- **What is visible:** Same challenge. Six boxes filled. Continue still appears gray in the capture.
- **What changed:** Digits entered. Values are visible in the PNG and are **not transcribed**.
- **What the user appears to be doing:** Entered a TOTP or recovery code.
- **Known vs inferred:** Filled boxes: **Observed in Mobbin**. Why Continue looks gray when filled: **Unverified** (capture timing vs disabled state).
- **Wasup relevance:** 6-digit authenticator pattern.
- **Unanswered:** Does Continue enable only after the sixth digit?

---

## 08 — Agents list (post-login landing)

- **Position / screen ID:** 8 / `46f67829-63fe-4bbc-95de-8d3258812837`
- **What is visible:** Agents list. Sidebar: Agents / Usage / Workspace settings. One agent card (AS Mobbin Agent, last trained 4 hours ago). + New AI agent. Decorative help chat in the corner. No playground.
- **What changed:** Auth chrome gone. Workspace app.
- **What the user appears to be doing:** Landed after 2FA. No loading frame between 07 and 08.
- **Known vs inferred:** Agents landing: **Observed in Mobbin**. Matches live post-login Agents list (**Previously observed live**). Loading: **not recorded**.
- **Wasup relevance:** Chatbase is multi-agent. Wasup is one-agent — landing on an Agents list is likely out of scope.
- **Unanswered:** Does a user with 2FA off skip 06–07?

---

## Not in this flow

Google/SSO completion, Microsoft, email verification, a success-password frame before 2FA, a loading spinner between 2FA and Agents.
