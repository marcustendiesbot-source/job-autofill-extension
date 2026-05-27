# CLAUDE.md — Claude Code Instructions
# Job Search Project · Job Application AutoFill Extension v4.0

> This file tells Claude Code how to behave when working on this project.
> Read CONTEXT.md for project background and current status.

---

## Project Location

Extension lives at:
```
Desktop/Claude/job-autofill-extension/
```

Files:
- `manifest.json` — Chrome extension manifest (MV3)
- `content.js` — Fill engine, label extractor, field scanner, floating button, job description extractor
- `popup.html` — Side panel UI (3 tabs: Fill, Q&A, Settings)
- `popup.js` — All UI logic, storage helpers, Learn modal, Save Job Post, platform detection
- `background.js` — Opens side panel on icon click
- `icon.png` — Extension icon
- `CONTEXT.md` — Project background and job search status (read this too)

---

## Current Architecture (v4.0)

The extension is **Q&A-only**. There is no stored personal profile, no experience data, no resume parser, no tracker. Everything flows through the Q&A library (`customQA`). Do not add personal data storage back.

**Fill tab:** Fill This Page Now · Learn This Page · Save Job Post  
**Q&A tab:** Browse, add, edit, delete Q&A pairs  
**Settings tab:** Choose save folder · Resume file picker · Claude API key · Profile context · Export Q&A · Import Q&A · Clear All Data

### Fill flow (v4.0 — A→B→C→D)

`doFill()` is an async orchestrator that runs four steps in sequence:

- **Step A — Resume upload:** `_findResumeInput()` scores all `input[type=file]` elements by label/attr/accept signals. Score ≥ 4 uploads; score ≥ 1 uploads only if it's the sole file input; score ≤ 0 skips. `waitForPageSettle()` waits up to 8s (MutationObserver + 800ms debounce) after upload before proceeding. `window.__autofill_resume_uploaded__` session flag prevents duplicate uploads on pages 2+ of multi-page applications.
- **Step B — Q&A fill:** `runFill()` matches Q&A pairs to all form fields. Now returns the list of unfilled fields for use by Step C.
- **Step C — AI Guess:** Unfilled fields are batched to the Anthropic API via `background.js`. Requires a Claude API key saved in Settings. Skipped if no key is set.
- **Step D — AI Review Modal:** AI-suggested answers are shown in the review modal (reuses `learnModal` DOM; header swapped via `learnModalTitle` id) for user confirmation before saving to the Q&A library.

---

## Critical Coding Rules

### 1. React/Vue Input Fields — ALWAYS use native value setter
Standard `el.value = val` does NOT trigger React-controlled field updates.
Always use this pattern:

```javascript
var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
var d = Object.getOwnPropertyDescriptor(proto, 'value');
if (d && d.set) d.set.call(el, val); else el.value = val;
['input', 'change', 'blur'].forEach(function(ev) {
  el.dispatchEvent(new Event(ev, { bubbles: true }));
});
```

This is already implemented in `_setV()` in content.js. Never replace this with a simpler assignment.

### 2. Chrome Extension MV3 Constraints
- No `eval()`, no remote code execution
- Background is a service worker — no DOM access, no persistent state
- Use `chrome.storage.local` for all persistence (not localStorage)
- `chrome.storage.local` is async — always use callbacks or await
- Side panel (not popup) — opened via `chrome.sidePanel.open()`
- Content scripts injected at `document_idle` on all http/https pages

### 3. JavaScript Style
- Use **ES5-compatible syntax** throughout content.js and most of popup.js (var, not let/const; function declarations, not arrow functions)
- Exception: `async/await` is acceptable in popup.js **only** for File System Access API calls (`chooseFolder`, `saveJobPost`)
- No external dependencies or imports — everything is vanilla JS
- All files are self-contained (no bundler, no npm)

