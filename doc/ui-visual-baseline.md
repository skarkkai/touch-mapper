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
- Language, My Maps, and Help appear as plain-text header controls; the language control has a dropdown triangle. They stack and align right at widths of about 800 px and below.
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
- Additional download links are inside the primary download block behind a "Show more downloads" toggle.
- Email-share input and send button appear in a dedicated green panel.
- OpenStreetMap attribution appears before the 3D map preview.
- 3D preview is displayed in a large light-gray rounded container with soft shadow and clearer neutral contrast between layers for readability.
- 3D preview controls hint text below the preview uses black text for stronger readability.
- Map content description follows below as structured text sections.
- When available, a "Filter map content" button sits directly below the Map content heading, aligned to its left edge and styled like "Show more". Filtering keeps the single-column description and adds checkboxes before its existing sections and entries, with action buttons below. The summary is hidden while filtering so it does not duplicate the editable list. After applying a filter, the editor remains open with the original list and saved selections, including removed entries.

## View 4: Saved maps (`maps`)

- The page heading says that maps are saved in the current browser, followed by one concise browser-storage explanation.
- Search and status/type filters appear together in a light-gray control panel.
- Saved maps use a single-column list of bordered cards; textual identity and status come before any visual enhancement.
- The address starts with an inline heading (or the user's custom name), followed by the remaining address and an accessible pencil button. A trash button sits at the card's top right. Non-ready statuses remain textual; ready maps have no badge.
- Keep the heading's top/bottom spacing compact. The trash control is an unboxed outline icon with a 32 px target, a restrained red-tinted hover state, and visible keyboard focus.
- Details form an unbulleted list with screen-reader-only field labels. Capitalized relative creation/saving dates precede the exact timestamp in parentheses. Size, scale, and printing method share a line. Hide the content-mode row for Normal and for multipart maps, but always retain the printing details.
- Multipart cards always identify themselves and show both X/Y part shifts in percent, including zero. Cards with tracked coordinate edits show the entered latitude/longitude; metre-based offsets are described separately with their reference coordinates. Older records without the coordinate-edit flag cannot retrospectively identify manual coordinate edits.
- Relative timestamps use “A few moments ago” below one minute, elapsed minutes below one hour, elapsed hours below six hours, then local-calendar Today/Yesterday/day counts without an age cutoff. Labels refresh every minute without interrupting screen readers or rebuilding cards.
- Favorite/Unfavorite and Share have decorative star/share icons; Open is the primary action for ready maps. The search field is labeled Search by address (Osoitehaku).
- The primary status-dependent action is visually strongest. Secondary actions wrap cleanly on narrow screens and remain operable by keyboard.
- Share link reveals a visible, selected permanent URL and a separate copy action with textual feedback.
- Destructive history clearing is centered below the map list and uses warning-colored text without relying on color alone.
- Header links have an extra 0.2 em horizontal gap; the current My Maps or Help entry has a 1 px bottom border and `aria-current`.
- A small translated “New” bubble accompanies My Maps only when this browser has saved maps and no recorded library visit. Opening My Maps (even empty) dismisses it across locales and tabs. Clearing the map list does not reset this separate visit marker; clearing browser data can. The hint is plain readable text inside the link, not a separate focus stop or an animated notification.
- While the hint is visible, stack the header controls to leave room for longer translations. On screens up to 450 px wide, also reserve a row above the logo to prevent overlap. Header controls have a visible white keyboard-focus outline.
- Opening the library checks S3 in the background (four requests at most concurrently). A completed map's missing primary STL/SVG removes its reference. Transient errors, permissions errors, and unfinished attempts do not cause deletion. Background updates preserve editors and keyboard focus.
- Known-completed maps check only STL/SVG headers (HEAD), without reloading metadata JSON or downloading output bodies. Other attempts fetch metadata to refresh their processing status and check output headers when newly completed.
- A retry repeats saved settings and individual exclusions under a new ID. Changing settings starts a fresh area request; filtered maps explicitly warn that individual exclusions will reset, because those exclusions depend on the original stored OSM source.

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

The settings preview now follows the requested physical aspect ratio, centered
within the available width and capped at 500 px tall. Its border frames only the
map, with W × H coverage beneath it. Advanced custom size uses two separately
labeled fields with visible keyboard focus. Basic square presets and the square
3D result camera viewport retain their existing layout.

Advanced size controls accept centimetres and inches side by side for each axis,
with unit-specific accessible labels. Values display one decimal on commit; edits
immediately update the other unit. Centimetres remain the canonical request size,
rounded to one decimal when converting from inches (1 inch = 2.54 cm). Native
validation covers both units. The post-rectangular-map “100% X…” explanatory line
has been removed. The card edit control uses the rounded square-pen outline.
