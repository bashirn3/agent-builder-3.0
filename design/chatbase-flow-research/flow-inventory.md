# Flow inventory

Named Chatbase flows discovered with Mobbin `search_flows`, filtered to `app_name == Chatbase`, deduplicated by flow ID.

A query containing “Chatbase” does **not** filter exclusively. Non-Chatbase results were discarded.

This is not a catalog-wide total. Pagination remaining is recorded in [coverage.md](coverage.md).

Titles below are **Mobbin flow names**, not analyst titles.

All listed flows are platform **web**.

---

## A. Authentication and entry — fully inspected

| Flow | ID | Screens | Actions | Source |
| --- | --- | --- | --- | --- |
| Logging in | `89e4bd04-fe27-40a9-98ae-bdf64edd7772` | 8 | Logging In, Verifying | https://mobbin.com/flows/89e4bd04-fe27-40a9-98ae-bdf64edd7772 |
| Logging out | `2684ff45-1eb1-4cc9-a1b0-bb63a21a57f4` | 2 | Logging Out | https://mobbin.com/flows/2684ff45-1eb1-4cc9-a1b0-bb63a21a57f4 |
| Reset password | `7eb6d0e3-a45a-47ad-8c5b-ee2578c00a7e` | 7 | Resetting Password | https://mobbin.com/flows/7eb6d0e3-a45a-47ad-8c5b-ee2578c00a7e |
| Setting up two-factor authentication | `4f646851-8420-4ab1-b51a-59e94fba6136` | 5 | Setting Up, Verifying | https://mobbin.com/flows/4f646851-8420-4ab1-b51a-59e94fba6136 |
| Onboarding | `e476c604-a53d-4fe3-a171-b6321a436049` | 20 | Creating Account, Onboarding | https://mobbin.com/flows/e476c604-a53d-4fe3-a171-b6321a436049 |

Auth vs later product setup (do not merge):

- Logging in 01–08: marketing home → sign-in form → invalid credentials → login-time 2FA → Agents list.
- Onboarding 01–08: marketing home → sign-up form → loading submit.
- Onboarding 09–20: first-agent creation, tech-stack picker, deploy-channel picker, plan picker, then playground. **Likely out of scope for Wasup.** Sequence retained.
- 2FA setup is an Account-settings branch, separate from login-time 2FA challenge.

Not recorded in these flows (do not invent):

- Google or SSO completion.
- Microsoft as a sign-in method.
- Email-verification after sign-up.
- Inbox / email client during password reset.
- Success-after-password-update.
- Sign-out confirm dialog.

---

## B. Playground — fully inspected

Keep these as **separate recorded journeys**. Shared `screen_id` values are noted in each `flow.md`. Do not merge them into one made-up sequence.

| Flow | ID | Screens | Actions | Source |
| --- | --- | --- | --- | --- |
| Setting up a playground | `52947e76-b30a-4f91-8832-f424a32b744b` | 15 | Chatting & Sending Messages, Giving Feedback, Setting Up | https://mobbin.com/flows/52947e76-b30a-4f91-8832-f424a32b744b |
| Setting up an agent | `89e31288-80cb-4002-ad32-19c09202befd` | 7 | Editing & Updating | https://mobbin.com/flows/89e31288-80cb-4002-ad32-19c09202befd |
| Comparing AI models | `7eb8b73f-350a-40fb-9527-8b16fedd97c8` | 4 | — | https://mobbin.com/flows/7eb8b73f-350a-40fb-9527-8b16fedd97c8 |
| Recording a prompt | `b0059d42-0a5f-4c69-bcd9-9e6d17864414` | 3 | Recording Audio & Video | https://mobbin.com/flows/b0059d42-0a5f-4c69-bcd9-9e6d17864414 |
| Adding an instance | `4ac37fa2-8665-419a-8457-63c60563e7e3` | 2 | — | https://mobbin.com/flows/4ac37fa2-8665-419a-8457-63c60563e7e3 |
| Moving instances | `c2dc35a3-10d5-45ea-b14c-6c5fc9ba0dac` | 3 | — | https://mobbin.com/flows/c2dc35a3-10d5-45ea-b14c-6c5fc9ba0dac |
| Deleting an instance | `1e2fa305-bdfd-42ff-a739-959813954ad2` | 2 | Deleting & Removing | https://mobbin.com/flows/1e2fa305-bdfd-42ff-a739-959813954ad2 |

What these flows actually cover:

