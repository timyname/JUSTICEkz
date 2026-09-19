const state = { cases: [], activeCase: null, detail: null, asOf: new Date().toISOString().slice(0, 10), processing: null };
const $ = (selector) => document.querySelector(selector);
const VISIBLE_DOCUMENT_LIMIT = 80;
const VISIBLE_EVENT_LIMIT = 120;

function formatDocumentCount(count) {
  const value = Math.abs(Number(count)) % 100;
  const last = value % 10;
  const form = value >= 11 && value <= 14 ? 'файлов' : last === 1 ? 'файл' : last >= 2 && last <= 4 ? 'файла' : 'файлов';
  return `${count} ${form}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.error || 'Ошибка запроса'); error.status = response.status; error.body = body; throw error; }
  return body;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function emptyChat() { return '<div class="empty-chat"><div class="empty-chat-icon">J</div><h3>Начните работу с делом</h3><p>Загрузите документ или задайте вопрос. Контекст будет собираться только внутри выбранного дела.</p></div>'; }

function renderCases() {
  const list = $('#case-list');
  if (!state.cases.length) { list.innerHTML = '<div class="empty-state compact">Пока нет дел.<br>Создайте первое дело кнопкой +.</div>'; return; }
  list.innerHTML = state.cases.map((item) => `<button class="case-item ${item.id === state.activeCase ? 'active' : ''}" data-case-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.number)} · ${escapeHtml(item.action_date || 'дата не задана')}</span></button>`).join('');
  list.querySelectorAll('[data-case-id]').forEach((button) => button.addEventListener('click', () => selectCase(button.dataset.caseId)));
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) {
    $('#case-number').textContent = 'Нет выбранного дела'; $('#case-title').textContent = 'Создайте первое дело'; $('#stage-strip').innerHTML = ''; $('#chat-log').innerHTML = emptyChat(); renderProcessing(null); return;
  }
  $('#case-number').textContent = `${detail.case.number} · ${detail.case.action_date || 'дата не задана'}`;
  $('#case-title').textContent = detail.case.title;
  $('#as-of-date').value = state.asOf;
  $('#stage-strip').innerHTML = detail.stages.map((stage) => `<button class="stage-button ${stage.id === detail.case.current_stage_id ? 'active' : ''}" data-stage-id="${stage.id}">${escapeHtml(stage.title)}</button>`).join('');
  $('#stage-strip').querySelectorAll('[data-stage-id]').forEach((button) => button.addEventListener('click', async () => { await api(`/api/cases/${detail.case.id}/stages/current`, { method: 'POST', body: JSON.stringify({ stageId: button.dataset.stageId }) }); await selectCase(detail.case.id); }));
  const messages = detail.messages || [];
  $('#chat-log').innerHTML = messages.length ? messages.map((message) => `<div class="message ${message.role}"><div class="message-meta"><span class="message-role">${message.role === 'user' ? 'Вы' : 'JUSTICEkz'}</span><span>${new Date(message.created_at).toLocaleString('ru-RU')}</span></div><div class="message-bubble">${escapeHtml(message.content)}</div></div>`).join('') : emptyChat();
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
  $('#task-count').textContent = detail.tasks.length;
  $('#task-list').innerHTML = detail.tasks.length ? detail.tasks.map((task) => `<div class="task-item"><span class="task-box"></span><span>${escapeHtml(task.title)}</span></div>`).join('') : '<div class="muted">Задачи формируются по мере работы.</div>';
  renderDocuments(detail.documents || []);
  renderChronology(detail.events || [], detail.questions || []);
  renderProcessing(detail.processing);
}

const documentStatusLabels = {
  queued: 'В очереди', processing: 'Обработка', text_extracted: 'Текст извлечён',
  ocr_extracted: 'OCR выполнен', ocr_pending: 'Нужен OCR', converter_pending: 'Нужен конвертер DOC',
  extraction_failed: 'Ошибка извлечения', unsupported: 'Формат не поддержан',
};

function renderDocuments(documents) {
  $('#document-count').textContent = documents.length;
  const visibleDocuments = documents.slice(0, VISIBLE_DOCUMENT_LIMIT);
  const limitNote = documents.length > VISIBLE_DOCUMENT_LIMIT ? `<div class="muted list-limit-note">Показаны первые ${VISIBLE_DOCUMENT_LIMIT} из ${documents.length}. Полный список сохранён в памяти дела.</div>` : '';
  $('#document-list').innerHTML = documents.length ? `${visibleDocuments.map((document) => {
    const progress = Math.max(0, Math.min(100, Number(document.progress) || 0));
    const status = documentStatusLabels[document.status] || document.status;
    return `<div class="document-item"><div class="document-heading"><strong title="${escapeHtml(document.original_name)}">${escapeHtml(document.original_name)}</strong><span class="document-status status-${escapeHtml(document.status)}">${escapeHtml(status)}</span></div><div class="document-meta">${document.page_count ? `${document.page_count} стр.` : 'страницы уточняются'} · ${progress}%</div><div class="document-progress"><span style="width: ${progress}%"></span></div>${document.extraction_error ? `<p class="document-error">${escapeHtml(document.extraction_error)}</p>` : ''}</div>`;
  }).join('')}${limitNote}` : '<div class="muted">Документы появятся после загрузки.</div>';
}

function renderChronology(events, questions) {
  $('#event-count').textContent = events.length;
  const visibleEvents = events.slice(0, VISIBLE_EVENT_LIMIT);
  const limitNote = events.length > VISIBLE_EVENT_LIMIT ? `<div class="muted list-limit-note">Показаны первые ${VISIBLE_EVENT_LIMIT} из ${events.length}. Все даты сохранены в памяти дела и доступны для поиска.</div>` : '';
  $('#event-list').innerHTML = events.length ? `${visibleEvents.map((event) => `<div class="event-item"><strong>${escapeHtml(event.event_date || 'Дата не определена')}</strong><p>${escapeHtml(event.title)}</p><span>${escapeHtml(event.original_name || (event.source_page ? `страница ${event.source_page}` : 'предложение'))} · ${escapeHtml(event.status === 'suggested' ? 'нужно проверить' : event.status)}</span></div>`).join('')}${limitNote}` : '<div class="muted">Даты появятся после обработки документов.</div>';
  $('#question-count').textContent = questions.length;
  $('#question-list').innerHTML = questions.length ? questions.map((question) => `<div class="question-item"><span class="question-mark">?</span><span>${escapeHtml(question)}</span></div>`).join('') : '<div class="muted">Контрольные вопросы появятся по ходу работы.</div>';
}

const phaseLabels = {
  inventory: 'Инвентаризация документов', text_extraction: 'Извлечение текста', ocr: 'OCR сканов и фотографий',
  memory: 'Сохранение в память дела', chronology: 'Построение хронологии', review: 'Первичный разбор дела', complete: 'Готово',
};

function renderReviewSummary(review) {
  const box = $('#review-summary');
  const report = review?.report;
  if (!report) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const section = (title, items, className = '') => `<div class="review-section ${className}"><strong>${escapeHtml(title)}</strong><ul>${(items || []).slice(0, 6).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
  box.innerHTML = `<div class="review-title"><span>Первичный разбор сохранён в память</span><span class="review-role">Роль: ${escapeHtml(report.partyRole || 'не определена')}</span></div>${section('Что установлено', report.findings)}${section('Пробелы и проверки', report.gaps, 'review-warning')}${section('Риски', report.risks, 'review-risk')}${section('Варианты действий', report.options)}${section('Ближайший прогноз', report.forecast)}${section('Следующие задачи', report.nextTasks)}`;
  box.classList.remove('hidden');
}

