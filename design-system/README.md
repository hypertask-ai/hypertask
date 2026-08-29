# Hypertask Design-System Preview Cards

This directory contains self-contained HTML preview cards for importing into Claude Design as a design-system project.

Each HTML file starts with a `@dsCard` marker, embeds the current light and dark theme variables from `src/styles/tailwindThemes/light.css` and `src/styles/tailwindThemes/dark.css`, and renders light and dark examples side by side.

Token mapping:

- Color, surface, text, border, input, ring, comment, sidebar, and kanban state tokens come from `src/styles/tailwindThemes/`.
- Brand constants come from `tailwind.config.ts`: hypertasks purple, green, header blue, and icon greys.
- Spacing, radius, and shadow examples mirror conventions observed in kanban cards, shared modal helpers, sidebar rows, labels, and comments.

Maintenance rule: change tokens in `src/styles/tailwindThemes/`, then regenerate/edit the matching card, then re-sync to Claude Design.
