import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PROPERTY_TYPES, readTaskStatus } from '../../scripts/lib/sprint-context.mjs';

describe('sprint-context.mjs', () => {
  describe('PROPERTY_TYPES', () => {
    it('has sprint, epic, and task entries', () => {
      assert(PROPERTY_TYPES.sprint);
      assert(PROPERTY_TYPES.epic);
      assert(PROPERTY_TYPES.task);
    });

    it('sprint uses select type for status', () => {
      assert.strictEqual(PROPERTY_TYPES.sprint.status.type, 'select');
      assert.strictEqual(PROPERTY_TYPES.sprint.status.property, '상태');
    });

    it('epic uses select type for status', () => {
      assert.strictEqual(PROPERTY_TYPES.epic.status.type, 'select');
      assert.strictEqual(PROPERTY_TYPES.epic.status.property, '상태');
    });

    it('task uses status type for status (DIFFERENT from sprint/epic)', () => {
      assert.strictEqual(PROPERTY_TYPES.task.status.type, 'status');
      assert.strictEqual(PROPERTY_TYPES.task.status.property, '상태');
    });

    it('epic has GP prefix for unique ID', () => {
      assert.strictEqual(PROPERTY_TYPES.epic.uniqueId.prefix, 'GP');
    });

    it('task has TSK prefix for unique ID', () => {
      assert.strictEqual(PROPERTY_TYPES.task.uniqueId.prefix, 'TSK');
    });

    it('sprint has forward relation to epics', () => {
      assert.strictEqual(PROPERTY_TYPES.sprint.epics.property, '개발팀 에픽');
      assert.strictEqual(PROPERTY_TYPES.sprint.epics.type, 'relation');
    });

    it('epic has forward relation to tasks', () => {
      assert.strictEqual(PROPERTY_TYPES.epic.tasks.property, '관계형 그룹');
      assert.strictEqual(PROPERTY_TYPES.epic.tasks.type, 'relation');
    });
  });

  describe('readTaskStatus', () => {
    it('reads status from a page with status type property', () => {
      const mockPage = {
        properties: {
          '상태': { status: { name: '진행 중' } },
        },
      };
      assert.strictEqual(readTaskStatus(mockPage), '진행 중');
    });

    it('returns null for missing status', () => {
      const mockPage = { properties: {} };
      assert.strictEqual(readTaskStatus(mockPage), null);
    });

    it('returns null for null status', () => {
      const mockPage = {
        properties: {
          '상태': { status: null },
        },
      };
      assert.strictEqual(readTaskStatus(mockPage), null);
    });
  });
});