### 4. Storage Keys — Never Rename These
| Key | Store | Type | Contents |
|-----|-------|------|----------|
| `customQA` | chrome.storage.local | Array | `[{q: string, a: string}]` — user's Q&A pairs |
| `stats` | chrome.storage.local | Object | `{fillCount: number}` |
| `saveFolderName` | chrome.storage.local | String | Display name of chosen save folder (for UI only) |
| `saveFolder` | IndexedDB (`handles` store) | FileSystemDirectoryHandle | Actual folder handle for file writing |

> `chrome.storage` cannot serialise `FileSystemDirectoryHandle`. That's why the handle lives in IndexedDB and only the name (for display) lives in chrome.storage.

### 5. Field Label Extraction
The `_extractLabel()` function in content.js uses an **11-step fallback chain**. Do not simplify this. Steps in order:

1. `label[for="id"]`
2. `aria-label`
3. `aria-labelledby` (space-separated ID list)
4. `title` attribute
5. `data-label` / `data-field-label` / `data-automation-label`
6. `placeholder`
7. Wrapping `<label>` element
8. Preceding siblings with label-like tag/class
9. Nearest container's label child (covers most ATS field wrappers)
10. Walk up 5 parent levels, look for label-like sibling of the input's branch — checks LABEL/LEGEND/class-based elements, **`<td>`/`<th>` without child inputs** (catches table-layout forms like Avature/RBC where label text sits in an adjacent table cell), **and** short-text `<a>`, `<span>`, `<p>`, `<strong>` (catches consent checkbox labels rendered as links, e.g. "Terms and Conditions")
11. `name` / `id` humanised as last resort

`_lbl()` is the lowercase wrapper used by the fill engine. `_extractLabel()` is the case-preserving version used by the scanner.

### 6. Learn This Page — Field Types Scanned
`scanUnknownFields()` in content.js scans four categories:
1. Standard `input` / `textarea` / `select` elements
2. **Radio/checkbox groups** — via `fieldset`/`legend` and `[role="radiogroup"]` / `[role="group"]`; captures the group label and all option labels
3. **Rich text components** — `[contenteditable="true"]`, `[role="textbox"]`, `[role="combobox"]`, `[role="spinbutton"]`
4. **Workday combobox dropdowns** — `[data-automation-id^="formField"]` containers with `button[aria-haspopup="listbox"]`; opens each dropdown via `btn.click()`, reads options scoped to the specific listbox via `btn.getAttribute('aria-controls')`, then closes via body mouse events (see Rule 10 below)

### 7. Q&A Matching Logic

**`_wt(text)`** — word tokenizer used throughout matching (defined after `_lbl` in content.js):
```javascript
function _wt(text) {
  return text.split(/[\s\/\(\)]+/).map(function(w){ return w.replace(/^\W+|\W+$/g,''); }).filter(Boolean);
}
```
Splits on whitespace, slashes, **and parentheses**; strips leading/trailing non-alphanumeric. Critical for: "veteran/military" → `["veteran","military"]`, "(first" → `["first"]`, **`location(s)` → `["location","s"]`**, **`member(s)` → `["member","s"]`**. Always use `_wt()` instead of `split(/\s+/)` when tokenizing.

**`matchQA(lbl)`** — used by the fill engine to find a Q&A pair for a given field label:

1. **Truncate Q to first `?`** (exclusive — `substring(0, qi)`, NOT `qi + 1`) before all gating and scoring.
2. **Short-Q fallback**: if the truncated Q has no words >3 chars (e.g. stored Q is "Sex" or "Age"), fall back to a **word-boundary** substring check — match only when the Q text appears as a whole word in the label. Prevents "sex" from matching "sexual orientation".
3. **Forward gate**: >40% of Q words (from truncated Q) must appear in the full label **starting at a word boundary** (preceding char must be non-word or start-of-string). Uses a while-loop indexOf check — not a simple substring — so `"city"` cannot match inside `"capacity"` (preceded by `"a"`), but `"child"` still matches `"children"` (preceded by space). Both `matchQA` and `isKnown` use this approach.
4. **Stop-word-only Q guard**: if the Q has no content words (all STOP/short words) but the label does, score = 0. Prevents bare STOP-word Qs like `"From"` from falsely matching long labels that happen to contain "from".
5. **Numeric guard**: if both Q and label contain number tokens, they must share at least one.
6. **Dice coefficient** on content words (words >3 chars, excluding STOP words). Uses **prefix-aware intersection**: a Q word matches a label word if one is a prefix of the other (`"veteran"` matches `"veterans"`, `"child"` matches `"children"`). Threshold: **Dice > 0.5** to return a match.

