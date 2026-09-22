---
name: wasup agent builder
description: Focused existing-agent control room for prompt editing, versioning, and testing.
colors:
  ink: "#1d1d1b"
  ink-muted: "#55554f"
  canvas: "#f7f7f4"
  surface: "#ffffff"
  sunken: "#efefea"
  active-row: "#e7e7e1"
  dot: "#deded8"
  line: "#e5e5df"
  line-strong: "#d4d4cc"
  placeholder: "#8a8a83"
  selection: "#dfeee4"
  prompt-ink: "#2d2d29"
  scrollbar: "#c7c7bf"
  success: "#1f6b43"
  success-bg: "#edf8f1"
  draft: "#806410"
  draft-bg: "#fbf3df"
  error: "#8a3f3f"
  error-bg: "#fcf5f5"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(28px, 5vw, 36px)"
    fontWeight: 680
    lineHeight: 1.02
    letterSpacing: "-0.045em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14.5px"
    fontWeight: 610
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 570
    lineHeight: 1.4
  micro:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.03em"
  menu-label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.03em"
  avatar:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1
  field-mobile:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  mono:
    fontFamily: "SFMono-Regular, SF Mono, Consolas, Liberation Mono, Menlo, monospace"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.75
rounded:
  brand-mark: "7px"
  avatar: "8px"
  menu-item: "9px"
  control: "10px"
  field: "12px"
  card: "14px"
  dialog: "16px"
  message: "17px"
  sheet: "20px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0 17px"
    height: "42px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "18px 24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "12px"
    padding: "14px 16px"
---

# Design System: wasup agent builder

## Overview

**Creative North Star: "The Focused Agent Bench"**

The interface is a quiet bench for configuring one existing agent, not a campaign page or a general AI lab. It blends OpenAI Platform's restrained product-console typography and density with Chatbase's focused settings column, tabbed configuration, sticky save decisions, and live chat preview on a dotted canvas.

The visual system is restrained and operational: off-white canvas, white work surfaces, thin neutral rules, near-black primary actions, and state color only where it changes the user's decision. Motion is used to clarify state changes such as drawers, sheets, saved banners, locks, and new chat messages.

**Key Characteristics:**
- Calm, low-contrast workspace with high-contrast actions.
- Focused enough for one existing agent; no broad product navigation.
- Dense enough for prompt work, never card-stacked for decoration.
- State-first language: saved, draft, locked, restored, active.
- Mobile interactions use sheets and bottom navigation instead of shrinking desktop panes.

## Colors

The palette is neutral-first with semantic state colors reserved for save/draft/error decisions.

### Primary
- **Operational Ink**: The primary action, dark chat bubble, app mark, and focus outline. It should stay rare and decisive.

### Neutral
- **Canvas Chalk**: The page background and chat field.
- **Preview Dot**: The faint dotted tester canvas borrowed from Chatbase-like preview areas.
- **Active Row**: Active tabs and selected menu rows.
- **Paper Surface**: Cards, drawers, messages, menus, and input wells.
- **Quiet Rule**: Dividers and low-contrast strokes.
- **Strong Rule**: Input and drawer borders that need more definition.
- **Muted Ink**: Secondary copy, helper text, and non-primary controls.

### State
- **Saved Green**: Successful save, active saved version, and locked-safe state.
- **Draft Amber**: Unsaved draft and testing mismatch warnings.
- **Recovery Red**: Login and future validation errors.

### Named Rules
**The Rare Action Rule.** Near-black is reserved for the action that commits or sends. Secondary actions stay on paper with a rule.

**The State Color Rule.** Green, amber, and red only describe real status or recovery. They are not decorative accents.

## Typography

**Display Font:** Inter/system UI stack  
**Body Font:** Inter/system UI stack  
**Label/Mono Font:** SF Mono stack for prompt/code-like content

**Character:** System sans keeps the workspace native and fast. Monospace is used only where the user is reading or writing agent instructions, not as a generic technical costume.

### Hierarchy
- **Display**: 680 weight, tight tracking, used on login only.
- **Title**: 610 weight around 14.5px, used for editor sections and rows.
- **Body**: 15px/1.55 for conversational and explanatory copy.
- **Label**: 13px medium for field labels, control copy, and metadata.
- **Mono**: 14–16px with generous line height for master prompt and version previews.

