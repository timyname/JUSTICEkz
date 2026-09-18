# JUSTICEkz

Local-first legal assistant for Kazakhstan. The project keeps the legal knowledge base separate from the memory of each case, supports date-aware retrieval, document ingestion, OCR adapters, local redaction, and draft exports.

## Privacy boundary

The repository is public. Real case files, OCR text, personal data, local redaction mappings, model files, and generated exports stay under `.justicekz/` and are ignored by Git. Do not commit them.

The first version runs without a model in an offline evidence mode. When a local OpenAI-compatible endpoint is configured, the chat adapter can use it; the server never sends data to an external model by default.

## Run locally

Requires Node.js 24 or newer.

```powershell
npm test
npm start
```

Open <http://127.0.0.1:4317>.

## Local model and document tools

The supported low-memory setup is a local `Qwen3-0.6B-Q8_0.gguf` server through llama.cpp. Run `powershell -ExecutionPolicy Bypass -File scripts/setup-local-model.ps1`, then restart the server. The model endpoint is `127.0.0.1`; documents are not sent to a model provider or to the Internet by the application.

For text extraction and OCR, install the local tools separately when needed: Poppler (`pdftotext` and `pdftoppm`), Tesseract with Russian and Kazakh language packs, and LibreOffice for legacy `.doc`. On Windows, run `powershell -ExecutionPolicy Bypass -File scripts/setup-ocr.ps1` for project-local Tesseract or `powershell -ExecutionPolicy Bypass -File scripts/setup-office.ps1` for LibreOffice. The application searches `.justicekz/tools/Tesseract-OCR` and common LibreOffice install paths. The browser accepts multiple files and shows a per-document status. DOCX is parsed without an external dependency.

To download the official legal baseline, run `powershell -ExecutionPolicy Bypass -File scripts/fetch-official-laws.ps1`. The public manifest at `data/seed/official-sources.json` covers the Civil Code, Civil Procedure Code, Administrative Procedural Code, enforcement law, Entrepreneurial Code, and selected current consolidated normative resolutions of the Supreme Court on civil judgments, court costs, preparation of civil cases, interim measures, enforcement, executive inscriptions, access to justice, administrative judgments, administrative procedure, review by new or newly discovered circumstances, LLPs, and JSCs. The script stores raw pages, records, and SHA-256 metadata under `.justicekz/data/legal/official`; it does not put downloaded law text into Git. Import only reviewed records with explicit act dates using `node scripts/ingest-law.mjs path/to/law.json`. The downloaded pages are current consolidated snapshots; historical analysis requires importing a separately dated snapshot for the relevant редакция.

## Project boundaries

- `src/core` contains storage, search, ingestion, redaction, chat, and export logic.
- `src/server` contains the local HTTP API.
- `public` contains the browser workspace.
- `data/seed` contains public, non-authoritative demo metadata only.

Legal outputs are drafts and require professional review. The application is not a substitute for a licensed lawyer or the official text of a legal act.
