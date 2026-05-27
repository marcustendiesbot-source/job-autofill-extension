# CONTEXT.md — Job Search Project
# Andrei · Toronto, ON · Last updated: May 2026 (session 8)

> This file is the source of truth for Andrei's job search project.
> For coding rules and extension behaviour, see CLAUDE.md.

---

## Who I Am

**Name:** Andrei  
**Location:** Toronto, ON, Canada  
**Current Role:** Manager, Change Oversight — TD Bank (started May 2025)  
**Previous Role:** Senior Risk Analyst — National Bank of Canada / NBIN  

### Credentials
- MBA — Schulich School of Business, York University (2020)
- BA Economics — University of Toronto
- CFA Level 1
- CSI Certifications: CSC, CPH, DFOL, AOS

---

## Job Search Goals

**Targeting:** Manager-level and above, full-time positions  
**Markets:** Canada (primary) and United States  
**Sectors:**
- Big 6 Banks (TD, RBC, BMO, Scotiabank, CIBC, NBC)
- Discount brokerages (Questrade, Wealthsimple, Interactive Brokers, etc.)
- Fintech / crypto / digital assets
- Asset managers and hedge funds
- Pension funds
- Credit unions

**Function areas:** Risk management, compliance, change management, operations, oversight roles in financial services

---

## Application Tracker

| Company | Role | Status | Notes |
|---------|------|--------|-------|
| Questrade | Senior Manager, Compliance | Applied | Dayforce posting; completed questionnaire + "Your Time to Shine" response; salary expectations submitted |
| RBC | Product Controller (R-0000167553) | In Progress | Avature (jobs.rbc.com); session 9 live test — Phone Device Type fixed, "How did you hear" needs Q&A entry (Corporate Website), resume upload not automatable on Avature |
| RBC | Manager, Financial Instruments & Securities Reporting (R-0000172085) | In Progress | Avature (jobs.rbc.com); same platform fixes apply |
| Scotiabank | (role TBD) | Not Applied — Testing Only | SAP SuccessFactors (career17.sapsf.com); used as test case for SAP picklist fill in session 4 |
| Fidelity | Digital Assets Risk Manager - Crypto & Blockchain | In Progress | Workday (wd1.myworkdayjobs.com/fmr/FidelityCareers); US-specific screening Qs; EEO page tested in session 5 |
| moomoo (Futu US Inc.) | VP, Trading Surveillance Compliance | Saved / Reviewing | Workable platform (apply.workable.com); Jersey City NJ; NASDAQ SMARTS experience required; salary $120k–$160k; used as test case for Workable Save Job Post fix in session 7 |

| (next application) | (role) | Pending | v4.0 flow: resume upload + Q&A fill + AI guess |

*Update this table as new applications are submitted.*

---

## Target Company Lists

A comprehensive tiered target company list has been built and exported as a formatted Excel file including:
- Priority tiers (Tier 1 / Tier 2 / Tier 3)
- Direct career page URLs
- LinkedIn Jobs links
- Tracking columns (applied, interview, offer, etc.)

File location: *(update with actual path)*

---

## Tools & Workflow

### Job Application AutoFill Chrome Extension
- **Version:** 4.0 (public release tag: v1.0.0)
- **GitHub:** https://github.com/marcustendiesbot-source/job-autofill-extension (public beta — live)
- **Location:** `Desktop/Claude/job-autofill-extension/`
- **Install:** `chrome://extensions/` → Developer Mode → Load Unpacked
- **Purpose:** Auto-fills ATS job application forms using saved Q&A pairs
- **UI:** Side panel with 3 tabs — Fill, Q&A, Settings
- **Key features:**
  - `⚡ Fill This Page Now` — matches Q&A pairs to form fields using Dice coefficient + word-boundary matching
  - `🧠 Learn This Page` — scans unfilled fields and saves answers as Q&A pairs; captures standard inputs, radio/checkbox groups, Workday comboboxes, and contenteditable fields
  - `📄 Save Job Post` — saves the current job posting as a `.txt` file to a user-chosen local folder, named `"Company-Title-YYYY-MM-DD.txt"`
- **Settings tab:** Choose save folder (persisted via File System Access API + IndexedDB), export/import/clear Q&A data
- See `CLAUDE.md` for all technical details

### Indeed MCP Tool (in Claude.ai)
- Best results: specific role titles + sector terms (e.g. "risk manager brokerage fintech")
- Searching by company name directly = more targeted than broad sector searches
- Canadian searches: `country_code "CA"`, location `"Toronto, ON"`
- US searches: `country_code "US"`, location `"New York, NY"` or `"remote"`
- Run 8–10 parallel query variations for comprehensive coverage