**`isKnown(lbl)`** — same logic as matchQA plus a **reverse gate**: if >40% of label words appear in the Q (also using word-boundary check), the pair also passes. Handles verbose stored Qs matched against short labels like "Email". Logs `[AutoFill isKnown MISS/HIT]` to console.

**NEARMISS logging**: when `matchQA` fails (best score ≤ 0.5) but at least one Q passed the forward gate, logs `[AutoFill matchQA NEARMISS] label="..." bestScore=X nearQ="..."` — essential for diagnosing why a field isn't filling.

**STOP words** (excluded from content scoring): what, your, are, is, do, you, the, have, been, will, can, for, any, this, that, with, from, has, was, were, not, but, and, our, did, ever.

**Option matching in `_setS()`, `fillNextCombo()`, and `fillNextSAP()`** — three passes in order:
1. **Exact / synonym match** — case-insensitive exact match OR `_normOpt(optText) === _normOpt(ansLower)` (see below).
2. **Starts-with** (either direction) — avoids "female".includes("male") false hit.
3. **Dice word-overlap** (threshold > 0.5) — handles cross-platform wording differences, e.g. "Master's Degree" matching "(Master's Degree (±18 years))".

**`_normOpt(s)`** — module-level option synonym normalizer (defined near `_wt` in content.js). Maps common synonym clusters to a canonical form so stored answers match page options regardless of which platform's wording was saved:
- `"man"` / `"male"` / `"men"` → all match each other
- `"woman"` / `"female"` / `"women"` → all match each other
- All "prefer not to say" / "prefer not to answer" / "I do not wish to self-identify" / "decline to state" / "choose not to disclose" variants → all match each other

To add a new synonym pair: add both directions to `_OPT_NORMS` in content.js (or add both to the same canonical value).

**Do not** add back a single-word fuzzy match (e.g. "career" matching "Career Fairs and Events") — this was removed after it caused "Career Site: BMO Careers (Canada)" to fill the wrong option on RBC.

**Site-specific Q&A pitfall**: answers learned from one ATS often contain platform-specific text that breaks matching on other platforms. Watch for: Workday wraps dropdown options in parentheses with year/level annotations; "How Did You Hear About Us?" answers are always site-specific. When an answer fails on a new site, update it to the most generic form that matches via Dice.

### 8. Save Job Post — How It Works
- Button in Fill tab sends `{action: 'getJobDescription'}` to content script
- Content script returns `{title, company, descText}` — all three fields used by popup
- File is named **`"Company-Title-YYYY-MM-DD.txt"`** (company prefix omitted if blank) and written via File System Access API
- `generateJobPostTxt()` in popup.js builds a plain text file with a `====` separator header including a `Company:` line
- Folder handle retrieved from IndexedDB via `_getFolderHandle()`; permission re-requested each session via `handle.requestPermission({mode:'readwrite'})`

**Company extraction** — 6-step cascade in `getJobDescription()`, all steps filtered through `_isATS()` blocklist so ATS platform names (Dayforce, Workday, Greenhouse, etc.) are never saved as the employer:
1. `script#__NEXT_DATA__` → `candidateCorrespondenceClientName` (Dayforce) or `clientName`/`employerName`/etc.
2. JSON-LD `hiringOrganization.name`
3. `meta[property="og:site_name"]`
4. `img[alt]` containing "logo" or inside header/brand containers
5. Common DOM selectors: `[class*="company-name"]`, `[class*="employer-name"]`, etc.
6. Page `<title>` — part after `|` or `—`

