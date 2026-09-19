const state = { cases: [], activeCase: null, detail: null, asOf: new Date().toISOString().slice(0, 10), processing: null, goalSelection: null, goalSaving: false };
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

function listMarkup(items, limit = 4) {
  const values = (items || []).filter(Boolean);
  return values.length ? `<ul>${values.slice(0, limit).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="muted">Не выделено.</p>';
}

function renderBriefing(review) {
  const box = $('#case-briefing');
  const report = review?.report;
  if (!report?.briefing) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const briefing = report.briefing;
  const dateRows = (report.dateAnchors || []).slice(0, 5).map((item) => `<div class="briefing-date"><strong>${escapeHtml(item.date || 'Дата не установлена')}</strong><span>${escapeHtml(item.title)}</span><em class="date-${escapeHtml(item.status)}">${item.status === 'confirmed' ? 'подтверждено' : item.status === 'unknown' ? 'не установлено' : 'предложение'}</em></div>`).join('');
  const violations = (report.violations || []).slice(0, 4).map((item) => `<div class="violation-item"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.basis)}</span><em>${escapeHtml(item.status)}</em></div>`).join('');
  box.innerHTML = `<div class="briefing-top"><div><span class="eyebrow">Краткая карта дела</span><h3>${escapeHtml(briefing.caseType)}</h3><p>${escapeHtml(briefing.short)}</p></div><span class="briefing-stage">${escapeHtml(briefing.currentPosition)}</span></div><div class="briefing-grid"><div><span class="briefing-label">Стороны</span>${listMarkup(briefing.parties, 3)}</div><div><span class="briefing-label">Обязательства</span>${listMarkup(briefing.obligations, 2)}</div><div><span class="briefing-label">Что хотят</span>${listMarkup(briefing.requests, 2)}</div><div><span class="briefing-label">Что произошло</span>${listMarkup(briefing.whatHappened, 2)}</div></div><div class="briefing-row"><div class="briefing-subsection"><span class="briefing-label">Опорные даты</span><div class="briefing-dates">${dateRows || '<p class="muted">Даты не найдены.</p>'}</div></div><div class="briefing-subsection"><span class="briefing-label">Нарушения и контрольные точки</span><div class="violation-list">${violations || '<p class="muted">Явных контрольных точек пока не выделено.</p>'}</div></div></div><details class="compact-disclosure briefing-details"><summary>Показать расширенную сводку и варианты действий</summary><p class="briefing-detail-copy">${escapeHtml(briefing.detailed || '')}</p>${listMarkup(report.options, 4)}${listMarkup(report.forecast, 3)}</details>`;
  box.classList.remove('hidden');
}

function renderGoalDraft(draft) {
  const box = $('#goal-draft');
  if (!draft) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const section = (title, items, limit = 4) => `<div class="draft-section"><strong>${escapeHtml(title)}</strong>${listMarkup(items, limit)}</div>`;
  const timeline = (draft.timeline || []).slice(0, 5).map((item) => `<li><strong>${escapeHtml(item.date || 'Дата не установлена')}</strong> ${escapeHtml(item.title)} <em>${item.status === 'confirmed' ? 'подтверждено' : item.status === 'unknown' ? 'нужно заполнить' : 'проверить'}</em></li>`).join('');
  box.innerHTML = `<div class="draft-title"><strong>${escapeHtml(draft.title)}</strong><span>${escapeHtml(draft.documentType)}</span></div><p class="draft-warning">${escapeHtml(draft.warning)}</p>${section('Факты', draft.facts)}${section('Основания для проверки', draft.grounds)}${section('Просительная часть · черновик', draft.requests)}<div class="draft-section"><strong>Хронология</strong><ul>${timeline || '<li>Даты не установлены.</li>'}</ul></div><details class="compact-disclosure"><summary>Приложения и незаполненные поля</summary>${section('Приложения', draft.attachments)}${section('Нужно подтвердить', draft.unknowns, 6)}</details>`;
  box.classList.remove('hidden');
}

function renderGoal(detail) {
  const panel = $('#goal-panel');
  const report = detail?.processing?.review?.report;
  if (!report) { panel.classList.add('hidden'); renderGoalDraft(null); return; }
  panel.classList.remove('hidden');
  const saved = detail.goal;
  const selected = state.goalSelection || saved?.goal?.code;
  $('#goal-options').querySelectorAll('[data-goal]').forEach((button) => button.classList.toggle('selected', button.dataset.goal === selected));
  $('#goal-state').textContent = saved ? 'цель сохранена' : 'нужно уточнить';
  if (saved?.goal?.customText && !$('#goal-custom').value) $('#goal-custom').value = saved.goal.customText;
  $('#goal-hint').textContent = saved ? `Текущая цель: ${saved.goal.customText || saved.goal.label}.` : 'После подтверждения чат откроется для глубокого разбора.';
  renderGoalDraft(saved?.draft);
}

function renderCases() {
  const list = $('#case-list');
  if (!state.cases.length) { list.innerHTML = '<div class="empty-state compact">Пока нет дел.<br>Создайте первое дело кнопкой +.</div>'; return; }
  list.innerHTML = state.cases.map((item) => `<button class="case-item ${item.id === state.activeCase ? 'active' : ''}" data-case-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.number)} · ${escapeHtml(item.action_date || 'дата не задана')}</span></button>`).join('');
  list.querySelectorAll('[data-case-id]').forEach((button) => button.addEventListener('click', () => selectCase(button.dataset.caseId)));
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) {
    $('#case-number').textContent = 'Нет выбранного дела'; $('#case-title').textContent = 'Создайте первое дело'; $('#stage-strip').innerHTML = ''; $('#chat-log').innerHTML = emptyChat(); renderProcessing(null); renderBriefing(null); renderGoal(null); return;
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
  renderGoal(detail);
}

const documentStatusLabels = {
  queued: 'В очереди', processing: 'Обработка', text_extracted: 'Текст извлечён',
  ocr_extracted: 'OCR выполнен', ocr_pending: 'Нужен OCR', converter_pending: 'Нужен конвертер DOC',
  extraction_failed: 'Ошибка извлечения', unsupported: 'Формат не поддержан',
};

function renderDocuments(documents) {
  $('#document-count').textContent = documents.length;
  const warningDocuments = documents.filter((document) => ['ocr_pending', 'converter_pending', 'extraction_failed', 'unsupported'].includes(document.status) || document.extraction_error);
  const statusCounts = documents.reduce((counts, document) => { counts[document.status] = (counts[document.status] || 0) + 1; return counts; }, {});
  const statusSummary = Object.entries(statusCounts).map(([status, count]) => `${count} · ${documentStatusLabels[status] || status}`).join('  |  ');
  const visibleDocuments = documents.slice(0, 14);
  const limitNote = documents.length > visibleDocuments.length ? `<div class="muted list-limit-note">Показаны ${visibleDocuments.length} из ${documents.length}. Полный реестр сохранён в памяти дела.</div>` : '';
  const warnings = warningDocuments.length ? `<div class="warning-summary"><strong>${formatDocumentCount(warningDocuments.length)} требуют внимания</strong><span>${warningDocuments.slice(0, 2).map((document) => escapeHtml(document.original_name)).join(', ')}${warningDocuments.length > 2 ? '…' : ''}</span><details class="compact-disclosure"><summary>Показать предупреждения</summary><ul>${warningDocuments.slice(0, 8).map((document) => `<li>${escapeHtml(document.original_name)} · ${escapeHtml(documentStatusLabels[document.status] || document.status)}${document.extraction_error ? ` — ${escapeHtml(document.extraction_error)}` : ''}</li>`).join('')}</ul></details></div>` : '<div class="document-ok">Ошибок извлечения не отмечено.</div>';
  $('#document-list').innerHTML = documents.length ? `<div class="document-count-summary"><strong>${formatDocumentCount(documents.length)}</strong><span>${escapeHtml(statusSummary)}</span></div>${warnings}<details class="compact-disclosure document-details"><summary>Открыть список документов</summary>${visibleDocuments.map((document) => {
    const progress = Math.max(0, Math.min(100, Number(document.progress) || 0));
    const status = documentStatusLabels[document.status] || document.status;
    return `<div class="document-item"><div class="document-heading"><strong title="${escapeHtml(document.original_name)}">${escapeHtml(document.original_name)}</strong><span class="document-status status-${escapeHtml(document.status)}">${escapeHtml(status)}</span></div><div class="document-meta">${document.page_count ? `${document.page_count} стр.` : 'страницы уточняются'} · ${progress}%</div><div class="document-progress"><span style="width: ${progress}%"></span></div>${document.extraction_error ? `<p class="document-error">${escapeHtml(document.extraction_error)}</p>` : ''}</div>`;
  }).join('')}${limitNote}</details>` : '<div class="muted">Документы появятся после загрузки.</div>';
}

function renderChronology(events, questions) {
  $('#event-count').textContent = events.length;
  const visibleEvents = events.slice(0, 8);
  const limitNote = events.length > visibleEvents.length ? `<div class="muted list-limit-note">Показаны ${visibleEvents.length} из ${events.length}. Все даты сохранены в памяти дела.</div>` : '';
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
  if (!batch) { panel.classList.add('hidden'); renderReviewSummary(null); renderBriefing(null); renderGoal(state.detail); setComposerAvailability(true, true); return; }
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
  renderBriefing(complete ? review : null);
  if (state.detail) renderGoal(state.detail);
  setComposerAvailability(complete, !active);
}

function setComposerAvailability(chatReady, uploadReady) {
  const hasCase = Boolean(state.activeCase);
  const goalReady = !state.detail?.processing?.review?.report || Boolean(state.detail?.goal);
  const canChat = chatReady && goalReady;
  document.body.classList.toggle('goal-gate', Boolean(hasCase && chatReady && !goalReady));
  $('#message-input').disabled = !hasCase || !canChat;
  $('#send-button').disabled = !hasCase || !canChat;
  $('#document-input').disabled = !hasCase || !uploadReady;
  $('#message-input').placeholder = !chatReady ? 'Диалог откроется после завершения разбора дела...' : goalReady ? 'Опишите вопрос по текущему делу...' : 'Сначала зафиксируйте цель обращения выше...';
}

function renderSources(sources = []) {
  $('#source-count').textContent = sources.length;
  $('#source-list').innerHTML = sources.length ? sources.map((source) => `<div class="source-item"><strong>${escapeHtml(source.title)}</strong><p>${escapeHtml(source.content.slice(0, 180))}${source.content.length > 180 ? '…' : ''}</p><p>${escapeHtml(source.effective_from || 'дата редакции не указана')}${source.source_url ? ` · ${escapeHtml(source.source_url)}` : ''}</p></div>`).join('') : '<div class="muted">Источники появятся после вопроса.</div>';
}

async function selectCase(caseId) { state.activeCase = caseId; state.goalSelection = null; state.detail = await api(`/api/cases/${encodeURIComponent(caseId)}`); state.asOf = state.detail.case.action_date || state.asOf; renderCases(); renderDetail(); renderSources([]); }

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

async function confirmGoal() {
  if (!state.activeCase || state.goalSaving) return;
  const customGoal = $('#goal-custom').value.trim();
  const goal = state.goalSelection || state.detail?.goal?.goal?.code;
  if (!goal && !customGoal) { $('#goal-hint').textContent = 'Выберите цель или опишите её своими словами.'; return; }
  state.goalSaving = true;
  $('#confirm-goal').disabled = true;
  $('#goal-hint').textContent = 'Сохраняю цель в память этого дела…';
  try {
    await api(`/api/cases/${encodeURIComponent(state.activeCase)}/goal`, { method: 'POST', body: JSON.stringify({ goal, customGoal }) });
    await selectCase(state.activeCase);
  } catch (error) {
    $('#goal-hint').textContent = error.message;
  } finally {
    state.goalSaving = false;
    $('#confirm-goal').disabled = false;
  }
}

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
$('#goal-options').addEventListener('click', (event) => { const button = event.target.closest('[data-goal]'); if (!button) return; state.goalSelection = button.dataset.goal; $('#goal-options').querySelectorAll('[data-goal]').forEach((item) => item.classList.toggle('selected', item === button)); });
$('#confirm-goal').addEventListener('click', confirmGoal);
$('#export-button').addEventListener('click', () => { if (state.activeCase) window.open(`/api/cases/${encodeURIComponent(state.activeCase)}/export?format=docx&asOf=${encodeURIComponent(state.asOf)}`, '_blank'); });

Promise.all([api('/api/health')]).then(([health]) => { $('#model-status').textContent = health.modelConfigured ? 'Локальная модель подключена' : 'Offline-режим'; return refreshCases(); }).catch((error) => { $('#model-status').textContent = error.message; });
