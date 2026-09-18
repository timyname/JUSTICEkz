# Document Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local batch document processing, OCR/text extraction, chronology suggestions, document progress, and a browser document list to JUSTICEkz.

**Architecture:** Extend the existing SQLite repository with document processing metadata and case-scoped chronology events. A single in-process queue calls the existing ingestion boundary sequentially, while the API exposes batch submission and case detail data. The browser polls the case detail and renders statuses without adding a frontend dependency.

**Tech Stack:** Node.js 24, `node:sqlite`, Node `zlib`, optional local `pdftotext`, Tesseract and LibreOffice, browser JavaScript/CSS, `node:test`.

---

### Task 1: Persist processing metadata and chronology

**Files:**
- Modify: `src/core/db.mjs`
- Test: `tests/db.test.mjs`

- [ ] Add migration-safe document columns for progress, page count, error, started/processed timestamps.
- [ ] Add `case_events` with case/document/page/date/status fields and scoped repository methods.
- [ ] Run `node --test tests/db.test.mjs` and confirm the new test passes.

### Task 2: Extract DOCX and suggest dated events

**Files:**
- Modify: `src/core/ingest.mjs`
- Test: `tests/ingest.test.mjs`

- [ ] Add a dependency-free ZIP reader for the DOCX XML part and XML text decoding.
- [ ] Add optional `soffice`/LibreOffice conversion for legacy DOC, preserving an explicit pending status when unavailable.
- [ ] Add date parsing for day/month/year and page-aware suggested events.
- [ ] Run the ingestion tests and confirm text extraction remains compatible.

### Task 3: Sequential queue

**Files:**
- Create: `src/core/processing.mjs`
- Modify: `src/core/ingest.mjs`
- Test: `tests/ingest.test.mjs`

- [ ] Enqueue each uploaded buffer, update persisted progress, call ingestion, and continue after individual failures.
- [ ] Return stable document ids immediately and provide an idle promise for tests.
- [ ] Run queue tests with two files and verify only the selected case receives memory/events.

### Task 4: Batch API and case detail

**Files:**
- Modify: `src/server/server.mjs`
- Test: `tests/api.test.mjs`

- [ ] Add batch upload, document listing, and processing data to case detail.
- [ ] Preserve the single-file endpoint for backwards compatibility.
- [ ] Return structured chronology and derived missing-information questions.

### Task 5: Browser document workspace

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] Make the file input multi-select and submit the whole batch.
- [ ] Render every document with status, progress, page count and error.
- [ ] Render suggested chronology and control questions in the right panel.
- [ ] Verify the page at the local URL with the case/document flow.

### Task 6: Local runtime and legal-source setup

**Files:**
- Create: `scripts/setup-local-model.ps1`
- Create: `scripts/fetch-official-laws.ps1`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] Provide an opt-in Windows setup for a small Ollama-compatible model and local endpoint configuration.
- [ ] Provide a source-pinned downloader/import workflow for official Adilet and Supreme Court materials, with hashes and dates.
- [ ] Keep all downloaded materials under ignored local directories.

### Task 7: Verification

- [ ] Run `npm test`.
- [ ] Start the local server and verify health, document list, batch upload and model status.
- [ ] Inspect `git status --short` and confirm no `.justicekz` or model files are tracked.
