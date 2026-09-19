const terminalStatuses = new Set(['text_extracted', 'ocr_extracted', 'ocr_pending', 'converter_pending', 'unsupported', 'extraction_failed']);

function russianCount(count, one, few, many) {
  const value = Math.abs(Number(count)) % 100;
  const last = value % 10;
  const form = value >= 11 && value <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return `${count} ${form}`;
}

function failedDocumentMessage(count) {
  return `${russianCount(count, 'файл', 'файла', 'файлов')} ${count === 1 ? 'требует' : 'требуют'} внимания`;
}

function includesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function reportText(report) {
  const lines = [
    'ПЕРВИЧНЫЙ РАЗБОР ДЕЛА',
    '',
    'Что проверено:',
    ...report.findings.map((item) => `- ${item}`),
    '',
    'Чего не хватает или что нужно подтвердить:',
    ...(report.gaps.length ? report.gaps.map((item) => `- ${item}`) : ['- На этом проходе явных пробелов не найдено; проверить полноту вручную.']),
    '',
    'Риски:',
    ...report.risks.map((item) => `- ${item}`),
    '',
    'Варианты действий:',
    ...report.options.map((item) => `- ${item}`),
    '',
    'Ближайший прогноз:',
    ...report.forecast.map((item) => `- ${item}`),
    '',
    'Следующие задачи:',
    ...report.nextTasks.map((item) => `- ${item}`),
  ];
  if (report.modelSummary) lines.push('', 'Краткое резюме локальной модели:', report.modelSummary);
  return lines.join('\n');
}

function buildReport({ caseItem, stage, documents, memories, events }) {
  const names = documents.map((document) => document.original_name).join(' ').toLocaleLowerCase('ru-RU');
  const memoryText = memories.slice(0, 500).map((memory) => `${memory.title} ${String(memory.content).slice(0, 500)}`).join(' ').toLocaleLowerCase('ru-RU');
  const corpus = `${names} ${memoryText}`;
  const failedDocuments = documents.filter((document) => !['text_extracted', 'ocr_extracted'].includes(document.status));
  const textDocuments = documents.filter((document) => document.status === 'text_extracted').length;
  const ocrDocuments = documents.filter((document) => document.status === 'ocr_extracted').length;
  const findings = [
    `Проверено ${russianCount(documents.length, 'документ', 'документа', 'документов')}: текст извлечён из ${textDocuments}, OCR выполнен для ${ocrDocuments}.`,
    `В память дела записано ${memories.length} фрагментов; в хронологии найдено ${events.length} датированных предложений по источникам (повторы не исключены).`,
    `Текущий процессуальный блок: ${stage?.title ?? 'не определён'}.`,
  ];
  if (events.length) findings.push('Даты пока являются предложениями и требуют сверки с оригиналами и отметками о вручении.');
  else findings.push('В извлечённом тексте не найдено датированных событий, поэтому хронология пока не подтверждена.');

  const gaps = [];
  if (!includesAny(corpus, [/иск/, /заявлен/, /жалоб/, /требован/])) gaps.push('Не найдено явное исковое заявление, жалоба или заявление с требованиями; добавить основной процессуальный документ.');
  if (includesAny(`${caseItem.title} ${corpus}`, [/чси/, /исполнительн/, /взыскан/]) && !includesAny(corpus, [/постановлен/, /уведомлен/, /извещен/])) {
    gaps.push('Для спора с ЧСИ не найдено понятное постановление или извещение, которое является предметом проверки.');
  }
  if (!includesAny(corpus, [/вручен/, /получен/, /доставлен/, /уведомлен/, /извещен/])) gaps.push('Не найдено подтверждение получения или вручения ключевого документа; проверить сроки от этой даты.');
  if (!includesAny(corpus, [/доказател/, /приложен/, /квитанц/, /оплат/, /расчет/])) gaps.push('Не найден явный комплект подтверждающих документов или расчёт; составить перечень приложений.');
  if (!includesAny(corpus, [/представител/, /доверенност/, /полномоч/])) gaps.push('Не найден документ о полномочиях представителя; проверить, нужен ли он для текущего действия.');
  if (failedDocuments.length) {
    const relative = failedDocuments.length === 1 ? 'который' : 'которые';
    gaps.push(`Проверить ${russianCount(failedDocuments.length, 'файл', 'файла', 'файлов')}, ${relative} не дали полноценный текст: ${failedDocuments.slice(0, 5).map((document) => document.original_name).join(', ')}.`);
  }
  gaps.push('Уточнить процессуальную роль обратившегося: заявитель, истец, ответчик или должник.');

  const risks = [
    events.length ? 'Сроки нельзя считать установленными, пока предложенные даты не сверены с оригиналами.' : 'Без подтверждённой хронологии высок риск неверно оценить срок обращения и последовательность действий.',
    'Имена файлов и найденные фрагменты не заменяют проверку подписей, реквизитов, приложений и факта отправки.',
  ];
  if (failedDocuments.length) risks.push('Непрочитанные документы могут содержать обстоятельства, меняющие оценку дела.');
  if (!includesAny(corpus, [/решен/, /определен/, /постановлен/])) risks.push('Судебный или исполнительный акт, определяющий текущую точку процесса, не выделен однозначно.');

  const options = [
    'Защитный вариант: сначала подтвердить процессуальную роль, предмет обжалования, дату получения и действующий срок, затем выбрать документ с самым коротким сроком.',
    'Доказательственный вариант: сопоставить каждый довод с конкретным документом, страницей, датой и подтверждением отправки или вручения.',
    'Резервный вариант: подготовить ходатайство о приобщении недостающих материалов и отдельную таблицу разногласий по датам, суммам и действиям ЧСИ или другой стороны.',
  ];
  const forecast = [
    'После подтверждения дат и роли можно определить ближайшее процессуальное действие и его срок.',
    events.length ? `Самая ранняя найденная дата: ${events[0].event_date ?? 'дата не определена'} — ${events[0].title}. Это предложение, а не подтверждённый процессуальный факт.` : 'Нужно сначала восстановить хотя бы три опорные даты: основание, получение документа и обращение за защитой.',
    'Если пробелы не закрыть, оппонент или суд может сослаться на пропуск срока, отсутствие надлежащего уведомления или недоказанность требования.',
  ];
  const nextTasks = unique([
    'Подтвердить процессуальную роль и желаемый результат обращения.',
    events.length ? 'Сверить предложенную хронологию с оригиналами и отметить подтверждённые даты.' : 'Собрать опорные даты и подтверждения их получения.',
    gaps.find((gap) => gap.startsWith('Проверить ')),
    'Разложить доказательства по требованиям: факт, документ, страница, дата, способ вручения.',
  ]);
  return {
    title: 'Первичный разбор дела',
    generatedAt: new Date().toISOString(),
    caseTitle: caseItem.title,
    stageTitle: stage?.title ?? null,
    partyRole: 'не определена',
    findings,
    gaps,
    risks,
    options,
    forecast,
    nextTasks,
    modelSummary: null,
  };
}

