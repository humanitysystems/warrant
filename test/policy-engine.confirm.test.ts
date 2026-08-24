import { describe, expect, it } from 'vitest';
import { PolicyEngine } from '@/policy/policy-engine';

describe('PolicyEngine confirmation semantics', () => {
  it('returns a confirm verdict for a rule with the confirm effect', () => {
    const engine = new PolicyEngine({
      defaultAction: 'allow',
      rules: [{ id: 'confirm-sends', effect: 'confirm', match: 'send' }],
    });

    expect(engine.evaluate({ exposedName: 'demo__send_message' })).toEqual({
      action: 'confirm',
      ruleId: 'confirm-sends',
      reason: 'Matched confirm rule "confirm-sends"',
    });
  });

  it('rings block above confirm above allow when several rules match', () => {
    const engine = new PolicyEngine({
      defaultAction: 'allow',
      rules: [
        { id: 'allow-all', effect: 'allow', match: '.' },
        { id: 'confirm-remote', effect: 'confirm', match: 'remote' },
        { id: 'block-danger', effect: 'block', match: 'danger' },
      ],
    });

    expect(engine.evaluate({ exposedName: 'danger__remote_thing' }).action).toBe('block');
    expect(engine.evaluate({ exposedName: 'demo__remote_thing' }).action).toBe('confirm');
    expect(engine.evaluate({ exposedName: 'demo__plain' }).action).toBe('allow');
  });
});
