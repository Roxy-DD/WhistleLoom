# Repository Guidelines

## Project Structure & Module Organization

WhistleLoom is a static, zero-build browser application. Open `index.html` in a modern browser; there is no package manager or server requirement. `app.js` coordinates application state and DOM events. Feature modules live in `js/` (music and score models, notation, import/export, formats, i18n, and tune library); styles are in `css/`, sample score JSON files in `scores/`, and the README screenshot in `assets/`. Node-based checks and fixtures are in `tests/`; helper scripts are in `scripts/`. `js/tune-library.js` is generated—change its source or generator rather than editing it by hand.

## Build, Test, and Development Commands

No build or install step is needed. Run `node scripts/check-i18n.mjs` to check translation keys and untranslated interface text. Run `node --test tests/*.test.cjs` for the Node.js test suite (Node 22 is used in CI). For an optional real-browser regression probe, run `bash scripts/browser-probe.sh`; it requires the documented browser tooling and Chromium. To regenerate the offline tune library, use `node scripts/build-tune-library.mjs 15` (the optional number is pages to fetch).

## Coding Style & Naming Conventions

Use the existing plain JavaScript style: two-space indentation, semicolons, and descriptive camelCase identifiers. Keep browser modules compatible with direct script loading and local `file://` use; avoid adding a build-time or runtime dependency without a clear need. Keep score data in `score.events` and derive all notation layers from that shared model. Follow existing `.test.cjs` naming for tests and keep module boundaries focused on clear inputs and outputs.

## Testing Guidelines

Add or update tests under `tests/` using Node's built-in test runner (`node:test` and `node:assert`). Name files `*.test.cjs`. Cover affected import/export round trips, score validation, notation, or UI-language behavior as appropriate. Before submitting, run both the i18n check and the full test command; CI runs both on pushes and pull requests.

## Commit & Pull Request Guidelines

Recent commits use concise, often scoped, imperative subjects such as `feat(lyric): ...`, `fix(export): ...`, and `docs: ...`. Follow that pattern and keep each commit focused. A PR should explain the user-visible change and rationale, link relevant discussion when available, and include screenshots for visual changes. Note which checks you ran and any limitations.

## Configuration & Generated Files

The application has no secrets or required environment configuration. The only online feature is optional tune lookup; it falls back to the bundled library. Preserve offline operation and avoid introducing absolute asset paths or mandatory network requests.
