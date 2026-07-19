# Branding

Runtime branding for the web app and companion is centralized in [`brand.config.js`](brand.config.js).

To rebrand:

1. Change `name`, `colors.vibe`, `colors.step`, and the CSS-colored `web.wordmarkText` parts in `brand.config.js`.
2. Add replacement assets and set their paths in the same file:
   - Web assets belong in `public/` and use root-relative paths such as `/brand-icon.png`.
   - `web.icon` controls the browser icon, while optional `web.headerIcon` and `web.wordmark` assets control the in-app header.
   - Companion assets belong in `desktop/` and use repository-relative paths such as `desktop/brand-icon.png`.
   - `companion.iconPng` and `companion.iconIco` control the app/window icons. Optional `companion.headerIcon` and `companion.wordmark` assets control the companion header.
3. Run `npm test`, `npm run lint`, `npm run build`, and `npm run companion:pack`.

When a wordmark path is `null`, that surface renders the configured brand name as text. When an icon path is `null`, the old icon is omitted instead of leaking previous branding.

Do not rename compatibility identifiers as part of a visual rebrand. Existing `beat-fiend` storage schemas, IndexedDB names, pairing fragments, hosted URLs, repository names, application IDs, and installer artifact names preserve user data, pairing, updates, and old import support. Migrate those separately only with an explicit compatibility plan.
