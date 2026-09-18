# JUSTICEkz MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local browser-based MVP that keeps Kazakhstan legal sources separate from per-case memory, searches by effective date, imports documents, redacts identifiers, and exports draft documents.

**Architecture:** A zero-dependency Node.js server uses Node 24's built-in SQLite module and serves a static browser UI. The database has explicit `law` and `case` scopes, stage metadata, FTS5 search, encrypted local identity mappings, and a model adapter with an offline fallback.

**Tech Stack:** Node.js 24, `node:sqlite`, Node `http`, browser JavaScript/CSS, `node:test`, optional Tesseract/llama.cpp/Ollama adapters.

---

### Task 1: Repository hygiene and project entry points

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `.env.example`
- Create: `README.md`
- Create: `LICENSE`
- Create: `src/config.mjs`

- [ ] **Step 1: Write the failing config test**

Create `tests/config.test.mjs` asserting the default data directory is outside tracked source and the default port is `4317`.

- [ ] **Step 2: Run the test and verify it fails**

Run `node --test tests/config.test.mjs`. Expected: module-not-found for `src/config.mjs`.

- [ ] **Step 3: Implement the minimal config module**

Read `JUSTICE_DATA_DIR`, `JUSTICE_PORT`, and `JUSTICE_MODEL_URL` from the environment with safe local defaults.

- [ ] **Step 4: Run the test and verify it passes**

Run `node --test tests/config.test.mjs`. Expected: one passing test.

- [ ] **Step 5: Add repository hygiene files and commit**

Ignore `.justicekz/`, `.env`, `.superpowers/`, `node_modules/`, generated exports, and local model files. Add an MIT license and README with the local-only privacy warning.

### Task 2: SQLite schema and isolated memories

**Files:**
- Create: `src/core/db.mjs`
- Create: `tests/db.test.mjs`

- [ ] **Step 1: Write failing tests**

Test that a case creates stages, case memories cannot be returned for another case, and a law version can be filtered by `asOf` date.

- [ ] **Step 2: Run `node --test tests/db.test.mjs` and verify the expected missing-module failure**

- [ ] **Step 3: Implement schema and repository methods**

Create tables for `cases`, `stages`, `documents`, `memories`, `messages`, `tasks`, `parties`, and `settings`; create `memory_fts` with FTS5; expose methods for case/stage CRUD, memory insertion, scoped search, messages, tasks, and local party mappings.

- [ ] **Step 4: Run the database tests and verify they pass**

- [ ] **Step 5: Commit the database boundary**

### Task 3: Date-aware legal search and context assembly

**Files:**
- Create: `src/core/search.mjs`
- Create: `src/core/context.mjs`
- Create: `tests/search.test.mjs`

- [ ] **Step 1: Write failing tests**

Insert two versions of one law and two case documents; assert that the selected date returns only the valid law version and only the active case's chunks.

- [ ] **Step 2: Verify the tests fail**

Run `node --test tests/search.test.mjs` before creating the modules.

- [ ] **Step 3: Implement search and context assembly**

Normalize Cyrillic query text, search FTS5, enforce `case_id` scope for case memories, enforce `effective_from/effective_to` for laws, and produce a context object with separate `legalSources`, `caseDocuments`, and `warnings` arrays.

- [ ] **Step 4: Verify green**

- [ ] **Step 5: Commit search and context**

### Task 4: Document ingestion and chunking

**Files:**
- Create: `src/core/ingest.mjs`
- Create: `src/core/chunking.mjs`
- Create: `tests/ingest.test.mjs`

- [ ] **Step 1: Write failing tests**

Test UTF-8 text ingestion, page markers, stable SHA-256 checksum, and that unsupported binary files are stored with an explicit `ocr_pending` status instead of being treated as readable.

- [ ] **Step 2: Verify the tests fail**

- [ ] **Step 3: Implement ingestion**

Store the original under the local data directory, extract text for `.txt`, `.md`, `.csv`, and `.json`, attempt `pdftotext`/Tesseract only when available, preserve page markers, chunk by bounded character windows with overlap, and insert chunks into case memory.

