# Web Interface Guidelines Rules

Concise, high signal-to-noise rules for UI code review and implementation.

## 1. Accessibility (a11y)
- **Icon-only buttons:** Must have `aria-label` or `<VisuallyHidden>` text.
- **Form controls:** Need `<label htmlFor="...">` or `aria-label`.
- **Keyboard navigation:** Interactive elements must have keyboard handlers or be native interactive elements (`<button>`, `<a>`, `<input>`, `<select>`).
- **Semantic HTML:** `<button>` for actions, `<a>`/`<Link>` for navigation (never `<div onClick>`).
- **Images:** Need meaningful `alt` attribute (or `alt=""` if strictly decorative).
- **Decorative icons:** Must include `aria-hidden="true"`.
- **Async updates & alerts:** Dynamic status, toasts, and validation messages need `aria-live="polite"` or `role="alert"`.
- **Headings hierarchy:** Order logically `<h1>` through `<h6>`.
- **Skip link:** Provide skip-to-content links for accessibility.

## 2. Focus States
- **Visible focus:** All interactive elements must have visible focus (`focus-visible:ring-2 focus-visible:ring-offset-2`).
- **Never suppress outlines without replacement:** Avoid `outline-none` unless accompanied by a visible focus ring.
- **Use `:focus-visible` over `:focus`:** Avoid showing ring on mouse click.
- **Compound controls:** Use `:focus-within` for composite input wrappers.

## 3. Forms & Inputs
- **Autofill attributes:** Provide `name`, `type`, `autocomplete`, and appropriate `inputmode` (e.g., `decimal`, `numeric`, `email`).
- **Clickable labels:** Associated via `htmlFor` or wrapping.
- **No blocking paste:** Never prevent paste in text or numeric inputs.
- **Placeholders:** Use `…` (horizontal ellipsis character) not `...`.
- **Inline errors:** Provide error messages adjacent to inputs and associate via `aria-describedby` or `aria-errormessage`.
- **Prevent accidental data loss:** Warn or prompt before leaving with unsaved changes.

## 4. Typography & Numbers
- **Tabular figures:** Use `tabular-nums` (`font-variant-numeric: tabular-nums`) for currency amounts, dates, calculation counters, and financial tables.
- **Typography details:** Use typographical ellipsis `…` instead of three dots `...`. Use curly quotes `“` `”` or proper quotes where applicable.
- **Heading balancing:** Apply `text-wrap: balance` or `text-pretty` to prevent orphan words (widows).
- **Non-breaking spaces:** For currency prefixes (`S/&nbsp;100`) or key shortcuts.

## 5. Animation & Motion
- **Respect reduced motion:** Always provide `motion-reduce:transition-none` or respect `prefers-reduced-motion`.
- **Properties to animate:** Animate `transform` and `opacity` only (avoid animating `height`, `width`, `top`, `margin` directly without spring/layout measurement).
- **Never `transition: all`:** Explicitly declare transitions (e.g. `transition-colors`, `transition-transform`, `transition-opacity`).
- **Short duration:** Micro-interactions should be between 100ms and 200ms.

## 6. Layout & Responsiveness
- **Flex child safety:** Use `min-w-0` on flex items with truncatable text.
- **Overflow management:** Prevent horizontal viewport scrolling (`overflow-x-hidden`).
- **Touch targets:** Minimum 44x44px interactive hit area for mobile.
- **Touch action:** Set `touch-action: manipulation` to eliminate 300ms tap delay.
- **Safe areas:** Account for mobile safe area insets (`env(safe-area-inset-bottom)`).

## 7. Performance & State
- **URL synchronization:** Keep core state (or active tabs/filters) synchronized or shareable where applicable.
- **Destructive actions:** Require explicit confirmation or dialog before permanent deletion.
- **No layout thrashing:** Avoid reading layout geometry in render loops.
