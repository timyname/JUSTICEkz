import { searchMemories } from './search.mjs';

export function buildContext({ db, caseId, message, asOf, limit = 8 }) {
  const result = searchMemories({ db, query: message, caseId, asOf, limit });
  const warnings = [];
  if (!result.caseDocuments.length) warnings.push('В памяти текущего дела не найден фрагмент по этому вопросу.');
  if (!result.legalSources.length) warnings.push('В выбранной редакции правовой базы не найден источник по этому вопросу.');
  const caseText = result.caseDocuments.map((item) => `[ДЕЛО] ${item.title}: ${item.content}`).join('\n');
  const lawText = result.legalSources.map((item) => `[ПРАВО] ${item.title}: ${item.content}`).join('\n');
  const promptContext = [lawText.slice(0, 350), caseText.slice(0, 249)].filter(Boolean).join('\n');
  return {
    ...result,
    asOf,
    warnings,
    promptContext,
  };
}
