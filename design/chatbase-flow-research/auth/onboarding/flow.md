# Onboarding

Source: https://mobbin.com/flows/e476c604-a53d-4fe3-a171-b6321a436049  
20 recorded steps. All downloaded and visually inspected. Frame 12 is a readable loading screen.

**Split this journey.** Frames 01–08 are account creation. Frames 09–20 are first-agent creation, integrations, deploy-channel picker, and billing. 09–19 are **likely out of scope for Wasup**; the full recorded sequence is retained so the journey is not falsified.

No email-verification frame after sign-up.

Frame 07 reveals a password. That value is **not transcribed**. Do not publish that PNG.

---

## 01 — Marketing home (Cal hero)

- **Position / screen ID:** 1 / `3cfeb1b0-d89a-4b34-8bc8-e677792ba8b6`
- **What is visible:** Marketing home. Hero uses a pink Cal “Book meeting” card — **not** the AI Actions card from Logging in 01. Same header (Sign in / Try for Free).
- **What changed:** First frame.
- **What the user appears to be doing:** Public site before sign-up.
- **Known vs inferred:** Different hero than login 01: **Observed in Mobbin** (two captures).
- **Wasup relevance:** Entry only.
- **Unanswered:** Which hero is current?

---

## 02 — Let’s get started (sign-up)

- **Position / screen ID:** 2 / `1950c842-8de9-4c4e-a45d-ceaffc41d023`
- **What is visible:** Sign-up split. Google only — **no SSO button** (unlike login). Email, password, confirm password. Decorative chat on the right.
- **What changed:** Marketing replaced by sign-up.
- **What the user appears to be doing:** Opened Try for Free / Sign up. Click **inferred**.
- **Known vs inferred:** Google-only vs login’s Google+SSO: **Observed in Mobbin**.
- **Wasup relevance:** Sign-up method set differs from login. Do not decide Clerk options yet.
- **Unanswered:** Is SSO omitted on purpose for new accounts?

---

## 03 — Email filled

- **Position / screen ID:** 3 / `45e21367-0b01-4472-ae48-b50aca136d08`
- **What is visible:** Email filled. Passwords still empty/weak. Sign up still disabled or not yet emphasized.
- **What changed:** Email value.
- **What the user appears to be doing:** Typed an email.
- **Known vs inferred:** Field fill: **Observed in Mobbin**.
- **Wasup relevance:** Low.
- **Unanswered:** Duplicate-email error? **Not recorded.**

---

## 04 — Weak password meter

- **Position / screen ID:** 4 / `6f5ef2d1-fc3f-4be4-9e1b-2a492837eb01`
- **What is visible:** Password meter: 8+ and lowercase checked; uppercase / number / special unchecked. Meter reads weak (red).
- **What changed:** Password started. Rules visible.
- **What the user appears to be doing:** Typing a password.
- **Known vs inferred:** Partial rules: **Observed in Mobbin**. Same rule set as Reset 07.
- **Wasup relevance:** Shared password policy language.
- **Unanswered:** Is confirm-password validated live or only on submit?

---

## 05 — Strong password, confirm still short

- **Position / screen ID:** 5 / `d64d6346-11da-43fb-a102-4716c8fb17d6`
- **What is visible:** All strength rules green. Confirm field still shorter / masked. Sign up not yet clearly enabled.
- **What changed:** Password now strong.
- **What the user appears to be doing:** Finished the main password.
- **Known vs inferred:** Green rules: **Observed in Mobbin**.
- **Wasup relevance:** Strength can pass before confirm matches.
- **Unanswered:** Exact enable rule for Sign up.

---

## 06 — Confirm matches

- **Position / screen ID:** 6 / `1e455515-a3bf-47cb-be1c-765175e83091`
- **What is visible:** Confirm filled to match. Right decorative composer empty. Sign up looks enabled (black).
- **What changed:** Confirm filled.
- **What the user appears to be doing:** Confirmed the password.
- **Known vs inferred:** Enabled-looking Sign up: **Observed in Mobbin**.
- **Wasup relevance:** Confirm-password is required on sign-up, not on reset frame 06–07.
- **Unanswered:** Mismatch error? **Not recorded.**

---

## 07 — Password visibility on

