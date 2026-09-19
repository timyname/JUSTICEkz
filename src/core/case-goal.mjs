const GOAL_OPTIONS = {
  additional_requirements: {
    label: 'Дополнительные требования',
    documentType: 'Уточнение требований / дополнительные требования',
    title: 'Проект дополнительных требований',
  },
  new_statement: {
    label: 'Новое заявление',
    documentType: 'Заявление по материалам дела',
    title: 'Проект нового заявления',
  },
  debt_challenge: {
    label: 'Оспорить долг',
    documentType: 'Исковое заявление об оспаривании долга',
    title: 'Проект иска об оспаривании долга',
  },
  custom: {
    label: 'Другая цель',
    documentType: 'Проект документа по цели клиента',
    title: 'Проект по цели клиента',
  },
};

function parseGoal(memory) {
  if (!memory) return null;
  try {
    return JSON.parse(memory.content);
  } catch {
    return { goal: { code: 'custom', label: memory.content }, draft: null };
  }
}

function buildDraft({ caseItem, stage, report, events, goal, customGoal }) {
  const option = GOAL_OPTIONS[goal] ?? GOAL_OPTIONS.custom;
  const briefing = report?.briefing ?? {};
  const dateAnchors = report?.dateAnchors?.length
    ? report.dateAnchors
    : events.length ? events.map((event) => ({
      date: event.event_date,
      title: event.title,
      status: event.status === 'confirmed' ? 'confirmed' : 'proposal',
      source: event.original_name || 'материалы дела',
    })) : [{ date: null, title: 'Опорные даты не установлены', status: 'unknown', source: 'требуется подтверждение' }];
  const unknowns = [
    'Проверить наименование суда или адресата и подсудность по актуальной редакции права.',
    'Подтвердить процессуальную роль, полные реквизиты сторон и представителей.',
    'Сверить каждую дату, сумму и ссылку на документ с оригиналом и страницей.',
    ...(report?.gaps ?? []).slice(0, 4),
  ];
  const grounds = [
    ...(report?.violations ?? []).map((item) => `${item.title}: ${item.basis}`),
    'Правовые основания и нормы нужно подобрать и проверить на дату процессуального действия.',
  ];
  const requests = goal === 'debt_challenge'
    ? ['Признать долг или его размер не подтверждённым в заявленной части.', 'Проверить законность основания и порядка взыскания.', 'Применить обеспечительные меры только при наличии подтверждённой необходимости.']
    : goal === 'additional_requirements'
      ? ['Уточнить или дополнить требования в пределах установленного предмета спора.', 'Приобщить подтверждающие документы и расчёт.']
      : ['Определить адресата и сформулировать просительную часть после проверки фактов и срока.'];

  return {
    title: option.title,
    documentType: option.documentType,
    status: 'draft_outline',
    warning: 'Это доказательственный каркас. Перед подачей проверьте суд, сроки, реквизиты, нормы и приложения.',
    caseTitle: caseItem.title,
    stageTitle: stage?.title ?? null,
    purpose: customGoal || option.label,
    facts: briefing.whatHappened?.length ? briefing.whatHappened : ['Фактические обстоятельства нужно заполнить по подтверждённым документам.'],
    parties: briefing.parties?.length ? briefing.parties : ['Стороны и их процессуальные роли требуют подтверждения.'],
    obligations: briefing.obligations?.length ? briefing.obligations : ['Обязательства и основание долга требуют подтверждения.'],
    timeline: dateAnchors,
    grounds,
    requests,
    attachments: ['Документ-основание требования или взыскания.', 'Подтверждение получения и направления документов.', 'Расчёт суммы и таблица разногласий.', 'Доверенность или сведения о полномочиях представителя.'],
    unknowns: [...new Set(unknowns.filter(Boolean))],
  };
}

export function createCaseGoalService({ db }) {
  function latest(caseId) {
    const memory = db.listMemories({ scope: 'case', caseId }).filter((item) => item.kind === 'case_goal').at(-1);
    return parseGoal(memory);
  }

  function save({ caseId, goal = 'custom', customGoal = '' }) {
    const caseItem = db.getCase(caseId);
    if (!caseItem) throw new Error('Case not found');
    const normalizedGoal = GOAL_OPTIONS[goal] ? goal : 'custom';
    const stage = db.listStages(caseId).find((item) => item.id === caseItem.current_stage_id);
    const review = db.getLatestReview(caseId);
    const draft = buildDraft({ caseItem, stage, report: review?.report, events: db.listEvents(caseId), goal: normalizedGoal, customGoal: String(customGoal || '').trim() });
    const payload = {
      goal: { code: normalizedGoal, label: GOAL_OPTIONS[normalizedGoal].label, customText: String(customGoal || '').trim() },
      draft,
      savedAt: new Date().toISOString(),
    };
    db.addMemory({ scope: 'case', caseId, stageId: stage?.id ?? null, kind: 'case_goal', title: `Цель клиента · ${payload.goal.label}`, content: JSON.stringify(payload) });
    return payload;
  }

  function draftFor(caseId) {
    return latest(caseId)?.draft ?? null;
  }

  return { latest, save, draftFor, options: GOAL_OPTIONS };
}

export { GOAL_OPTIONS, buildDraft };