- [ ] **Step 4: Verify green**

- [ ] **Step 5: Commit ingestion**

### Task 5: Local redaction and reversible mappings

**Files:**
- Create: `src/core/redaction.mjs`
- Create: `tests/redaction.test.mjs`

- [ ] **Step 1: Write failing tests**

Test stable replacement of a manually registered company and address, automatic masking of BIN/IIN-like 12-digit identifiers, and restoration of tokens only through the local mapping.

- [ ] **Step 2: Verify the tests fail**

- [ ] **Step 3: Implement redaction**

Generate a local AES-256-GCM key, encrypt mapping values, replace longest known values first, add deterministic per-case token counters, and return a preview that contains no original identifiers.

- [ ] **Step 4: Verify green**

- [ ] **Step 5: Commit redaction**

### Task 6: Chat orchestration and model adapter

**Files:**
- Create: `src/core/model.mjs`
- Create: `src/core/chat.mjs`
- Create: `tests/chat.test.mjs`

- [ ] **Step 1: Write failing tests**

Test that chat context contains only selected case data and date-valid legal sources, that no-model mode returns a grounded offline response with sources, and that the local provider is never called when no model URL is configured.

- [ ] **Step 2: Verify the tests fail**

- [ ] **Step 3: Implement chat**

Build a structured prompt, call an explicitly configured local OpenAI-compatible endpoint, parse its response, and otherwise return an offline response that lists sources and asks for missing facts without inventing a legal conclusion.

- [ ] **Step 4: Verify green**

- [ ] **Step 5: Commit chat**

### Task 7: HTTP API and browser interface

**Files:**
- Create: `src/server/server.mjs`
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/styles.css`
- Create: `tests/api.test.mjs`

- [ ] **Step 1: Write failing API tests**

Test health, case creation, stage selection, document import, chat, source response, and redaction preview through an in-memory server.

- [ ] **Step 2: Verify the API tests fail**

- [ ] **Step 3: Implement endpoints**

Implement JSON endpoints for cases, stages, documents, chat, tasks, search, redaction preview, and exports. Reject missing `case_id` for case-scoped operations and return structured errors.

- [ ] **Step 4: Implement the UI**

Create a responsive three-column workspace: case/stage navigation, chat and document import, source/task panel. Display the analysis date and clearly separate legal sources from case documents.

- [ ] **Step 5: Verify green and browser-load the UI**

Run the API tests and start `npm start`; verify the health endpoint and the browser UI.

- [ ] **Step 6: Commit the vertical slice**

### Task 8: Draft document export

**Files:**
- Create: `src/core/export.mjs`
- Create: `tests/export.test.mjs`

- [ ] **Step 1: Write failing tests**

Test Markdown/HTML export and a valid DOCX package signature containing the case title, stage, selected facts, and source list.

- [ ] **Step 2: Verify the tests fail**

- [ ] **Step 3: Implement export**

Generate Markdown and printable HTML, plus a minimal dependency-free DOCX package. Include a draft disclaimer and source metadata. Google Docs remains a later optional connector.

- [ ] **Step 4: Verify green**

- [ ] **Step 5: Commit export**

### Task 9: Seed legal-source workflow and documentation

**Files:**
- Create: `scripts/ingest-law.mjs`
- Create: `data/seed/README.md`
- Modify: `README.md`
- Create: `docs/architecture.md`

- [ ] **Step 1: Write failing CLI test**

Test that the CLI rejects a law without title, source URL, or effective date metadata.

- [ ] **Step 2: Verify the test fails**

- [ ] **Step 3: Implement the importer**

Accept a local JSON/Markdown law record, validate metadata, checksum the source, and insert it into the legal memory without mixing it into any case.

- [ ] **Step 4: Document official-source update workflow**

Document Adilet and Supreme Court sources, update timestamps, historical versions, OCR limitations, model adapters, and the rule that real case data never belongs in Git.

- [ ] **Step 5: Run the full test suite and commit**

Run `npm test` and record the result in the handoff.