- **Setting up a playground** — idle playground, model picker, unsaved bar, instruction presets, save toast, send, waiting, reply, thumbs. Historical settings-column layout.
- **Setting up an agent** — Compare dual panes, per-pane settings popover, save-to-main-agent confirm. Not first-agent creation.
- **Comparing AI models** — playground idle → Compare → dual composers filled → side-by-side replies.
- **Recording a prompt** — Compare idle → waveform in one composer → both composers showing the same typed question.
- **Adding / Moving / Deleting an instance** — Compare instance chrome only.

Missing from the 15-step playground flow (do not invent):

- Expanded instruction editor.
- Opening-message settings.
- Reset conversation.
- Compare used inside that same 15-step sequence (Compare lives in the other flows).

---

## C. Activity — inventoried only

Not fully processed. Stopped after Playground + Auth.

| Flow | ID | Screens | Source |
| --- | --- | --- | --- |
| Activity | `fc795150-9f00-428e-b3aa-5e8219d449f6` | 5 | https://mobbin.com/flows/fc795150-9f00-428e-b3aa-5e8219d449f6 |
| Chat logs | `73268987-6958-47b7-aed4-6b74f77c8090` | 3 | https://mobbin.com/flows/73268987-6958-47b7-aed4-6b74f77c8090 |

Inline subset observed (not a complete inspection):

- Activity starts on the historical playground, then Chat logs empty state (“No chats found” / “Select a conversation”), then a Leads table.
- Chat logs is a separate named flow (3 screens). Not opened frame-by-frame in this pack.

Also adjacent, not processed: **Deleting all conversations** (`025f8744-8061-469e-85d6-26dd04698b28`, 4 screens) — Settings → General danger zone, not the Activity list.

---

## D. Contacts (to become Leads) — inventoried only

| Flow | ID | Screens | Source |
| --- | --- | --- | --- |
| Contacts | `9de5f5f1-2b5d-4ccc-8e8e-49d6314f742f` | 2 | https://mobbin.com/flows/9de5f5f1-2b5d-4ccc-8e8e-49d6314f742f |

The Activity flow’s later frames already show a **Leads** table (Name / Email / Phone / Submitted at + date filter + Export). That is a different named flow from Contacts.

Individual-record and associated-conversation frames were not fully inspected in this pack.

---

## E. Settings — identified only

Do not assume Wasup needs a Settings page. These are named Mobbin flows, listed so they can be picked up later.

| Flow | ID | Screens | Source |
| --- | --- | --- | --- |
| Settings | `c514d8a9-57b4-4376-845c-4fa043fe2416` | 11 | https://mobbin.com/flows/c514d8a9-57b4-4376-845c-4fa043fe2416 |
| Account settings | `4f094841-1dd9-4f1e-ba4f-5b28ba65fc8f` | 4 | https://mobbin.com/flows/4f094841-1dd9-4f1e-ba4f-5b28ba65fc8f |
| Workspace settings | `b58d24a8-9d4c-4c35-b10f-7c1d91c1174d` | 7 | https://mobbin.com/flows/b58d24a8-9d4c-4c35-b10f-7c1d91c1174d |
| Updating profile | `18fba309-a9a7-4a31-8378-ed2da726329e` | 4 | https://mobbin.com/flows/18fba309-a9a7-4a31-8378-ed2da726329e |
| Updating an email | `cab78f01-211d-4a84-8f3e-c487d89b393a` | 3 | https://mobbin.com/flows/cab78f01-211d-4a84-8f3e-c487d89b393a |
| Updating notifications | `de51d3b2-3ac6-449d-bd5d-1add0fd819dc` | 4 | https://mobbin.com/flows/de51d3b2-3ac6-449d-bd5d-1add0fd819dc |
| Updating workspace details | `a965aaeb-d67a-4b86-b090-dffa368787c2` | 3 | https://mobbin.com/flows/a965aaeb-d67a-4b86-b090-dffa368787c2 |
| Creating a webhook | `18696448-…` | 7 | Previously discovered; full ID retained in coverage notes |
| Creating an API key | `3004d0d0-…` | 4 | Previously discovered |
| Deleting account | `dcd75900-91bc-4fe2-a173-b1ae5d31cb92` | 4 | https://mobbin.com/flows/dcd75900-91bc-4fe2-a173-b1ae5d31cb92 |
| Deleting a workspace | `c5aa21ca-48cb-4d0e-9750-2fe1788d5882` | 4 | https://mobbin.com/flows/c5aa21ca-48cb-4d0e-9750-2fe1788d5882 |
| Deleting an agent | `7d5c8e57-4076-4878-b11b-6e84d68b365d` | 4 | https://mobbin.com/flows/7d5c8e57-4076-4878-b11b-6e84d68b365d |

