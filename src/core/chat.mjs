import { buildContext } from './context.mjs';

function offlineText({ context, asOf }) {
  const lines = [
    'Работаю в режиме без подключённой локальной модели.',
    `Дата правового анализа: ${asOf}.`,
    'Окончательный юридический вывод без модели не формирую; ниже только найденные материалы и вопросы для проверки.',
  ];
  if (context.legalSources.length) {
    lines.push('', 'Источники права:');
    for (const source of context.legalSources) lines.push(`- ${source.title}: ${source.content}`);
  }
  if (context.caseDocuments.length) {
    lines.push('', 'Фрагменты текущего дела:');
    for (const document of context.caseDocuments) lines.push(`- ${document.title}: ${document.content}`);
  }
  lines.push('', 'Нужно подтвердить: дату процессуального действия, документ-основание и факты, которые ещё не отражены в памяти дела.');
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
          text = await model.complete({ messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] });
          mode = 'local-model';
        } catch (error) {
          warnings.push(`Локальная модель недоступна: ${error.message}`);
        }
      }
      if (!text) text = offlineText({ context, asOf });
      db.addMessage({ caseId, role: 'assistant', content: text });
      return { text, mode, asOf, sources: context.legalSources, caseDocuments: context.caseDocuments, warnings };
    },
  };
}
