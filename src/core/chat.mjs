import { buildContext } from './context.mjs';

function compactLine(value, maxChars = 220) {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  const parts = raw.split(/(?<=[.!?])\s+/);
  const line = parts.length > 1 ? parts.filter((part, index) => index === 0 || part !== parts[index - 1]).join(' ') : raw;
  if (line.length <= maxChars) return line;
  return `${line.slice(0, maxChars - 1).trim()}…`;
}

function compactModelText(value, maxChars = 1800) {
  const lines = String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const output = [];
  let section = '';
  let sectionItems = 0;
  for (const line of lines) {
    const isHeading = /^[^:]{2,42}:$/.test(line);
    if (isHeading) {
      section = line.toLowerCase();
      sectionItems = 0;
      output.push(line);
      continue;
    }
    if (sectionItems >= 3) continue;
    const shortened = compactLine(line, /правовая опора|практика|источник/.test(section) ? 180 : 260);
    if (!shortened) continue;
    output.push(shortened);
    sectionItems += 1;
  }
  const text = output.join('\n');
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, maxChars - 1);
  const breakAt = clipped.lastIndexOf('\n');
  return `${(breakAt > 0 ? clipped.slice(0, breakAt) : clipped).trim()}…`;
}

function offlineText({ context, asOf, goal }) {
  const lines = [
    'Ответ локальной модели сейчас недоступен; показываю сохранённые доказательства и контрольные вопросы без догадок.',
    'Кратко:',
    `- Дата правового анализа: ${asOf}.`,
    `- В памяти дела найдено: ${context.caseDocuments.length} фрагм.; в правовой базе: ${context.legalSources.length} источник(а).`,
  ];
  if (context.legalSources.length) {
    lines.push('', 'Правовая опора:');
    for (const source of context.legalSources.slice(0, 2)) lines.push(`- ${compactLine(source.title, 100)}: ${compactLine(source.content, 180)}`);
  }
  if (context.caseDocuments.length) {
    lines.push('', 'Что найдено в деле:');
    for (const document of context.caseDocuments.slice(0, 3)) lines.push(`- ${compactLine(document.title, 100)}: ${compactLine(document.content, 210)}`);
  }
  lines.push('', 'Что проверить:', '- Дату процессуального действия, документ-основание и факты, которые ещё не отражены в памяти дела.', '', 'Возможные шаги:', '- Уточнить цель обращения и сопоставить документы с редакцией нормы на нужную дату.');
  if (goal) lines.push(`- Цель клиента: ${compactLine(goal.goal?.customText || goal.goal?.label || 'уточняется', 180)}.`);
  lines.push('', 'Следующий вопрос:', '- Какой результат нужен: оспорить долг, подготовить заявление или определить следующий процессуальный шаг?');
  return compactModelText(lines.join('\n'));
}

function verifiedNotes(context) {
  const lines = ['Проверяемые материалы из памяти дела:'];
  if (context.caseDocuments.length) {
    for (const document of context.caseDocuments.slice(0, 3)) lines.push(`- ${compactLine(document.title, 100)}: ${compactLine(document.content, 190)}`);
  } else {
    lines.push('- По смыслу вопроса релевантные фрагменты в памяти дела не найдены.');
  }
  if (context.warnings.length) {
    lines.push('', 'Контрольные предупреждения:');
    for (const warning of context.warnings.slice(0, 2)) lines.push(`- ${compactLine(warning, 220)}`);
  }
  return lines.join('\n');
}

export function createChatService({ db, model }) {
  return {
    async ask({ caseId, message, asOf }) {
      if (!caseId || !message?.trim()) throw new Error('caseId and message are required');
      const context = buildContext({ db, caseId, message, asOf });
      const goalMemory = db.listMemories({ scope: 'case', caseId }).filter((item) => item.kind === 'case_goal').at(-1);
      let goal = null;
      if (goalMemory) {
        try { goal = JSON.parse(goalMemory.content); } catch { goal = null; }
      }
      db.addMessage({ caseId, role: 'user', content: message.trim() });
      const system = [
        'Ты локальный помощник по праву Республики Казахстан.',
        'Не выдумывай нормы. Разделяй источники права, факты дела и предположения.',
        `Анализируй право в редакции, действовавшей на дату ${asOf}.`,
        'Отвечай по структуре: Установлено; Не подтверждено; Правовая опора; Риски; Варианты действий; Ближайший шаг.',
        'Пиши кратко: максимум 5–6 коротких пунктов. Не переписывай нормы, судебную практику и документы; называй только источник, статью или смысл правила. Длинные цитаты запрещены.',
        'Не раскрывай скрытую цепочку рассуждений. Показывай только краткие проверяемые основания, ссылки на найденные документы и то, что нужно уточнить.',
        'Действуй в интересах обратившейся стороны, но сначала явно укажи, если её процессуальная роль не определена.',
        'Если данных не хватает, задай конкретные уточняющие вопросы.',
        goal ? `Приоритет клиента: ${goal.goal?.customText || goal.goal?.label || 'уточняется'}.` : 'Цель клиента ещё не подтверждена; сначала уточни желаемый результат.',
      ].join(' ');
      const prompt = [
        `Вопрос пользователя: ${message.trim()}`,
        `Дата анализа: ${asOf}`,
        `Цель клиента: ${goal?.goal?.customText || goal?.goal?.label || 'не подтверждена'}`,
        'Контекст из изолированной памяти:',
        context.promptContext || '(релевантные фрагменты не найдены)',
      ].join('\n');
      let text = null;
      let mode = 'offline';
      const warnings = [...context.warnings];
      if (model?.configured) {
        try {
          text = compactModelText(await model.complete({ messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], maxTokens: 128 }));
          mode = 'local-model';
        } catch (error) {
          warnings.push(`Локальная модель недоступна: ${error.message}`);
        }
      }
      if (!text) text = offlineText({ context, asOf, goal });
      else if (text.length < 700 || !/Установлено|Не подтверждено|Варианты действий/i.test(text)) text = compactModelText(`${text}\n\n${verifiedNotes(context)}`);
      db.addMessage({ caseId, role: 'assistant', content: text });
      return { text, mode, asOf, sources: context.legalSources, caseDocuments: context.caseDocuments, warnings };
    },
  };
}