- **Position / screen ID:** 7 / `6f6ce167-aec5-4260-bc37-bcd2414c04b5`
- **What is visible:** Eye toggle on. Password is plaintext in the PNG (**omitted**).
- **What changed:** Masking off.
- **What the user appears to be doing:** Revealed the password. Toggle click **inferred**.
- **Known vs inferred:** Visibility control: **Observed in Mobbin**.
- **Wasup relevance:** Eye toggle exists on sign-up and on login/reset.
- **Unanswered:** Does confirm also unmask?

---

## 08 — Sign up loading

- **Position / screen ID:** 8 / `0b886108-f3f4-4b9d-98ad-9897a23448a4`
- **What is visible:** Sign up button gray with a spinner. Email field shows a clear-X. No verification-email page.
- **What changed:** Submit in progress.
- **What the user appears to be doing:** Submitted the form. Click **inferred**.
- **Known vs inferred:** Loading button: **Observed in Mobbin**. Email verification: **not recorded**.
- **Wasup relevance:** Loading is the last recorded **auth** state.
- **Unanswered:** Is verification required today?

---

## 09 — First agent: site + support preset

Likely out of scope for Wasup. Sequence retained.

- **Position / screen ID:** 9 / `a72f46fc-e9bf-4f8a-b7dd-bb34b8db4ea2`
- **What is visible:** “Let’s create your first AI agent.” Website field (chatbase.co). Describe field. Preset “Answer support questions…”.
- **What changed:** Sign-up form replaced by agent-creation wizard.
- **What the user appears to be doing:** Creating the first agent after account creation. Transition **inferred**; no success-account frame.
- **Known vs inferred:** Wizard: **Observed in Mobbin**.
- **Wasup relevance:** Multi-agent first-run. Wasup starts with one existing agent.
- **Unanswered:** Can this step be skipped?

---

## 10 — Website changed to content-mobbin.com

- **Position / screen ID:** 10 / `4f106772-fa21-4410-a117-7a14910db626`
- **What is visible:** Same wizard. Website now content-mobbin.com.
- **What changed:** Website value.
- **What the user appears to be doing:** Edited the crawl URL.
- **Known vs inferred:** Field change: **Observed in Mobbin**.
- **Wasup relevance:** Out of scope (data sources).
- **Unanswered:** Does the URL trigger a crawl immediately?

---

## 11 — Longer custom describe

- **Position / screen ID:** 11 / `e6b6c766-ad61-48b3-aedd-f9a6b40bcb40`
- **What is visible:** Describe field longer / custom. Same wizard chrome.
- **What changed:** Description text.
- **What the user appears to be doing:** Writing a custom brief.
- **Known vs inferred:** Text change: **Observed in Mobbin**.
- **Wasup relevance:** Out of scope.
- **Unanswered:** Does describe seed playground instructions?

---

## 12 — Loading: extract brand colors

- **Position / screen ID:** 12 / `fd22051b-6ddd-4b5c-879b-759d2b33bba6`
- **What is visible:** Full-page loading. “You build your agent once, and deploy it everywhere.” Channel icons. “Extracting brand colors…” with a spinner. **Readable, not blank.**
- **What changed:** Wizard replaced by a progress message.
- **What the user appears to be doing:** Waiting after submit. Submit click **inferred**.
- **Known vs inferred:** Copy and spinner: **Observed in Mobbin**. Duration: **cannot be established**.
- **Wasup relevance:** Out of scope, but useful as a “do not drop loading frames” example.
- **Unanswered:** What else is extracted besides colors?

---

## 13 — Tech stack picker (Slack selected)

- **Position / screen ID:** 13 / `b26cf72b-8063-4551-9d56-3884cc8be773`
- **What is visible:** Stack tiles: Stripe, Cal, Zendesk, Sunshine, Calendly, Slack. Slack selected (blue).
- **What changed:** Loading replaced by a picker.
- **What the user appears to be doing:** Choosing integrations.
- **Known vs inferred:** Tiles: **Observed in Mobbin**. Out of scope for Wasup.
- **Wasup relevance:** Marked out of scope.
- **Unanswered:** Required or skippable?

---

## 14 — Calendly also selected