function renderProcessing(processing) {
  const panel = $('#processing-panel');
  state.processing = processing || null;
  const active = processing?.active;
  const batch = active || processing?.latest;
  if (!batch) { panel.classList.add('hidden'); renderReviewSummary(null); setComposerAvailability(true, true); return; }
  panel.classList.remove('hidden');
  const complete = ['complete', 'complete_with_errors'].includes(batch.status);
  const failed = batch.status === 'failed';
  const phase = phaseLabels[batch.phase] || batch.phase || 'Подготовка';
  const displayProgress = complete ? 100 : batch.status === 'reviewing' ? Math.max(76, Number(batch.progress) || 0) : Math.min(75, Math.floor(((Number(batch.completed) || 0) / Math.max(1, Number(batch.total) || 1)) * 75));
  $('#processing-title').textContent = complete ? (batch.status === 'complete_with_errors' ? 'Разбор завершён с предупреждениями' : 'Документы и разбор готовы') : failed ? 'Нужна повторная обработка' : 'Изучаю дело до конца';
  $('#processing-message').textContent = batch.message || phase;
  $('#processing-percent').textContent = `${displayProgress}%`;
  $('#processing-progress-bar').style.width = `${displayProgress}%`;
  $('#processing-completed').textContent = batch.completed || 0;
  $('#processing-total').textContent = batch.total || 0;
  $('#processing-failed').textContent = batch.failed || 0;
  $('#processing-current-file').textContent = batch.current_file_name ? `сейчас: ${batch.current_file_name}` : '';
  $('#processing-phase').textContent = complete ? 'Рабочая память дела обновлена. Можно задавать вопрос.' : `Этап: ${phase}`;
  const review = processing.review?.batch_id === batch.id ? processing.review : state.detail?.processing?.review;
  renderReviewSummary(complete ? review : null);
  setComposerAvailability(complete, !active);
}

