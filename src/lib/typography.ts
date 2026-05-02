/**
 * Brand typography stacks for "designed" surfaces — welcome screen,
 * workspace home, sidebar empty state, and any future onboarding /
 * empty-state UI that should read as one coherent identity.
 *
 * These pin Helvetica/Iowan regardless of the user's global font
 * picker (`AppearanceInjector` writes `html, body { font-family: ... }`
 * — the brand utilities below override that for branded surfaces).
 *
 * **Prefer the Tailwind utility classes for JSX:**
 *   - `font-brand-sans`  — for headings, labels, body copy
 *   - `font-brand-serif` — for literary preview / quote text
 *
 * The exported string constants exist for the rare context that needs
 * the raw stack (e.g. canvas rendering, computed-style fallbacks).
 *
 * **Must stay in sync** with the matching `--brand-sans-stack` and
 * `--brand-serif-stack` CSS custom properties in `src/app/globals.css`.
 */

export const BRAND_SANS_STACK =
  '"Helvetica Neue", Helvetica, -apple-system, "SF Pro Text", system-ui, sans-serif';

export const BRAND_SERIF_STACK = '"Iowan Old Style", Palatino, Georgia, serif';
