# Reset password

Source: https://mobbin.com/flows/7eb6d0e3-a45a-47ad-8c5b-ee2578c00a7e  
7 recorded steps. All downloaded and visually inspected.

Not recorded: inbox / email client, weak-password intermediate besides empty vs full, success after Update Password.

---

## 01 — Invalid credentials login (shared)

- **Position / screen ID:** 1 / `e370cba8-007b-4a51-8896-900086b67f3e`
- **What is visible:** Same Welcome-back error as Logging in 05.
- **What changed:** First frame of this flow.
- **What the user appears to be doing:** Failed login, about to use Forgot password. Click not yet shown.
- **Known vs inferred:** Shared capture: **Observed in Mobbin**.
- **Wasup relevance:** Reset is linked from the login form.
- **Unanswered:** Can reset start without a prior error?

---

## 02 — Reset Password, empty card

- **Position / screen ID:** 2 / `3d0e09b6-2b38-4c58-bf84-94ac2344d893`
- **What is visible:** Centered card (not a split). “Reset Password.” Email placeholder. Reset password button. Login link. No decorative chat.
- **What changed:** Split login replaced by a single card.
- **What the user appears to be doing:** Opened reset. Forgot-password click **inferred**.
- **Known vs inferred:** Card layout: **Observed in Mobbin**.
- **Wasup relevance:** Recovery is a dedicated page, simpler than the login split.
- **Unanswered:** URL pattern **Unverified.**

---

## 03 — Email filled

- **Position / screen ID:** 3 / `3089bf13-aab7-40d8-adf7-b7d9dc8340b4`
- **What is visible:** Same card. Email filled (capture account, not repeated).
- **What changed:** Email value.
- **What the user appears to be doing:** Typed an email.
- **Known vs inferred:** Field fill: **Observed in Mobbin**.
- **Wasup relevance:** Low.
- **Unanswered:** Client-side email validation? Not shown.

---

## 04 — Email sent (privacy copy)

- **Position / screen ID:** 4 / `b088b603-11b4-4cd4-8e53-30cf08399785`
- **What is visible:** Same card. Copy: if an account exists, a reset link is sent; link expires in 15 minutes; reset from the same device/browser used to request it. Button gray: “Email sent.” Login link still there.
- **What changed:** Privacy copy appeared. Button disabled/labeled Email sent.
- **What the user appears to be doing:** Submitted. Click **inferred**.
- **Known vs inferred:** Copy and button: **Observed in Mobbin**. That an email was actually sent: **Unverified**. Same-device restriction: **stated in UI**, not tested.
- **Wasup relevance:** Enumeration-safe copy + expiry + same-device rule are product decisions to review later. Not a Clerk decision yet.
- **Unanswered:** Is same-device still enforced live?

---

## 05 — Confirm your password reset

- **Position / screen ID:** 5 / `2123633d-0401-47cc-a67a-22743da0241a`
- **What is visible:** “Confirm Your Password Reset.” Single “Reset password” button. No inbox frame between 04 and 05.
- **What changed:** New page. Email-sent card gone.
- **What the user appears to be doing:** Opened the emailed link. That navigation is **inferred** and **not recorded**.
- **Known vs inferred:** Confirm page: **Observed in Mobbin**. Inbox: **not recorded**.
- **Wasup relevance:** Extra confirm step before the new-password form.
- **Unanswered:** Is this a Chatbase page or an emailed landing?

---

## 06 — Change Password, strength incomplete

- **Position / screen ID:** 6 / `e23ddfb0-32f8-4ed3-830c-127bbd8dc7b3`
- **What is visible:** “Change Password / Create a new password.” Password filled, masked. Update Password **gray**. No strength rows visible yet (or they are empty — the frame shows the field and a gray button without the green checklist).
- **What changed:** New-password form.
- **What the user appears to be doing:** Typed a password that does not yet meet rules — **or** strength UI has not appeared. Exact rule state is clearer in 07.
- **Known vs inferred:** Gray Update: **Observed in Mobbin**.
- **Wasup relevance:** Submit stays disabled until rules pass.
- **Unanswered:** Is there a confirm-password field? Not visible here.

---

## 07 — Strength complete, Update enabled

- **Position / screen ID:** 7 / `e1163660-4fe6-49fd-9058-97c2a054a705`
- **What is visible:** Strength all green: 8+ characters, lowercase, special, uppercase, number. Update Password **black**.
- **What changed:** Checklist complete. Button enabled.
- **What the user appears to be doing:** Met the password rules.
- **Known vs inferred:** Rules and enabled button: **Observed in Mobbin**. Success-after-update: **not recorded**. Live reset **not tested**.
- **Wasup relevance:** Same rule set appears on Onboarding sign-up (frames 04–05).
- **Unanswered:** Where does Update Password send the user?