function setComposerAvailability(chatReady, uploadReady) {
  const hasCase = Boolean(state.activeCase);
  $('#message-input').disabled = !hasCase || !chatReady;
  $('#send-button').disabled = !hasCase || !chatReady;
  $('#document-input').disabled = !hasCase || !uploadReady;
  $('#message-input').placeholder = chatReady ? 'Опишите вопрос по текущему делу...' : 'Диалог откроется после завершения разбора дела...';
}

function renderSources(sources = []) {
  $('#source-count').textContent = sources.length;
  $('#source-list').innerHTML = sources.length ? sources.map((source) => `<div class="source-item"><strong>${escapeHtml(source.title)}</strong><p>${escapeHtml(source.content.slice(0, 180))}${source.content.length > 180 ? '…' : ''}</p><p>${escapeHtml(source.effective_from || 'дата редакции не указана')}${source.source_url ? ` · ${escapeHtml(source.source_url)}` : ''}</p></div>`).join('') : '<div class="muted">Источники появятся после вопроса.</div>';
}

async function selectCase(caseId) { state.activeCase = caseId; state.detail = await api(`/api/cases/${encodeURIComponent(caseId)}`); state.asOf = state.detail.case.action_date || state.asOf; renderCases(); renderDetail(); renderSources([]); }

async function refreshCases() { const data = await api('/api/cases'); state.cases = data.cases; renderCases(); if (state.cases.length && !state.activeCase) await selectCase(state.cases[0].id); else if (!state.cases.length) renderDetail(); }

async function createCase(event) { const formElement = event.currentTarget.form || event.currentTarget; const form = new FormData(formElement); if (!String(form.get('title') || '').trim()) return; const created = await api('/api/cases', { method: 'POST', body: JSON.stringify({ title: form.get('title'), number: form.get('number'), actionDate: form.get('actionDate') || null }) }); formElement.closest('dialog').close(); state.cases.unshift(created.case); state.activeCase = created.case.id; await selectCase(created.case.id); }

async function sendMessage() {
  const input = $('#message-input');
  const message = input.value.trim();
  if (!message || !state.activeCase || input.disabled) return;
  input.value = '';
  const log = $('#chat-log');
  if (log.querySelector('.empty-chat')) log.innerHTML = '';
  const pending = document.createElement('div');
  pending.className = 'message assistant';
  pending.innerHTML = '<div class="message-meta"><span class="message-role">JUSTICEkz</span></div><div class="message-bubble">Сверяю факты дела, редакцию права и возможные риски…</div>';
  log.appendChild(pending);
  log.scrollTop = log.scrollHeight;
  setComposerAvailability(false, false);
  try {
    const result = await api(`/api/cases/${state.activeCase}/chat`, { method: 'POST', body: JSON.stringify({ message, asOf: state.asOf }) });
    renderSources(result.sources);
    await selectCase(state.activeCase);
  } catch (error) {
    pending.querySelector('.message-bubble').textContent = error.message;
    if (error.status === 409) await selectCase(state.activeCase);
    else setComposerAvailability(true, true);
  }
}

