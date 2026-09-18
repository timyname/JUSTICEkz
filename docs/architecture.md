# JUSTICEkz Architecture

## Runtime

The local server uses Node.js 24 and SQLite from node:sqlite. No database daemon, Python runtime, or frontend bundler is required for the first release. The server binds to 127.0.0.1 by default.

## Memory boundaries

Legal acts are memories.scope = law. Case material is memories.scope = case and must contain a case_id. The context builder performs two separate searches and returns legalSources and caseDocuments separately. It never searches all case material globally.

## Date snapshots

Legal memories carry effective_from and effective_to. A question includes asOf; only versions active on that date are eligible. The case itself stores a default action date, but each chat request can select another date.

## Local files

.justicekz/data contains the SQLite database, original case files, OCR status, and the local AES key for redaction mappings. It is ignored by Git. A public checkout therefore contains no case data.

## Model adapters

Set JUSTICE_MODEL_URL to an OpenAI-compatible local endpoint. The adapter sends only the selected case context and date-filtered legal fragments. Without the setting, chat stays in offline evidence mode and does not invent a conclusion.

## Official data updates

Use scripts/ingest-law.mjs for a manually reviewed local record. Future source connectors may fetch official revisions from Adilet and Supreme Court publications, but each record must retain the URL, checksum, and effective interval. Commercial databases must not be copied without a valid license.
