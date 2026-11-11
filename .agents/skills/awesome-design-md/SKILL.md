---
name: awesome-design-md
description: Apply the DESIGN.md design system specification from VoltAgent / Google Stitch. Use when auditing, refactoring, or building interfaces to ensure semantic design tokens, cohesive typography scales, surface elevation hierarchy, crisp hairline borders, and consistent design language across all components.
metadata:
  author: voltagent
  version: "1.0.0"
---

# Awesome DESIGN.md - Agent Design System Guidelines

This skill guides the creation, audit, and implementation of interfaces using the **DESIGN.md** design system specification (curated by VoltAgent and initiated by Google Stitch).

## Purpose

A `DESIGN.md` file serves as the single source of truth for design tokens, typography ladders, color schemes, surface elevation, and component patterns so that AI agents produce consistent, production-grade UIs rather than generic or inconsistent styling.

---

## Core Principles

1. **Semantic Color Hierarchy (No Raw/Arbitrary Hex/Tailwind values in components)**
   - **Canvas & Surfaces:**
     - `canvas` (base page background)
     - `surface-1` (cards, sidebars, secondary panels)
     - `surface-2` (nested containers, popovers, active tabs)
     - `surface-3` / `surface-4` (modals, dropdowns, hovered items)
   - **Ink (Typography):**
     - `ink`: Primary high-contrast text
     - `ink-muted`: Secondary metadata, labels, instructions
     - `ink-subtle`: Placeholders, disabled text, tertiary badges
   - **Borders & Dividers:**
     - `hairline`: 1px subtle divider (`border-border` / `border-border/60`)
     - `hairline-strong`: Focus rings or active item borders
   - **Brand & Semantic:**
     - `primary`, `on-primary`, `primary-hover`, `primary-focus`
     - `secondary`, `accent`
     - `semantic-success`, `semantic-error`, `semantic-warning`, `semantic-info`

2. **Strict Typography Ladder & Optical Tracking**
   - Headings must have deliberate tight letter-spacing (`tracking-tight` or negative tracking) and balanced wrapping (`text-wrap: balance` / `text-pretty`).
   - Monospace / Tabular numbers: All monetary amounts, dates, IDs, and financial totals MUST use `tabular-nums` (`font-variant-numeric: tabular-nums`) to ensure alignment in tables and summary cards.
   - Microcopy: Explicit labels, descriptions, and accessible names for all controls.

3. **Physical Depth and Surface Stacking**
   - Distinguish cards from background with subtle hairline borders (`border border-border/70`) and delicate elevation rather than heavy, muddy drop shadows.
   - Group related fields into clear, digestible surfaces.

4. **Component Consistency**
   - **Buttons:** Clearly differentiate primary, secondary, outline, and destructive variants. Always provide hover, active (slight scale down), focus-visible ring, and disabled states.
   - **Inputs & Controls:** Visible label, clear placeholder, explicit focus-visible ring, and accessible error message associated via `aria-describedby`.
   - **Badges & Status Indicators:** Use semantic tones with subdued backgrounds and strong text contrast.
   - **Empty States:** Always provide an informative empty state with actionable guidance.

5. **Accessibility & Usability**
   - High contrast meeting WCAG AA standards.
   - Minimum tap target of 44x44px for touch interactions.
   - Visible keyboard focus rings (`focus-visible:ring-2 focus-visible:ring-offset-2`).
   - Proper ARIA attributes: `aria-label` on icon-only buttons, `aria-hidden="true"` on decorative icons.
