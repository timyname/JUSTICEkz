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

## Project boundaries

- `src/core` contains storage, search, ingestion, redaction, chat, and export logic.
- `src/server` contains the local HTTP API.
- `public` contains the browser workspace.
- `data/seed` contains public, non-authoritative demo metadata only.

Legal outputs are drafts and require professional review. The application is not a substitute for a licensed lawyer or the official text of a legal act.
