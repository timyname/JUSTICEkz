import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDatabase } from '../src/core/db.mjs';
import { createCaseGoalService } from '../src/core/case-goal.mjs';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'justicekz-goal-'));
}

test('case goal is stored in case memory and produces a debt challenge draft', () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const caseItem = db.createCase({ title: 'ЭКСПЕРТ ПЛЮС' });
  const service = createCaseGoalService({ db });

  const result = service.save({
    caseId: caseItem.id,
    goal: 'debt_challenge',
    customGoal: 'Оспорить долг и остановить взыскание',
  });

  assert.equal(result.goal.code, 'debt_challenge');
  assert.match(result.draft.title, /оспаривании долга/i);
  assert.ok(result.draft.timeline.length);
  assert.ok(result.draft.unknowns.length);
  assert.ok(db.listMemories({ scope: 'case', caseId: caseItem.id }).some((item) => item.kind === 'case_goal'));
  db.close();
});

test('case goals remain isolated between cases', () => {
  const db = createDatabase({ dataDir: tempDataDir() });
  const first = db.createCase({ title: 'Первое дело' });
  const second = db.createCase({ title: 'Второе дело' });
  const service = createCaseGoalService({ db });

  service.save({ caseId: first.id, goal: 'new_statement', customGoal: 'Заявление' });

  assert.equal(service.latest(first.id).goal.code, 'new_statement');
  assert.equal(service.latest(second.id), null);
  db.close();
});
