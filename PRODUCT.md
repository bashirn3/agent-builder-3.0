# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript + Motion. Chosen by the user for the first interactive version.

## Users

Internal or invited users who configure and test an existing WhatsApp-style agent connected to an n8n workflow. They are not building workflows or creating new agents; they are refining how an existing agent behaves.

## Product Purpose

The product lets a user edit an agent's master prompt, configure the opening message, test the connected agent in a playground, recall or restore earlier prompt versions, finalize and lock the master configuration, and continue testing the locked agent separately.

Success means the user can confidently move through: edit master prompt → test in playground → refine or restore an earlier version → finalize and lock master → continue testing in the agent tester.

## Positioning

The product is a focused existing-agent control room for a connected n8n-powered agent, not a general AI playground, workflow builder, or new-agent creation tool.

## Operating Context

Users work in a browser across desktop and mobile layouts. The core workspace has one K1 Katsastus agent, prompt/version controls, an opening-message field, and a test chat. Playground messages are simulated in the first implementation and should not imply live n8n, real customer messaging, or real appointment creation.

## Capabilities and Constraints

- Login is required before accessing the workspace.
- The workspace is for one existing K1 Katsastus agent.
- Master prompt changes are versioned.
- Earlier versions can be viewed and restored.
- Opening message is configurable and can include supported variables such as `{{first_name}}` and `{{registration_number}}`.
- The playground lets users send test messages and inspect canned vehicle-inspection booking responses in the first version.
- Locking makes the master configuration read-only until explicitly unlocked.
- The locked tester lets users keep chatting with the saved agent without modifying the locked master.
- The first implementation must be interactive but does not need real authentication, live n8n calls, or production persistence.

Open decisions:
- Whether lock state is shared across users or local to the current user/session.
- Whether a future duplicate/preset workflow is needed after the first single-agent version ships.
- Whether an existing test conversation stays pinned to the version it started with after a newer version is saved.
- Whether unsaved drafts persist across reloads.

## Brand Commitments

The working name in the design is “wasup”. The interface should feel professional, focused, and operational rather than playful or workflow-builder-like.

## Evidence on Hand

- Current/old agent builder screenshot supplied by the user in the chat.
- Claude design prototype: `design/Wasup Interface.dc.html`.
- Mobbin reference pack: `design/mobbin-references/`.
- Impeccable setup and product context requirements from `https://impeccable.style/designing/`.
- Motion for React installation guidance from `https://motion.dev/docs/react-quick-start`.

## Product Principles

- Keep the user inside one clear edit-test-refine loop.
- Make saved, draft, and locked states impossible to confuse.
- Preserve the difference between configuring the master prompt and testing the agent.
- Keep the workspace focused on one selected agent unless a future duplicate/preset flow is explicitly scoped.
- Do not introduce workflow-building, new-agent creation, or broad AI-platform features.

## Accessibility & Inclusion

Use accessible form labels, keyboard-reachable controls, visible focus states, sufficient color contrast, and responsive layouts that work on narrow mobile screens without shrinking desktop controls into unusable targets.