### Named Rules
**The Prompt Legibility Rule.** Prompt text gets larger line height and a monospaced face; it is edited like instructions, not scanned like marketing copy.

## Layout

Desktop uses a compact 54px header, then a focused configuration column beside a wider tester preview. The left column has Chatbase-style section tabs for Prompt and Opening only; version history lives in the workspace header. The right side uses a dotted preview canvas with a contained live tester card. Locked state removes the editor and gives the tester the whole working area.

Mobile uses a 64px agent header, card-like control rows, full-screen field sheets, visible sign-out, and bottom Edit/Playground tabs. The mobile edit view prioritizes jumping into a field rather than showing long textareas inline.

**The Split-Then-Sheet Rule.** Desktop keeps edit and test visible together; mobile uses one focused task surface at a time.

## Elevation & Depth

Depth is subtle. Most surfaces are flat with tonal separation and hairline borders; only transient layers such as menus, drawers, dialogs, toasts, and primary buttons use shadows.

### Shadow Vocabulary
- **Low Ambient**: Small control lift and inset highlights for buttons and inputs.
- **Panel Lift**: A soft offset shadow for drawers, menus, dialogs, and toasts.

## Motion

Motion explains state and continuity rather than decorating the workspace.

- **Tab continuity:** Prompt/Opening uses a shared active indicator and a short content reveal so the user understands the editor surface changed while drafts remain intact.
- **Save feedback:** Save status transitions between draft, saving, saved, and error; the saving dot may pulse only while a save is in progress.
- **Tester continuity:** Starting a new test refreshes the thread surface with a short fade/blur transition, and individual messages enter with a compact upward reveal.
- **Mobile savebar:** The savebar enters from the bottom only when there is something to save, saving is in progress, or an error needs attention.
- **Reduced motion:** Spatial movement collapses to near-instant feedback under `prefers-reduced-motion`.

## Shapes

Controls use gently rounded 10px corners. Cards and sheets use 14–20px corners depending on scale. Pills are reserved for status, account, and login inputs. Chat bubbles use asymmetric rounded corners so message ownership is visible without extra labels.

## Components

### Buttons
- **Shape:** Rounded controls (10px), pill where the control is identity/status-like.
- **Primary:** Operational Ink background with white text; used for Save, Continue, Send, and irreversible/commit actions.
- **Secondary:** Paper background, neutral stroke, muted text; used for history, discard, reset, and non-primary actions.
- **Hover / Focus:** Hover slightly darkens the surface; focus uses a visible ink outline with offset.

### Chips
- **Style:** Status pills use semantic backgrounds with matching border/text.
- **State:** Saved/locked is green; draft is amber; neutral active version is paper.

### Cards / Containers
- **Corner Style:** Gently rounded rectangular panels (14px).
- **Background:** Paper surface on canvas, separated by one-pixel rules.
- **Shadow Strategy:** Flat by default; shadow only for overlays and menus.
- **Internal Padding:** Desktop panels use 18–24px; mobile cards use 14–16px.

### Inputs / Fields
- **Style:** White surface, 1px strong neutral border, 12px radius for work fields.
- **Focus:** Ink outline with offset.
- **Prompt Areas:** Monospace, larger line-height, enough vertical room for real instructions.

### Navigation
- **Desktop:** Sticky header only: brand, workspace breadcrumb, agent identity, status, versions, and account.
- **Mobile:** Single-row agent header plus bottom tabs for Edit and Playground. Version history remains reachable from the header.

### Chat
- **Agent Messages:** White bubble with neutral border and a clipped lower-left corner.
- **User Messages:** Near-black bubble with white text and a clipped lower-right corner.
- **Composer:** Centered, rounded input with a square send button on desktop and a pill composer on mobile.

## Do's and Don'ts

### Do:
- **Do** keep the user's current state visible: saved, draft, active version, or locked.
- **Do** keep desktop editing and testing adjacent unless the configuration is locked.
- **Do** use sheets/drawers for mobile details rather than dense desktop controls.
- **Do** reserve semantic color for actual save, draft, error, and locked states.
- **Do** use the prompt type treatment for long editable agent instructions.

### Don't:
- **Don't** introduce new-agent creation, workflow-building, or broad AI-platform navigation.
- **Don't** use decorative color, gradient text, emoji icons, or generic AI-themed ornament.
- **Don't** make locked state visually similar to editable state.
- **Don't** bury version restore behind a hidden desktop-only control.