**Description selectors** (tried in order, requires ≥ 200 chars):
`[class*="job-description"]`, `[id*="job-description"]`, `[class*="jobDescription"]`, `[id*="jobDescription"]`, `[class*="job-details"]`, `[id*="job-details"]`, `[class*="jobDetails"]`, `[id*="jobDetails"]`, **`[class*="job-desc"]`** (Fidelity), `[id*="job-desc"]`, `[data-automation="jobAdDetails"]`, `[data-testid*="job-description"]`, `[class*="description__text"]`, `[class*="jobs-description"]`, `[class*="main-panel"]`, `[class*="js_views"]` (Taleo/Oracle), `section.content`, `main`, `article`.

**Workable pre-check** (runs before selector loop): collects `[data-ui="job-description"]`, `[data-ui="job-requirements"]`, `[data-ui="job-benefits"]` and concatenates them. Without this, the generic `[id*="job-description"]` hits a 11-char `<h2>` heading (skipped), then `main` wins with 6800+ chars of UI chrome included.

**Multi-article fallback** (Taleo): if no single element qualifies, all `<article>` elements with ≥ 150 chars are concatenated with `\n\n`.

**Iframe guard — `getJobDescription` must only respond from the top frame.** With `all_frames: true`, the content script runs in every iframe. `chrome.tabs.sendMessage` fires the `onMessage` handler in ALL frames simultaneously — whichever frame calls `sendResponse` first wins. Pages with iframes (e.g. Workable) result in the iframe responding first with empty `{title, company, descText}`, producing a blank txt file. Fix already in content.js: `if (window === window.top) sendResponse(getJobDescription());` — never remove this guard.

### 9. SAP SuccessFactors Picklist Dropdowns — How to Fill
SAP uses `input.rcmpaginatedselectinput` elements that are **read-only** — the JUIC framework immediately overrides any value set via `_setV()`. Must use button-click → wait → option-click approach.

**Button ID pattern:** the input ID is `{N}:_input`; the button ID is `{N}:_selectButton`. Replace `_input` with `_selectButton` in the input's ID.

**Filling sequence:**
1. Find all `input.rcmpaginatedselectinput` with a matching `_selectButton` and no current value.
2. For each: call `matchQA` on the input's label; if matched and answer is non-blank, click the button.
3. Wait **200ms** for JUIC to render options asynchronously as `[role="option"]` elements.
4. Match the answer using the same three-pass logic (exact → starts-with → Dice > 0.5).
5. Click the winning option. Then wait 200ms before processing the next field.

**Null check:** always `if (!btn) { fillNextSAP(); return; }` before calling `btn.click()` — some inputs may not have a button sibling if the field is disabled.

**Closing:** SAP JUIC closes the dropdown automatically when an option is clicked. Escape key is unreliable; avoid it.

**Already-filled check:** `if (inp.value && inp.value.trim()) return false` — skip inputs that already have a value.

**Section ordering:** SAP fill (Section 5) runs after Workday combos (Section 4). `fillNextCombo()` calls `fillNextSAP()` when done; `fillNextSAP()` calls `callback(count)` when done.

### 10. Workday Combobox — How to Open and Close
Workday uses portal-rendered listboxes: the `<button aria-haspopup="listbox">` is inside `[data-automation-id^="formField"]` but the `[role=listbox]` is rendered at the document root (not inside the formField). They are linked via `btn.getAttribute('aria-controls')` → listbox element ID.

**Opening:** `btn.click()` — the listbox renders synchronously, options are immediately available.

**Reading options:** Prefer scoping to the specific listbox via `aria-controls`. **Important:** `aria-controls` is set by React only AFTER the button is clicked — it is `null` before. Always read it inside the post-click `setTimeout`. If `aria-controls` is null even after the click (observed on some Workday versions), fall back to the first visible `[role=listbox]` in the document:
```javascript
var listboxId = btn.getAttribute('aria-controls');
var listboxEl = listboxId ? document.getElementById(listboxId) : null;
if (!listboxEl) {
  var allLbs = document.querySelectorAll('[role="listbox"]');
  for (var li = 0; li < allLbs.length; li++) {
    var s = window.getComputedStyle(allLbs[li]);
    if (s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0') {
      listboxEl = allLbs[li]; break;
    }
  }
}
```

