# ⚡ Job Application AutoFill

JSE (Job Autofill Extension) solves the annoying part of job applications, the repetitive questions.

Free, local, and works on the hard ones — SAP SuccessFactors, Dayforce, and Workday.

No account. No subscription. Your data never leaves your browser.

![MIT License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Free](https://img.shields.io/badge/free-forever-brightgreen)
![Local](https://img.shields.io/badge/storage-local%20only-blue)

![JSE demo](assets/demo.gif)

---

## Why this exists

Most autofill extensions work on Greenhouse and Lever. This one was built for
the hard cases — SAP SuccessFactors JUIC picklists, Dayforce React-controlled
fields, Workday portal-rendered comboboxes, and cross-origin iframe forms.
And unlike Simplify+ ($39.99/mo) or JobCopilot (subscription required),
it's completely free and runs entirely in your browser.

## How it's different

| Feature | JSE | Simplify | SpeedyApply |
|---|---|---|---|
| SAP SuccessFactors | ✅ | — | — |
| Dayforce / Ceridian | ✅ | — | — |
| Cross-origin iframes | ✅ | — | — |
| No account required | ✅ | — | — |
| 100% local storage | ✅ | partial | ✅ |
| AI guess for unknown fields | ✅ *(requires Claude API key)* | paid only | paid only |

## Supported platforms

| Platform | Notes |
|---|---|
| Workday (myworkdayjobs.com) | Standard fields + combobox dropdowns |
| SAP SuccessFactors | JUIC picklist via button-click flow |
| Dayforce / Ceridian | React-aware fill |
| Greenhouse | Standard HTML |
| Lever | Standard HTML |
| Ashby | Standard HTML |
| Taleo / Oracle | Multi-article fallback |
| Workable | Section-based description extraction |
| SmartRecruiters | Standard HTML |
| iCIMS | Standard HTML |
| BambooHR | Standard HTML |
| Comeet (iframe embeds) | Cross-origin postMessage relay |

## Installation

1. Clone or download this repository
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `job-autofill-extension` folder
6. The ⚡ icon appears in your toolbar

## First-time setup

1. Click the extension icon → open the **side panel**
2. Go to the **Settings** tab
3. Enter your **save folder** for job post files (optional)
4. Add your **Claude API key** to enable AI Guess (optional — get one at console.anthropic.com)
5. Fill in your **profile context** — a plain-text summary of your background used by the AI
6. Go to the **Q&A tab** and add your standard answers:
   - "First name" → Your first name
   - "Are you legally authorized to work in [country]?" → Yes
   - "Highest level of education" → Master's degree
   - etc.

## Usage

### ⚡ Fill This Page Now
Open the side panel on any job application and click **Fill This Page Now**.
Uploads your resume, fills all matched Q&A pairs, then offers AI-generated
answers for any remaining unknown fields.

### 🧠 Learn This Page
Scan all unknown fields on the current page and save your answers in one pass.
Saved answers are added to your Q&A library and reused on future visits.

### 📄 Save Job Post
Save the current job description as a `.txt` file named `Company-Title-YYYY-MM-DD.txt`
to a folder of your choice.

### 🤖 AI Guess (optional)
For fields JSE can't answer from your Q&A library, AI Guess batches them to
Claude and suggests answers for your review before saving. Requires a Claude
API key — add yours in the Settings tab. No key needed for standard autofill.

## Architecture

```
manifest.json     Chrome MV3 manifest
content.js        Fill engine, label extractor, field scanner, iframe relay
popup.html        Side panel UI (3 tabs: Fill, Q&A, Settings)
popup.js          UI logic, storage helpers, Learn modal, Save Job Post
background.js     Service worker — opens side panel on icon click
assets/           Demo GIF and screenshots
```

**Key technical decisions:**

- **React-aware fill** — uses `Object.getOwnPropertyDescriptor` on
  `HTMLInputElement.prototype` to trigger React-controlled field updates.
  Standard `el.value =` does not work on Workday, Dayforce, etc.
- **11-step label extraction** — handles every DOM structure seen across
  enterprise ATS platforms
- **Dice coefficient + word-boundary gate** — prevents false positives
  (e.g. "sex" matching "sexual orientation") while handling label wording variations
- **SAP JUIC picklist** — click `_selectButton` → wait 200ms → click `[role=option]`;
  the only reliable method; JUIC immediately overrides standard value setters
- **Cross-origin iframe relay** — `all_frames: true` + postMessage with a
  private tag; main frame collects results, times out at 2500ms
- **File System Access API** — save folder handle stored in IndexedDB
  (not `chrome.storage` — handles aren't serialisable there)

## Privacy

All data is stored locally in your browser (`chrome.storage.local` and IndexedDB).
Nothing is sent to any server except:
- The **Claude API**, only when you click AI Guess and have entered an API key
  in Settings. No data is sent without your explicit action.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
