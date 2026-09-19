# JUSTICEkz Case Workup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make document import a durable case-workup job that blocks chat until extraction, OCR, memory indexing, chronology, and a first-pass legal workup are complete.

**Architecture:** Persist batch and review state in SQLite. The document queue updates that state while it processes each file, then invokes a deterministic case-review service that writes report memory and tasks. The browser polls one batch endpoint and the server enforces readiness independently of the UI.

**Tech Stack:** Node.js 24, built-in `node:sqlite`, existing HTTP server, browser JavaScript/CSS, Node test runner.

---

### Task 1: Add durable batch and review storage

**Files:**
- Modify: `src/core/db.mjs`
- Test: `tests/db.test.mjs`

- [ ] **Step 1: Write the failing test**

Add a test that creates a batch, attaches a document, creates a review, updates both, and verifies all fields are returned after reopening the database.

```js
test('batch and review state survive database reopen', () => {
  const dataDir = tempDataDir();
  const firstDb = createDatabase({ dataDir });
  const caseItem = firstDb.createCase({ title: 'Разбор дела' });
  const stage = firstDb.listStages(caseItem.id)[0];
  const batch = firstDb.addBatch({ caseId: caseItem.id, stageId: stage.id, total: 1 });
  const document = firstDb.addDocument({
    caseId: caseItem.id, stageId: stage.id, batchId: batch.id, originalName: 'notice.txt',
    storedPath: 'cases/notice.txt', mimeType: 'text/plain', status: 'queued', checksum: 'state',
  });
  const review = firstDb.addReview({ caseId: caseItem.id, batchId: batch.id });
  firstDb.updateBatch(batch.id, { status: 'reviewing', phase: 'review', progress: 85, currentFileName: 'notice.txt' });
  firstDb.updateReview(review.id, { status: 'complete', progress: 100, report: { findings: ['ok'] } });
  firstDb.close();

  const secondDb = createDatabase({ dataDir });
  assert.equal(secondDb.getBatch(batch.id).status, 'reviewing');
  assert.equal(secondDb.listBatchDocuments(batch.id)[0].id, document.id);
  assert.deepEqual(secondDb.getReview(review.id).report, { findings: ['ok'] });
  secondDb.close();
});
```
- [ ] **Step 2: Run the test to verify it fails**

Run `node --test tests/db.test.mjs`. It must fail because the batch and review methods do not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `document_batches` and `case_reviews` tables, migrate `documents.batch_id`, and expose `addBatch`, `updateBatch`, `getBatch`, `listBatches`, `getActiveBatch`, `listBatchDocuments`, `addReview`, `updateReview`, `getReview`, and `getLatestReview`. Store the report as JSON and parse it when reading.

- [ ] **Step 4: Run the test to verify it passes**