**Closing — ONLY this works:**
```javascript
['mousedown','mouseup','click'].forEach(function(ev) {
  document.body.dispatchEvent(new MouseEvent(ev, {bubbles: true, cancelable: true}));
});
```
Escape key (dispatched to document, listbox, or button) does NOT close Workday dropdowns. Clicking the button again does NOT reliably toggle it closed. Body mouse events are the only reliable close method.

**Pre-scan:** Always run the body mouse event sequence once before scanning to close any dropdowns left open from a previous scan.

**Already-filled check:** Before opening a combobox during fill, check `ff.querySelector('input').value` — if it has a UUID value, the field is already filled; skip it.

### 11. Cross-Origin Iframe Relay
Some ATS platforms (e.g. Comeet used by eToro) embed their application form inside a **cross-origin iframe**. `chrome.tabs.sendMessage` only reaches the main frame. The fix:

- **Manifest:** `"all_frames": true` in `content_scripts` — content script now runs in every frame including cross-origin iframes.
- **Main frame:** `_relayToIframes(action, payload, callback)` — sends a tagged postMessage to all child iframes, collects results via `window.addEventListener('message', ...)`, times out after 2500ms.
- **Iframe side:** a `window.addEventListener('message', ...)` listener checks for `_RELAY_TAG = '__autofill_relay_v1__'` and dispatches `runFill` or `scanUnknownFields`, then posts the result back to `event.source`.
- Fill count and Learn fields from all iframes are merged into the main frame totals before `sendResponse`.

### 12. Manifest — Ask Before Modifying
`manifest.json` changes can break the extension install. Always confirm with user before:
- Adding new permissions
- Changing `matches` patterns
- Modifying `host_permissions`
- Changing `all_frames` (currently `true` — required for cross-origin iframe fill; do not remove)

---

## Workflow Rules

- **Always read both CLAUDE.md and CONTEXT.md** at the start of every session
- **Never modify multiple files at once** without listing what you're changing and why
- **Test instructions**: After code changes, tell the user exactly what to do in Chrome to test (e.g. "go to chrome://extensions, click Reload, then navigate to X")
- **Before suggesting a new feature**: check if it conflicts with MV3 constraints or existing storage keys
- **If a bug involves Dayforce, LinkedIn, RBC, or SAP SuccessFactors**: these domains are blocked for Claude in Chrome extension — use web search to retrieve posting details as a workaround
- **"Cannot reach page — try refreshing it"**: this means the content script isn't running on the active tab. After reloading the extension at `chrome://extensions`, the user must also press **F5** to refresh the job application tab before the new content.js takes effect

---

## Known Platform Notes

