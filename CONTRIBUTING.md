# Contributing to Job Application AutoFill

Thanks for your interest. This is a Chrome MV3 extension —
no build step, no bundler, vanilla JS throughout.

## Getting Started

1. Fork the repo and clone locally
2. Load unpacked in Chrome (`chrome://extensions/` → Developer mode → Load unpacked)
3. Make your changes
4. Reload the extension and test on a live job application

## Code Style

- **ES5-compatible syntax** in `content.js` (no arrow functions, no `let`/`const`,
  no template literals) — must run directly in Chrome without transpilation
- `async/await` is acceptable in `popup.js` only (File System Access API requires it)
- No external dependencies — everything is vanilla JS
- No bundler — all files are self-contained

## Testing

Test fill engine changes against at least one of:
- A Workday application (tests combobox handling)
- A Greenhouse or Lever application (tests standard HTML fill)

Document which platforms you tested in your PR description.

## Adding ATS Support

1. Add fill logic to the appropriate section in `content.js`
2. Add a row to the platform table in `README.md`
3. Document platform-specific quirks in your PR

## Reporting Bugs

Please include:
- The ATS platform and URL pattern (e.g. `*.myworkdayjobs.com`)
- What field wasn't filled / what went wrong
- Browser console output (DevTools → Console on the application page)
- Any `[AutoFill matchQA NEARMISS]` log lines visible in the console

PRs to add support for these are welcome if a workaround is found.
