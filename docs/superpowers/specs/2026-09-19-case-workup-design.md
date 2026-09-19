# JUSTICEkz Case Workup Design

## Goal

After a user adds a group of documents, JUSTICEkz must finish importing, extracting, OCR-ing, indexing, and reviewing that group before accepting a legal question. The user should see a truthful, persistent status and receive a structured first-pass case workup with chronology, gaps, risks, action options, and next tasks.

## Product behavior

1. A batch has a stable ID and survives a browser refresh because its state is stored in the local SQLite database.
2. The interface reports the total inventory, completed and failed files, current file, current phase, and a percentage based on both document processing and review.
3. Chat input and document upload controls are disabled while the active batch is extracting or being reviewed. The API returns `409` if a client bypasses the interface.
4. A batch is not ready when OCR/text extraction is finished but the case review is still running. The ready state is reached only after the review report and review memory have been written.
5. A review is transparent but does not expose hidden chain-of-thought. It presents concise work notes: what was checked, what was found, what is missing, what is uncertain, and what should happen next.
6. The review never invents a fact or a legal conclusion. It marks heuristic findings as items for verification and keeps the user’s procedural role explicit when it is unknown.
7. Case review memories, tasks, events, and documents remain scoped to the selected case. Legal memory remains a separate scope.

## Data model

### `document_batches`

Stores the durable progress record for one import group: case, stage, totals, counts, status, phase, current file, progress, and timestamps. Documents reference the batch using `documents.batch_id`.

Statuses are `queued`, `extracting`, `reviewing`, `complete`, `complete_with_errors`, and `failed`. Phases are `inventory`, `text_extraction`, `ocr`, `memory`, `chronology`, `review`, and `complete`.

### `case_reviews`

Stores the durable review run attached to a batch. Its JSON report contains `findings`, `gaps`, `risks`, `options`, `forecast`, and `nextTasks`; the rendered text is also written as a `case_review` memory so normal RAG can retrieve it.

## Processing flow

```text
upload/folder import
  -> create batch and queued documents
  -> extract text or OCR each document
  -> write chunks and suggested chronology events
  -> create review record
  -> inventory / completeness / risk / options / forecast
  -> write review memory and tasks
  -> mark batch ready
  -> enable chat
```

The review is deterministic and usable without a model. When a configured local model is available, it may add a short executive summary, but that summary is optional and cannot replace the evidence-backed report.

## API

- `POST /api/cases/:caseId/documents/batch` returns `batchId` and the initial batch state.
- `POST /api/cases/:caseId/documents/folder` recursively imports supported files from a local folder and returns `batchId`.
- `GET /api/cases/:caseId/document-batches/:batchId` returns batch, documents, review, and report.
- Case detail includes `processing` with the active or latest batch and latest review.
- `POST /api/cases/:caseId/chat` returns `409` while the case has an unfinished batch.

## UI

The composer includes a workup panel with a progress bar, counters, current file, current phase, and a compact log. When complete, it replaces the busy state with a structured review summary. The message area remains available only after this panel reports ready.