2FA setup (fully inspected under Auth) begins on Account settings.

---

## F. Deploy — identified only

Wasup’s eventual action will request deployment by email, not automatically deploy an agent. Do not assume Chatbase’s recorded behavior matches that.

| Flow | ID | Screens | Source |
| --- | --- | --- | --- |
| Deploy | `3d619d6c-921b-4b50-9a43-0d17f43ddcb5` | 3 | https://mobbin.com/flows/3d619d6c-921b-4b50-9a43-0d17f43ddcb5 |
| Updating a chat widget | `a3854716-41bc-4098-b638-98c0bc943fc0` | 9 | https://mobbin.com/flows/a3854716-41bc-4098-b638-98c0bc943fc0 |
| Connecting to Slack | `c9822350-3602-4594-965f-faf7b0990f08` | 3 | https://mobbin.com/flows/c9822350-3602-4594-965f-faf7b0990f08 |
| Adding a button | `9439c3e2-789f-4de4-89dd-289098070569` | 5 | https://mobbin.com/flows/9439c3e2-789f-4de4-89dd-289098070569 |
| Enable email auto-reply | `0be2339e-6330-4a20-8136-fd30d3de305b` | 9 | Likely out of scope |

Inline subset: Deploy goes playground → All channels. Updating a chat widget shows Content / Style / AI / Embedded + black widget + embed snippet. Connecting to Slack is a Slack OAuth permissions page, then a success toast.

Onboarding 15–18 is a **first-run deploy-channel picker**, not this Deploy flow.

---

## Adjacent / out of scope (not deeply researched)

If a later pass needs names only:

| Flow | ID | Screens | Why listed |
| --- | --- | --- | --- |
| Actions | `fcc9cf0c-ac1e-4b85-9de2-983cf7c6b4ca` | 3 | Playground-adjacent Actions nav |
| Creating an action | `6a45490f-…` | 8 | Out of scope |
| Deleting an action | `4263a8bd-8878-4bd5-a80e-037e767a4f9c` | 4 | Out of scope |
| Disabling an action | `712a317c-19d6-4d27-98bf-cbd9ea579a74` | 3 | Out of scope |
| Creating a workspace | `14594c4f-…` | 4 | Out of scope |
| Adding a file from Notion | `c093c9de-…` | 4 | Data sources |
| Deleting a file | `c35ed963-84ac-4a50-99e8-1be21663c898` | 5 | Data sources |
| Dashboard | `d31796b4-…` | 5 | Analytics-adjacent |
| Upgrading a plan | `a6a734d2-…` | 5 | Billing |

Truncated IDs above were seen in earlier search pages in this session and not re-fetched on the latest page. They are inventory hints, not fully verified screen lists.

---

## Shared screen IDs (do not merge journeys)

| Screen ID | Seen in |
| --- | --- |
| `6ae9a069-07ff-4407-9148-384cd2e3ee8a` | Setting up a playground 10; Comparing AI models 1; Account settings 1; Activity 1 |
| `78548a27-8ee6-48cc-92cb-886a5824d6fb` | Setting up an agent 1; Comparing AI models 2; Recording a prompt 1 |
| `5ac07838-b2fc-4025-afb6-45c0012ab7a1` | Setting up an agent 5; Adding an instance 1; Moving instances 1 |
| `4161d47e-955b-4f4c-8567-01e99313c58a` | Moving instances 2; Deleting an instance 1 |
| `218e17de-51f8-4ba2-94e8-8c790c9e5162` | Comparing AI models 3; Recording a prompt 3 |
| `b8a8262b-bd97-48ef-9062-8bdbe0775b1b` | Setting up a playground 1; Onboarding 20 |
| `cf69146f-f96f-41ce-ac78-dba5aac058f0` | Logging in 1; Logging out 2 |
| `e370cba8-007b-4a51-8896-900086b67f3e` | Logging in 5; Reset password 1 |
| `c0638095-87a3-4588-bbea-f8f4c1563af1` | Logging out 1; Account settings 2 |
| `22d98409-6111-44bc-af05-8df237cab0a8` | 2FA setup 1; Account settings 4; Deleting account 1 |
