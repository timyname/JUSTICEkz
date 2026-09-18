const state = { cases: [], activeCase: null, detail: null, asOf: new Date().toISOString().slice(0, 10) };
const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Ошибка запроса');
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
    $('#case-number').textContent = 'Нет выбранного дела'; $('#case-title').textContent = 'Создайте первое дело'; $('#stage-strip').innerHTML = ''; $('#chat-log').innerHTML = emptyChat(); return;
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
}

const documentStatusLabels = {
  queued: 'В очереди', processing: 'Обработка', text_extracted: 'Текст извлечён',
  ocr_extracted: 'OCR выполнен', ocr_pending: 'Нужен OCR', converter_pending: 'Нужен конвертер DOC',
  extraction_failed: 'Ошибка извлечения', unsupported: 'Формат не поддержан',
};

function renderDocuments(documents) {
  $('#document-count').textContent = documents.length;
  $('#document-list').innerHTML = documents.length ? documents.map((document) => {
    const progress = Math.max(0, Math.min(100, Number(document.progress) || 0));
    const status = documentStatusLabels[document.status] || document.status;
    return `<div class="document-item"><div class="document-heading"><strong title="${escapeHtml(document.original_name)}">${escapeHtml(document.original_name)}</strong><span class="document-status status-${escapeHtml(document.status)}">${escapeHtml(status)}</span></div><div class="document-meta">${document.page_count ? `${document.page_count} стр.` : 'страницы уточняются'} · ${progress}%</div><div class="document-progress"><span style="width: ${progress}%"></span></div>${document.extraction_error ? `<p class="document-error">${escapeHtml(document.extraction_error)}</p>` : ''}</div>`;
  }).join('') : '<div class="muted">Документы появятся после загрузки.</div>';
}

function renderChronology(events, questions) {
  $('#event-count').textContent = events.length;
  $('#event-list').innerHTML = events.length ? events.map((event) => `<div class="event-item"><strong>${escapeHtml(event.event_date || 'Дата не определена')}</strong><p>${escapeHtml(event.title)}</p><span>${escapeHtml(event.original_name || (event.source_page ? `страница ${event.source_page}` : 'предложение'))} · ${escapeHtml(event.status === 'suggested' ? 'нужно проверить' : event.status)}</span></div>`).join('') : '<div class="muted">Даты появятся после обработки документов.</div>';
  $('#question-count').textContent = questions.length;
  $('#question-list').innerHTML = questions.length ? questions.map((question) => `<div class="question-item"><span class="question-mark">?</span><span>${escapeHtml(question)}</span></div>`).join('') : '<div class="muted">Контрольные вопросы появятся по ходу работы.</div>';
}

function renderSources(sources = []) {
  $('#source-count').textContent = sources.length;
  $('#source-list').innerHTML = sources.length ? sources.map((source) => `<div class="source-item"><strong>${escapeHtml(source.title)}</strong><p>${escapeHtml(source.content.slice(0, 180))}${source.content.length > 180 ? '…' : ''}</p><p>${escapeHtml(source.effective_from || 'дата редакции не указана')}${source.source_url ? ` · ${escapeHtml(source.source_url)}` : ''}</p></div>`).join('') : '<div class="muted">Источники появятся после вопроса.</div>';
}

async function selectCase(caseId) { state.activeCase = caseId; state.detail = await api(`/api/cases/${encodeURIComponent(caseId)}`); state.asOf = state.detail.case.action_date || state.asOf; renderCases(); renderDetail(); renderSources([]); }

async function refreshCases() { const data = await api('/api/cases'); state.cases = data.cases; renderCases(); if (state.cases.length && !state.activeCase) await selectCase(state.cases[0].id); else if (!state.cases.length) renderDetail(); }

async function createCase(event) { const formElement = event.currentTarget.form || event.currentTarget; const form = new FormData(formElement); if (!String(form.get('title') || '').trim()) return; const created = await api('/api/cases', { method: 'POST', body: JSON.stringify({ title: form.get('title'), number: form.get('number'), actionDate: form.get('actionDate') || null }) }); formElement.closest('dialog').close(); state.cases.unshift(created.case); state.activeCase = created.case.id; await selectCase(created.case.id); }

async function sendMessage() { const input = $('#message-input'); const message = input.value.trim(); if (!message || !state.activeCase) return; input.value = ''; const log = $('#chat-log'); if (log.querySelector('.empty-chat')) log.innerHTML = ''; log.insertAdjacentHTML('beforeend', `<div class="message user"><div class="message-meta"><span class="message-role">Вы</span></div><div class="message-bubble">${escapeHtml(message)}</div></div><div class="message assistant"><div class="message-meta"><span class="message-role">JUSTICEkz</span></div><div class="message-bubble">Собираю контекст дела и проверяю редакции права…</div></div>`); log.scrollTop = log.scrollHeight; $('#send-button').disabled = true; try { const result = await api(`/api/cases/${state.activeCase}/chat`, { method: 'POST', body: JSON.stringify({ message, asOf: state.asOf }) }); renderSources(result.sources); await selectCase(state.activeCase); } catch (error) { log.lastElementChild.querySelector('.message-bubble').textContent = error.message; } finally { $('#send-button').disabled = false; } }

function bytesToBase64(bytes) { let binary = ''; const chunkSize = 0x8000; for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize)); return btoa(binary); }

async function refreshDocuments(caseId) { const result = await api(`/api/cases/${encodeURIComponent(caseId)}/documents`); if (!state.detail || state.activeCase !== caseId) return; state.detail.documents = result.documents; state.detail.events = result.events; state.detail.questions = result.questions; renderDocuments(result.documents); renderChronology(result.events, result.questions); return result; }

async function pollDocuments(caseId) { for (let attempt = 0; attempt < 60; attempt += 1) { const result = await refreshDocuments(caseId); if (!result || !result.documents.some((document) => ['queued', 'processing'].includes(document.status))) return; await new Promise((resolve) => setTimeout(resolve, 500)); } }

async function uploadDocument(event) { const files = Array.from(event.target.files || []); if (!files.length || !state.activeCase) return; $('#upload-hint').textContent = `Ставлю в очередь: ${files.length} файл${files.length === 1 ? '' : 'а'}…`; try { const documents = await Promise.all(files.map(async (file) => ({ fileName: file.name, mimeType: file.type, contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }))); const result = await api(`/api/cases/${state.activeCase}/documents/batch`, { method: 'POST', body: JSON.stringify({ documents, stageId: state.detail.case.current_stage_id }) }); $('#upload-hint').textContent = `В очереди документов: ${result.documents.length}`; await selectCase(state.activeCase); await pollDocuments(state.activeCase); const finished = state.detail.documents.filter((document) => ['text_extracted', 'ocr_extracted'].includes(document.status)).length; $('#upload-hint').textContent = `Обработано: ${finished} из ${files.length}`; } catch (error) { $('#upload-hint').textContent = error.message; } event.target.value = ''; }

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