- **Position / screen ID:** 14 / `da168eb7-4bed-404e-8bb4-11826391141e`
- **What is visible:** Slack + Calendly selected.
- **What changed:** Second tile selected.
- **What the user appears to be doing:** Multi-select. Click **inferred**.
- **Known vs inferred:** Two selected: **Observed in Mobbin**.
- **Wasup relevance:** Out of scope.
- **Unanswered:** Does selection create Actions automatically?

---

## 15 — Deploy channels, none selected

- **Position / screen ID:** 15 / `9afd6b0c-2759-44fd-9306-c66ec3489ce7`
- **What is visible:** Deploy channels: Chat widget / Agent page / Slack / WhatsApp / Messenger / Instagram. None selected. Progress 3/4.
- **What changed:** New step.
- **What the user appears to be doing:** Choosing where to deploy.
- **Known vs inferred:** Channel list: **Observed in Mobbin**. This is **not** the later Deploy product flow (`3d619d6c-…`). Wasup will request deploy by email — do not assume this picker.
- **Wasup relevance:** Out of scope as a first-run gate.
- **Unanswered:** Can the user continue with none selected? Frame 15 shows none; 16–18 imply selections.

---

## 16 — Chat widget preview

- **Position / screen ID:** 16 / `6c22e0e3-47b0-4910-aaf9-b31364015f84`
- **What is visible:** Right side shows a gradient-border chat preview. Chat widget inferred selected.
- **What changed:** Preview appeared.
- **What the user appears to be doing:** Selected Chat widget. Click **inferred**.
- **Known vs inferred:** Preview: **Observed in Mobbin**. Selection: **Inferred**.
- **Wasup relevance:** Out of scope. Preview-on-select is a pattern, not a Wasup requirement.
- **Unanswered:** Multi-select allowed here too?

---

## 17 — Agent page preview

- **Position / screen ID:** 17 / `ceea88d9-0c49-4f75-a5e3-75d397e0a375`
- **What is visible:** Right side: help-center “How can we help you today?”
- **What changed:** Preview switched to Agent page.
- **What the user appears to be doing:** Selected Agent page. Click **inferred**.
- **Known vs inferred:** Preview: **Observed in Mobbin**.
- **Wasup relevance:** Out of scope.
- **Unanswered:** Is this a public help-center surface?

---

## 18 — Slack illustration

- **Position / screen ID:** 18 / `c9f4e75a-8f24-4fad-9cb0-f473e581b65c`
- **What is visible:** Marketing illustration of a Slack notification workflow (Connecting to Slack / Send notification). Not a real OAuth form (that is the separate Connecting to Slack flow).
- **What changed:** Preview is an illustration, not a live connect.
- **What the user appears to be doing:** Selected Slack. Click **inferred**.
- **Known vs inferred:** Illustration: **Observed in Mobbin**. Actual Slack connect: **not this frame**.
- **Wasup relevance:** Out of scope.
- **Unanswered:** Does first-run Slack selection later require OAuth?

---

## 19 — Choose your plan

- **Position / screen ID:** 19 / `8a74b51d-ea06-476e-b511-6c8a12544cb6`
- **What is visible:** Hobby $32/m, Standard $120/m Popular, Pro $400/m, Enterprise, plus Continue with Free.
- **What changed:** Billing step. Progress complete-looking.
- **What the user appears to be doing:** Picking a plan.
- **Known vs inferred:** Prices and Free escape: **Observed in Mobbin**. Billing is **out of scope**. Sequence retained.
- **Wasup relevance:** Out of scope. Frame 20 shows Free plan, so Continue with Free is **inferred**.
- **Unanswered:** Are these prices current?

---

## 20 — Playground idle (shared)

- **Position / screen ID:** 20 / `b8a8262b-bd97-48ef-9062-8bdbe0775b1b`
- **What is visible:** Same historical playground as Setting up a playground 01. Free plan. Getting started 1/6.
- **What changed:** Wizard gone. App playground.
- **What the user appears to be doing:** Landed in playground after first-run. Plan click **inferred**.
- **Known vs inferred:** Shared capture: **Observed in Mobbin**. Live first landing after login is the **Agents list**, not playground (**Previously observed live**). This frame is first-run after creating an agent, which can differ from later logins.
- **Wasup relevance:** End of recorded onboarding. Playground first-run chrome (Getting started, upgrade) is platform, not Wasup.
- **Unanswered:** Does current first-run still skip the Agents list?
