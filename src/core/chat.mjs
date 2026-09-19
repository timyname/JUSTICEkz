import { buildContext } from './context.mjs';

function offlineText({ context, asOf }) {
  const lines = [
    'Ответ локальной модели сейчас недоступен; показываю сохранённые доказательства и контрольные вопросы без догадок.',
    'Установлено:',
    `- Дата правового анализа: ${asOf}.`,
    '- Работаю в режиме доказательств: отделяю найденное в памяти дела от правовых источников и предположений.',
  ];
  if (context.legalSources.length) {
    lines.push('', 'Правовая опора:');
    for (const source of context.legalSources) lines.push(`- ${source.title}: ${source.content}`);
  }
  if (context.caseDocuments.length) {
    lines.push('', 'Факты из памяти текущего дела:');
    for (const document of context.caseDocuments) lines.push(`- ${document.title}: ${document.content}`);
  }
  lines.push('', 'Не подтверждено:', '- Дату процессуального действия, документ-основание и факты, которые ещё не отражены в памяти дела.', '', 'Риски:', '- Не делаю окончательный юридический вывод без проверки оригиналов и редакции нормы на нужную дату.', '', 'Ближайший шаг:', '- Уточнить, какой результат нужен и какие даты/документы являются ключевыми.');
  return lines.join('\n');
}

function verifiedNotes(context) {
  const lines = ['Проверяемые материалы из памяти дела:'];
  if (context.caseDocuments.length) {
    for (const document of context.caseDocuments.slice(0, 8)) lines.push(`- ${document.title}: ${document.content}`);
  } else {
    lines.push('- По смыслу вопроса релевантные фрагменты в памяти дела не найдены.');
  }
  if (context.warnings.length) {
    lines.push('', 'Контрольные предупреждения:');
    for (const warning of context.warnings) lines.push(`- ${warning}`);
  }
  return lines.join('\n');
}

export function createChatService({ db, model }) {
  return {
    async ask({ caseId, message, asOf }) {
      if (!caseId || !message?.trim()) throw new Error('caseId and message are required');
      const context = buildContext({ db, caseId, message, asOf });
      db.addMessage({ caseId, role: 'user', content: message.trim() });
      const system = [
        'Ты локальный помощник по праву Республики Казахстан.',
        'Не выдумывай нормы. Разделяй источники права, факты дела и предположения.',
        `Анализируй право в редакции, действовавшей на дату ${asOf}.`,
        'Отвечай по структуре: Установлено; Не подтверждено; Правовая опора; Риски; Варианты действий; Ближайший шаг.',
        'Не раскрывай скрытую цепочку рассуждений. Показывай только краткие проверяемые основания, ссылки на найденные документы и то, что нужно уточнить.',
        'Действуй в интересах обратившейся стороны, но сначала явно укажи, если её процессуальная роль не определена.',
        'Если данных не хватает, задай конкретные уточняющие вопросы.',
      ].join(' ');
      const prompt = [
        `Вопрос пользователя: ${message.trim()}`,
        `Дата анализа: ${asOf}`,
        'Контекст из изолированной памяти:',
        context.promptContext || '(релевантные фрагменты не найдены)',
      ].join('\n');
      let text = null;
      let mode = 'offline';
      const warnings = [...context.warnings];
      if (model?.configured) {
        try {
          text = await model.complete({ messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], maxTokens: 192 });
          mode = 'local-model';
        } catch (error) {
          warnings.push(`Локальная модель недоступна: ${error.message}`);
        }
      }
      if (!text) text = offlineText({ context, asOf });
      else if (text.length < 700 || !/Установлено|Не подтверждено|Варианты действий/i.test(text)) text = `${text}\n\n${verifiedNotes(context)}`;
      db.addMessage({ caseId, role: 'assistant', content: text });
      return { text, mode, asOf, sources: context.legalSources, caseDocuments: context.caseDocuments, warnings };
    },
  };
}