### Claude in Chrome Extension
- Used for navigating and filling Dayforce job applications
- **Blocked domains** (no screenshot, no JS, no page text): `jobs.rbc.com`, `career17.sapsf.com` (SAP SuccessFactors), `jobs.dayforcehcm.com`, `linkedin.com`
- For blocked domains: use web search to retrieve job posting details as a workaround

---

## Key Technical Decisions (Do Not Undo)

| Decision | Reason |
|----------|--------|
| React-aware native value setters for all input fills | Standard `el.value =` does not trigger React-controlled field updates on Dayforce/Workday |
| ES5 syntax throughout content.js and popup.js | No bundler; must run directly in Chrome without transpilation |
| `async/await` allowed only in popup.js | Required for File System Access API (folder picker + file write) |
| 11-step label extraction chain in `_extractLabel()` | Different ATS platforms use completely different DOM structures for field labels |
| Radio/checkbox groups scanned via `fieldset`/`legend` and `role="radiogroup"` | Many ATS authorization and EEO questions are radio groups, missed by input-only scanning |
| Side panel (not popup) architecture | Better UX for long sessions; stays open while navigating application pages |
| 3-tab UI (Fill / Q&A / Settings) | Intentional simplification; Profile/Personal/Experience/Resume/Tracker tabs removed |
| Dice coefficient + word-boundary forward gate for Q&A matching | Handles label wording variations across ATS platforms while preventing false positives |
| Job posts saved as `.txt` not `.html` | HTML depends on external site CSS/images; `.txt` is fully self-contained and always readable |
| File System Access API handle stored in IndexedDB | `chrome.storage` cannot serialise `FileSystemDirectoryHandle` objects |
| No "How did you hear" field | Removed — too site-specific; handle via Q&A pairs if needed |
| `all_frames: true` in manifest | Required for cross-origin iframe fill (Comeet/eToro and similar platforms) |
| ArrayBuffer transfer for resume file | FileSystemFileHandle not serialisable via chrome messages; read file to ArrayBuffer in popup, reconstruct File in content script |
| `doFill()` async orchestrator | Runs A→B→C→D in sequence; each step awaits chrome.tabs.sendMessage; no callbacks-within-callbacks |
| `showAIReviewModal` reuses learnModal DOM | Same modal structure, pre-populated with AI answers; header text swapped dynamically via `learnModalTitle` id |
| `waitForPageSettle` uses MutationObserver + debounce | 800ms quiet period after resume upload, hard cap 8s, fallback 1.5s if no mutations |
| Scored resume input detection (`_findResumeInput`) | Scores all file inputs by label/attr/accept signals; score ≥ 4 uploads, score ≥ 1 only if sole file input, score ≤ 0 skips; prevents injecting resume into cover letter or photo fields |
| `window.__autofill_resume_uploaded__` session flag | One-way latch set after successful upload; prevents duplicate uploads on pages 2+ of multi-page applications |
| Module-level `matchQA(lbl, customQA)` and `isKnown(lbl, customQA)` | Extracted from closures inside `runFill`/`scanUnknownFields`; now callable by `applyAIGuesses` for fuzzy label matching of AI responses |

---

## How to Use Claude Efficiently Across Surfaces

### Claude.ai Projects (this surface)
Best for: strategy, research, writing, feature design, Q&A improvements, cover letters, company research.

### Claude Code
Best for: actually writing and debugging extension code.
- CLAUDE.md loads automatically every session (it's Claude Code's native config file)
- Start each session with: `"Read CONTEXT.md before we begin"`

### Keeping in Sync
- Update CONTEXT.md whenever application status changes or significant project decisions are made
- Update CLAUDE.md only when coding conventions, architecture, or platform behaviour changes
- Neither surface reads the other's conversation history — these files ARE the shared memory

---

## ⚠️ Critical Warning — Duplicate Extension Instances

**Never load the extension from two different paths at the same time.**

Chrome assigns a different extension ID to each path it is loaded from. Each ID gets its own isolated `chrome.storage.local` — Q&A data saved under one ID is invisible to the other.

In session 7, two instances were simultaneously loaded:
- `jamhbonpjebioigagkbmeiegoediplfj` — `C:\Users\andre\OneDrive\Desktop\Claude\job-autofill-extension` (OneDrive sync copy)
- `mdacjcmdcgdljejlbmjnolhppjdalhlp` — `C:\Users\andre\Desktop\Claude\job-autofill-extension` (working copy)