function bytesToBase64(bytes) { let binary = ''; const chunkSize = 0x8000; for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize)); return btoa(binary); }

async function refreshDocuments(caseId) { const result = await api(`/api/cases/${encodeURIComponent(caseId)}/documents`); if (!state.detail || state.activeCase !== caseId) return; state.detail.documents = result.documents; state.detail.events = result.events; state.detail.questions = result.questions; state.detail.processing = result.processing; renderDocuments(result.documents); renderChronology(result.events, result.questions); renderProcessing(result.processing); return result; }

async function pollBatch(caseId, batchId) {
  for (;;) {
    const result = await api(`/api/cases/${encodeURIComponent(caseId)}/document-batches/${encodeURIComponent(batchId)}`);
    if (!state.detail || state.activeCase !== caseId) return;
    state.detail.documents = result.documents;
    state.detail.events = result.events;
    state.detail.processing = { active: ['queued', 'extracting', 'reviewing'].includes(result.batch.status) ? result.batch : null, latest: result.batch, review: result.review };
    renderDocuments(result.documents); renderChronology(result.events, state.detail.questions || []); renderProcessing(state.detail.processing);
    if (['complete', 'complete_with_errors', 'failed'].includes(result.batch.status)) { await selectCase(caseId); return; }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}

async function uploadDocument(event) { const files = Array.from(event.target.files || []); if (!files.length || !state.activeCase || event.target.disabled) return; const count = formatDocumentCount(files.length); $('#upload-hint').textContent = `Обнаружено ${count}. Загружаю и начинаю полный разбор…`; try { const documents = await Promise.all(files.map(async (file) => ({ fileName: file.name, mimeType: file.type, contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }))); const result = await api(`/api/cases/${state.activeCase}/documents/batch`, { method: 'POST', body: JSON.stringify({ documents, stageId: state.detail.case.current_stage_id }) }); $('#upload-hint').textContent = `Найдено ${count}. Разбор продолжается ниже.`; await selectCase(state.activeCase); await pollBatch(state.activeCase, result.batchId); $('#upload-hint').textContent = `Пакет разобран: ${count}. Смотрите первичный вывод ниже.`; } catch (error) { $('#upload-hint').textContent = error.message; } event.target.value = ''; }

async function runRedaction() { if (!state.activeCase) return; const text = $('#redaction-form textarea').value; const result = await api(`/api/cases/${state.activeCase}/redact`, { method: 'POST', body: JSON.stringify({ text }) }); const box = $('#redaction-result'); box.classList.remove('hidden'); box.textContent = result.text || 'Нет текста для обезличивания.'; }

$('#new-case-button').addEventListener('click', () => $('#new-case-dialog').showModal());
$('#create-case-submit').addEventListener('click', createCase);
$('#cancel-case-dialog').addEventListener('click', () => $('#new-case-dialog').close());
$('#close-case-dialog').addEventListener('click', () => $('#new-case-dialog').close());
$('#send-button').addEventListener('click', sendMessage);
$('#message-input').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
$('#document-input').addEventListener('change', uploadDocument);
$('#as-of-date').addEventListener('change', (event) => { state.asOf = event.target.value; });
$('#redaction-button').addEventListener('click', () => { $('#redaction-result').classList.add('hidden'); $('#redaction-result').textContent = ''; $('#redaction-dialog').showModal(); });
$('#run-redaction').addEventListener('click', runRedaction);
$('#export-button').addEventListener('click', () => { if (state.activeCase) window.open(`/api/cases/${encodeURIComponent(state.activeCase)}/export?format=docx&asOf=${encodeURIComponent(state.asOf)}`, '_blank'); });

Promise.all([api('/api/health')]).then(([health]) => { $('#model-status').textContent = health.modelConfigured ? 'Локальная модель подключена' : 'Offline-режим'; return refreshCases(); }).catch((error) => { $('#model-status').textContent = error.message; });