Run `node --test tests/db.test.mjs`. Expected: all database tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/core/db.mjs tests/db.test.mjs
git commit -m "feat: persist document batches and case reviews"
```

### Task 2: Make the queue report full batch progress

**Files:**
- Modify: `src/core/ingest.mjs`
- Modify: `src/core/processing.mjs`
- Test: `tests/ingest.test.mjs`

- [ ] **Step 1: Write the failing test**

Add a test that enqueues two text files and asserts that the batch reports two completed documents, `phase: 'complete'` after review callback completion, and the callback sees `text_extraction`, `memory`, and `chronology` phases.

```js
test('document queue exposes durable batch phases and counters', async () => {
  const dataDir = tempDataDir();
  const db = createDatabase({ dataDir });
  const caseItem = db.createCase({ title: 'Статус обработки' });
  const phases = [];
  const queue = createDocumentQueue({
    db, dataDir,
    reviewService: { run: async ({ batchId }) => { db.updateBatch(batchId, { status: 'complete', phase: 'complete', progress: 100 }); } },
    onProgress: (update) => phases.push(update.phase),
  });
  const jobs = queue.enqueueBatch({ caseId: caseItem.id, stageId: db.listStages(caseItem.id)[0].id, documents: [
    { fileName: 'one.txt', buffer: Buffer.from('Дата 01.09.2026') },
    { fileName: 'two.txt', buffer: Buffer.from('Дата 02.09.2026') },
  ] });
  await queue.idle();
  const batch = db.getBatch(jobs.batchId);
  assert.equal(batch.completed, 2);
  assert.equal(batch.status, 'complete');
  assert.ok(phases.includes('text_extraction'));
  assert.ok(phases.includes('memory'));
  assert.ok(phases.includes('chronology'));
  db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run `node --test tests/ingest.test.mjs`. It must fail because `jobs.batchId` and batch progress do not exist.

- [ ] **Step 3: Write the minimal implementation**

Pass `batchId` through `prepareDocument`, update document progress by phase in `processPreparedDocument`, create one durable batch per enqueue, and invoke `reviewService.run` after the last document in a batch. Keep each case isolated and mark failed documents without stopping the remaining files.

- [ ] **Step 4: Run the test to verify it passes**

Run `node --test tests/ingest.test.mjs`. Expected: all ingestion tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/core/ingest.mjs src/core/processing.mjs tests/ingest.test.mjs
git commit -m "feat: track document batch processing"
```

### Task 3: Add the evidence-backed case review service

**Files:**
- Create: `src/core/case-review.mjs`
- Modify: `src/core/db.mjs`
- Test: `tests/case-review.test.mjs`

- [ ] **Step 1: Write the failing test**

Create a text case containing a court filing and an enforcement notice, run the review, and assert that the report has findings, a missing-materials entry, a next task, and a case-review memory.

```js
test('case review produces findings, gaps, tasks, and permanent memory', async () => {
  const dataDir = tempDataDir();
  const db = createDatabase({ dataDir });
  const caseItem = db.createCase({ title: 'Оспаривание действий ЧСИ' });
  const stage = db.listStages(caseItem.id)[0];
  const batch = db.addBatch({ caseId: caseItem.id, stageId: stage.id, total: 2 });
  db.addDocument({ caseId: caseItem.id, stageId: stage.id, batchId: batch.id, originalName: 'иск.txt', storedPath: 'isk.txt', status: 'text_extracted', checksum: 'a', progress: 100 });
  db.addDocument({ caseId: caseItem.id, stageId: stage.id, batchId: batch.id, originalName: 'постановление ЧСИ.txt', storedPath: 'post.txt', status: 'text_extracted', checksum: 'b', progress: 100 });
  db.addMemory({ scope: 'case', caseId: caseItem.id, title: 'иск.txt', content: 'Административный иск подан 14.08.2026.' });
  const reviewService = createCaseReviewService({ db, model: null });
  const result = await reviewService.run({ caseId: caseItem.id, batchId: batch.id, stageId: stage.id });
  assert.equal(result.status, 'complete');
  assert.ok(result.report.findings.length);
  assert.ok(result.report.gaps.length);
  assert.ok(result.report.nextTasks.length);
  assert.ok(db.listMemories({ scope: 'case', caseId: caseItem.id }).some((item) => item.kind === 'case_review'));
  assert.ok(db.listTasks(caseItem.id).length);
  db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run `node --test tests/case-review.test.mjs`. It must fail because the service does not exist.

- [ ] **Step 3: Write the minimal implementation**

Implement the review phases `inventory`, `chronology`, `completeness`, `strategy`, and `memory`. Use document names, document statuses, extracted memory count, chronology count, current stage, and known legal-document keywords to produce cautious findings and gaps. Add only new task titles, persist a formatted report as `case_review` memory, and optionally request a short local-model executive summary without making it required.

- [ ] **Step 4: Run the test to verify it passes**

Run `node --test tests/case-review.test.mjs`. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/core/case-review.mjs src/core/db.mjs tests/case-review.test.mjs
git commit -m "feat: generate structured case workups"
```

### Task 4: Enforce readiness and expose the batch API

**Files:**
- Create: `src/core/folder-import.mjs`
- Modify: `src/server/server.mjs`
- Modify: `src/core/chat.mjs`
- Modify: `src/core/model.mjs`
- Test: `tests/api.test.mjs`

- [ ] **Step 1: Write the failing tests**

Add API tests for `batchId`, `GET /document-batches/:batchId`, `409` chat blocking while a batch is unfinished, and chat access after the batch is complete. Add a folder collector test that returns only supported files and preserves relative names.

- [ ] **Step 2: Run the tests to verify they fail**

Run `node --test tests/api.test.mjs`. Expected: failures for the missing batch endpoint and missing readiness response.

- [ ] **Step 3: Write the minimal implementation**

Wire `createCaseReviewService` into `createApplication` and the queue. Add the batch and folder routes, include `processing` in case detail, and return a structured `409` with current counts. Increase local response capacity to 512 tokens and update the chat instruction to return the sections `Установлено`, `Не подтверждено`, `Правовая опора`, `Риски`, `Варианты действий`, and `Ближайший шаг` without revealing private chain-of-thought. Expand the retrieved context enough to avoid the current truncated-answer behavior while keeping the case scope enforced.

- [ ] **Step 4: Run the tests to verify they pass**

Run `node --test tests/api.test.mjs tests/chat.test.mjs`. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/core/folder-import.mjs src/server/server.mjs src/core/chat.mjs src/core/model.mjs tests/api.test.mjs tests/chat.test.mjs
git commit -m "feat: gate chat on completed case workup"
```

### Task 5: Build the processing and review UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Write the browser behavior test**

Use the existing browser flow to load a case, start a batch, verify that the processing panel appears with the total, and verify that the textarea and send button are disabled until the batch endpoint reports `complete`.

- [ ] **Step 2: Run the test to verify it fails**

Run the browser test against the local server. Expected: there is no processing panel and the composer remains enabled.

- [ ] **Step 3: Write the minimal implementation**

Add a durable processing panel, render counts and phases from the batch endpoint, poll until review completion, render the report sections, disable upload/chat controls while not ready, handle API `409`, and avoid inserting an optimistic user message until the server accepts the chat request.

- [ ] **Step 4: Run the browser verification**

Start the local server and use Playwright at `http://127.0.0.1:4317/` to verify desktop and narrow layouts, including a batch with a deliberately pending OCR file.

- [ ] **Step 5: Commit**

```powershell
git add public/index.html public/app.js public/styles.css
git commit -m "feat: show case workup progress and review"
```

### Task 6: Import the supplied case folder and verify the complete workflow

**Files:**
- Create: `scripts/import-case-folder.mjs`
- Modify: `README.md`
- Modify: `.gitignore` only if the existing ignore rules do not cover generated case data

- [ ] **Step 1: Add the local folder import command**

Implement `node scripts/import-case-folder.mjs --folder "C:\\Users\\boostseller\\Documents\\Юрист РК\\ХРОНОЛОГИЯ\\ЭКСПЕРТ ПЛЮС" --title "ЭКСПЕРТ ПЛЮС"`. It must call the local folder endpoint, print the batch ID, and poll until the review is complete without copying source files into the repository.

- [ ] **Step 2: Run the complete automated suite**

Run `node --test`. Expected: exit code 0 with all tests passing.

- [ ] **Step 3: Run the supplied folder import**

Start the server, run the importer, and record the actual supported-file count, completed count, OCR count, failure count, review status, and generated memory/task counts. Do not add `.justicekz/data`, source documents, OCR output, or personal data to Git.

- [ ] **Step 4: Verify the browser result**

Open the case in the browser and confirm the processing panel changes from active to ready, the review summary is visible, and chat is enabled only after review completion.

- [ ] **Step 5: Review Git state and commit only source changes**

```powershell
git status --short
git add docs scripts src public tests README.md
git commit -m "feat: complete local case workup workflow"
git push origin main
```