All 131 Q&A pairs were stored under the OneDrive ID. Reloading switched to the Desktop ID, which had empty storage.

**Fix:** Go to `chrome://extensions` and remove any duplicate entries for the autofill extension. Only the Desktop path (`C:\Users\andre\Desktop\Claude\job-autofill-extension`) should be loaded. The Q&A data was recovered and saved to `Desktop\qa_restore.json` — import via Settings → Import Q&A if not yet done.

---

## Known Bugs (Fix Before Next Feature Work)

| Bug | Status |
|-----|--------|
| Blank answer blocked in `addQA()` | FIXED — guard changed to `if (!q)` only |
| Edit causes data loss in `editQA()` | FIXED — `data-edit-idx` / `_editingOrigQ` pattern; old entry removed only on confirmed save |

---

## Notes & Decisions Log

- **May 2026 (sessions 1–2):** Extension rebuilt from 8 tabs to 3 tabs (Fill, Q&A, Settings). Q&A-only architecture. Save Job Post and Learn This Page features added. Workday combobox handling added. Version 3.0.
- **May 2026 (session 3):** RBC Avature testing. Matching engine overhauled — Dice coefficient, word-boundary forward gate, short-Q fallback, `?` truncation, blank answer support. See CLAUDE.md Rule 7.
- **May 2026 (session 4):** Scotiabank SAP testing. SAP JUIC picklist fill added (Section 5 in runFill). `_wt()` tokenizer added. See CLAUDE.md Rule 9.
- **May 2026 (session 5):** Fidelity Workday testing. Save Job Post updated with company extraction and `Company-Title-Date.txt` filename. Cross-origin iframe relay added. `_normOpt()` synonym normalizer, NEARMISS logging, Dice prefix-aware intersection, stop-word guard. See CLAUDE.md Rules 7, 8, 11.
- **May 2026 (session 6):** Documentation review. Identified gap: content.js still reflects v2 matching engine despite sessions 3–5 improvements being documented in CLAUDE.md. Two popup.js bugs identified: blank answer guard in `addQA()`, data loss in `editQA()`. Both logged above in Known Bugs.
- **May 2026 (session 9):** RBC Avature live testing. Fixed `_extractLabel()` step 10 to handle `<td>`/`<th>` table-layout labels (was missing "Phone Device Type" and any Avature field in table structure). Diagnosed "How did you hear about us?" fills with "Job Board" — it's Avature's page default, not a Q&A match (matchQA=NONE); fix is to add Q&A entry. Confirmed Avature resume upload widget cannot be automated via DataTransfer — no reliable native file input. GitHub public launch: scrubbed personal data, wrote README/CONTRIBUTING/LICENSE, git init + v1.0.0 tag, pushed to https://github.com/marcustendiesbot-source/job-autofill-extension (public).
- **May 2026 (session 8):** v4.0 implementation. Full fill flow orchestrator: Step A (resume upload via ArrayBuffer transfer, scored `_findResumeInput`, `waitForPageSettle` MutationObserver), Step B (Q&A fill now returns unfilled field list), Step C (AI Guess batched to Anthropic API via background.js), Step D (AI Review Modal reuses learnModal DOM). `matchQA` and `isKnown` extracted to module level so `applyAIGuesses` can call them. Settings tab: resume file picker, API key (password field + save), profile context textarea (pre-populated with Andrei's default). `doFill()` replaced with async A→B→C→D orchestrator.
- **May 2026 (session 7):** Fixed Save Job Post for Workable: (1) description now collects `[data-ui="job-description|job-requirements|job-benefits"]` instead of falling through to `<main>`; (2) `getJobDescription` handler now guards `if (window === window.top)` to prevent iframe responses winning the race. Bug audit: Bug 1 (blank answer) and Bug 3 (matching engine) were already resolved in code; Bug 2 (editQA data loss) fixed — `editQA()` no longer deletes from storage prematurely; `addQA()` removes old entry by Q text only on confirmed save via `_editingOrigQ`. Q&A data loss incident: two extension instances were simultaneously loaded from different paths (Desktop vs OneDrive), giving different extension IDs and separate storage. All 131 Q&A pairs recovered from old LevelDB log and saved as `Desktop\qa_restore.json`. See Critical Warning section above.
- **May 2026 (session 10):** CLAUDE.md version header corrected to v4.0; Current Architecture section updated to reflect Settings tab additions and A→B→C→D fill flow. README.md version badge updated to 4.0.0; Architecture section updated with scored resume detection and fill orchestrator bullets. Pushed to GitHub with v4.0.0 tag.