| Platform | Notes |
|----------|-------|
| Dayforce (dayforcehcm.com) | React-controlled fields; requires native value setter + event dispatch; "Apply Without an Account" button needs coordinate-based clicking. **Blocked domain** for Claude in Chrome extension. |
| LinkedIn (linkedin.com/jobs) | **Blocked domain** for Claude in Chrome extension. |
| RBC Avature (jobs.rbc.com) | **Blocked domain** for Claude in Chrome extension AND Claude in Chrome MCP. Computer-use screenshots (read-only) are the only way to view page content. Standard HTML `<select>` dropdowns throughout — fill engine works once Q&A pairs are tuned. **Table layout:** field labels live in adjacent `<td>` elements — handled by step 10 TD/TH fix (session 9). **Resume upload:** Avature's upload widget (Dropbox / Google Drive / local file button) does not expose a reliable native `input[type="file"]`; programmatic upload via DataTransfer is not supported — user must upload resume manually. **"How did you hear about us?"** is pre-selected to "Job Board" by default — must add Q&A entry to override it. |
| SAP SuccessFactors (career17.sapsf.com) | **Blocked domain** for Claude in Chrome extension AND Claude in Chrome MCP. Computer-use screenshots (read-only) are the only way to view page content. Uses `rcmpaginatedselectinput` custom picklist widget — `_setV()` is useless (JUIC overrides it immediately). Fill via Section 5: click `_selectButton` → wait 200ms → click matching `[role=option]`. See Rule 9 for full protocol. |
| Workday (*.myworkdayjobs.com) | Two input types: (1) standard React text inputs — use `_setV()`; (2) custom combobox dropdowns — use button click + `aria-controls` scoped option selection. See Rule 10 for full combobox protocol. Hidden UUID inputs inside combobox formFields must be skipped (detected by: no `id`, no `name`, sibling `button[aria-haspopup]`). Labels are in `fieldset > legend` on some Workday instances (e.g. Fidelity) — `fillNextCombo` uses `ff.querySelector('legend') \|\| ff.querySelector('label')` which handles both. `aria-controls` on combobox buttons is null BEFORE click and only set after — always read inside the post-click setTimeout. |
| Fidelity (wd1.myworkdayjobs.com/fmr/FidelityCareers) | Standard Workday with US-specific screening questions and EEO page (Gender / Veterans Status / Ethnicity comboboxes). Label structure uses `fieldset > legend` — handled by `fillNextCombo`. `[class*="job-desc"]` selector needed for Save Job Post (Fidelity article class: `fcs-job-desc__content`). |
| Workable (apply.workable.com) | Job description page uses `[data-ui="job-description"]`, `[data-ui="job-requirements"]`, `[data-ui="job-benefits"]` sections — concatenate all three for Save Job Post. The generic `[id*="job-description"]` selector hits a `<h2>` with 11 chars (skipped) then falls through to `<main>` (6800+ chars including UI chrome). Also has 1 iframe — without the `window === window.top` guard in the `getJobDescription` handler, the iframe responds first with empty data. Both fixes applied in session 7. |
| Comeet (comeet.com iframes) | Embeds application form in a cross-origin iframe. Requires `all_frames: true` in manifest and the postMessage relay system (Rule 11). Confirmed at eToro careers. |
| Greenhouse, Lever, Ashby | Standard HTML forms — fill engine works reliably. |

---

## What NOT to Do

- Do not add Profile, Personal, Experience, Resume, or Tracker tabs back — intentionally removed in v3.0
- Do not add a "How did you hear about this job?" field back — removed intentionally; handle via Q&A if a specific site needs it
- Do not add an Anthropic/Claude API key to any file — user handles AI features separately
- Do not use `innerHTML` with unsanitized user input — always use `escHtml()` from popup.js
- Do not suggest publishing to Chrome Web Store — extension is distributed via GitHub (public beta at https://github.com/marcustendiesbot-source/job-autofill-extension); load unpacked only
- Do not store the `FileSystemDirectoryHandle` in `chrome.storage` — it cannot be serialised there; use IndexedDB
- Do not save job posts as `.html` — use `.txt`; HTML depends on external site assets that disappear when postings close
- Do not require a non-empty answer in the Learn modal or Q&A add form — blank answers are valid (e.g. middle name = none, address line 2 = none) and must be saveable so the field is recognised as known on future visits
- Do not add a non-empty guard to the answer field in `addQA()` — the guard must be `if (!q)` only; blank answers are valid (e.g. middle name, address line 2) and must be saveable so fields are recognised as known on future visits
- Do not delete a Q&A item from storage in `editQA()` — populate fields and set `_editingOrigQ`, then only remove the old entry in `addQA()` when the new entry is confirmed saved (current implementation uses `_editingOrigQ` tracking; do not revert to splice-on-edit)
- Do not remove `all_frames: true` from the manifest content_scripts — it is required for cross-origin iframe fill (e.g. Comeet/eToro)