export function createCaseReviewService({ db, model = null, onProgress = null }) {
  function progress(review, batch, phase, progressValue, message) {
    db.updateReview(review.id, { phase, progress: progressValue, message });
    db.updateBatch(batch.id, {
      status: 'reviewing', phase, progress: Math.max(76, Math.round(75 + progressValue * 0.25)), message,
    });
    if (typeof onProgress === 'function') onProgress({ batchId: batch.id, phase, progress: Math.round(75 + progressValue * 0.25), message });
  }

  async function run({ caseId, batchId, stageId = null }) {
    const batch = db.getBatch(batchId);
    if (!batch) throw new Error('Batch not found');
    const caseItem = db.getCase(caseId);
    const stage = db.listStages(caseId).find((item) => item.id === stageId) ?? db.listStages(caseId).find((item) => item.id === caseItem?.current_stage_id);
    const review = db.addReview({ caseId, batchId });
    try {
      progress(review, batch, 'inventory', 10, 'Собираю реестр документов и проверяю качество извлечения.');
      const documents = db.listBatchDocuments(batchId);
      const memories = db.listMemories({ scope: 'case', caseId });
      progress(review, batch, 'chronology', 35, 'Сверяю даты, страницы и последовательность событий.');
      const events = db.listEvents(caseId);
      progress(review, batch, 'completeness', 58, 'Проверяю, каких материалов и подтверждений может не хватать.');
      const report = buildReport({ caseItem, stage, documents, memories, events });
      progress(review, batch, 'strategy', 78, 'Формирую осторожные варианты защиты и ближайшие задачи.');

      if (model?.configured && model.reviewEnabled) {
        try {
          report.modelSummary = await model.complete({
            messages: [
              { role: 'system', content: 'Дай короткое юридически осторожное резюме первичного разбора на русском. Не выдумывай факты и не раскрывай ход рассуждений.' },
              { role: 'user', content: `${report.findings.join('\n')}\nРиски: ${report.risks.join('\n')}\nПробелы: ${report.gaps.join('\n')}` },
            ],
            maxTokens: 160,
          });
        } catch {
          report.modelSummary = null;
        }
      }

      const content = reportText(report);
      db.addMemory({ scope: 'case', caseId, stageId: stage?.id ?? null, kind: 'case_review', title: `Первичный разбор · ${batch.id}`, content });
      const existingTasks = new Set(db.listTasks(caseId).map((task) => task.title));
      for (const task of report.nextTasks) {
        if (!existingTasks.has(task)) db.addTask({ caseId, stageId: stage?.id ?? null, title: task, source: `review:${batch.id}` });
      }
      progress(review, batch, 'memory', 94, 'Сохраняю отчёт, задачи и контрольные вопросы в память дела.');
      const failed = db.listBatchDocuments(batchId).filter((document) => !terminalStatuses.has(document.status) || ['ocr_pending', 'converter_pending', 'unsupported', 'extraction_failed'].includes(document.status)).length;
      const finalStatus = failed ? 'complete_with_errors' : 'complete';
      db.updateReview(review.id, { status: 'complete', phase: 'complete', progress: 100, message: 'Первичный разбор завершён.', summary: report.findings[0], report, completedAt: new Date().toISOString() });
      db.updateBatch(batchId, {
        status: finalStatus, phase: 'complete', progress: 100,
        message: failed ? `Разбор завершён с предупреждениями: ${failedDocumentMessage(failed)}.` : 'Документы и первичный разбор дела готовы к диалогу.',
        completedAt: new Date().toISOString(),
      });
      return db.getReview(review.id);
    } catch (error) {
      db.updateReview(review.id, { status: 'failed', phase: 'review', message: error.message });
      db.updateBatch(batchId, { status: 'failed', phase: 'review', message: `Первичный анализ не завершён: ${error.message}` });
      throw error;
    }
  }

  return { run };
}

export { reportText };
