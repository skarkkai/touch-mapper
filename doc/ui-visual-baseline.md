# UI visual baseline for main views

This document captures the reference appearance for Touch Mapper's three main user-facing pages.

Use this as a default guide for UI and styling changes unless a task explicitly requests a redesign.

## Global visual language

- Brand color is a bright Touch Mapper green used for primary actions, key panels, and header branding.
- The default page background is white, with dark text and blue links.
- Layout is centered, single-column, and intentionally simple.
- Main interaction flow is vertical and linear: heading, actions, map or form, supporting content.
- Panels and action bars use soft rounded corners and subtle shadows.
- Form controls are simple rectangular inputs/selects with clear labels and predictable placement.
- Visual style should feel practical and trustworthy, not decorative or trend-driven.

## View 1: Address search (`start`)

- Hero section uses a large photo background at the top.
- Header items sit on top of the hero area, with logo at the top-left and language selector plus Help at the top-right.
- A short, high-contrast tagline is centered near the top.
- Intro text appears below the hero image and explains the value proposition in plain language.
- A short three-step "It's simple" sequence uses numbered green circles.
- The main search form is a white card-like row with left label ("Street address"), center text input, and right orange Search button.
- Footer includes OpenStreetMap attribution and an open-source repository link.

## View 2: Settings (`area`)

- Breadcrumb appears at the top (Address search > Settings > Map).
- Main heading is "Map parameters".
- Form uses a clear two-column rhythm: left labels and right controls.
- Controls include radios, checkboxes, dropdowns, and concise helper text.
- Primary call-to-action is a wide bright-green button ("Create tactile map").
- Large draggable map preview sits below form controls.
- Scale indicator is shown under the preview map.
- A smaller green back button appears below the map section.
- Footer keeps map data attribution and repository link visible.

## View 3: Map result (`map`)

- Breadcrumb remains visible at the top for orientation.
- Page title is location-specific ("Map for ...").
- A prominent full-width bright-green download bar is the primary action.
- Secondary download links are grouped in a separate green panel.
- Email-share input and send button appear in a dedicated green panel.
- OpenStreetMap attribution appears before the 3D map preview.
- 3D preview is displayed in a large light-gray rounded container with soft shadow and clearer neutral contrast between layers for readability.
- 3D preview controls hint text below the preview uses black text for stronger readability.
- Map content description follows below as structured text sections.

## Accessibility and UX guardrails

- Keep strong contrast for all text and controls, including inside green action areas.
- Preserve clear heading hierarchy and readable body text spacing.
- Keep labels explicit and near their controls.
- Maintain keyboard accessibility and visible focus states for links, inputs, and buttons.
- Preserve meaningful link/button text so controls are understandable out of context.
- Avoid relying on color alone to communicate state or importance.

## Change policy

- Treat this baseline as the "do not drift" reference for routine UI work.
- If a task intentionally changes this look, update this file in the same change.
- Document which view changed and what visual rule was intentionally revised.
