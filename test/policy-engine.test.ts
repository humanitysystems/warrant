import { describe, expect, it } from 'vitest';
import { PolicyEngine } from '@/policy/policy-engine';

describe('PolicyEngine', () => {
  it('blocks a call whose exposed tool name an explicit block rule names', () => {
    const engine = new PolicyEngine({
      defaultAction: 'allow',
      rules: [{ id: 'no-writes', effect: 'block', tools: ['demo__write_file'] }],
    });

    const verdict = engine.evaluate({ exposedName: 'demo__write_file' });

    expect(verdict).toEqual({
      action: 'block',
      ruleId: 'no-writes',
      reason: 'Matched block rule "no-writes"',
    });
  });

  it('allows a call an explicit allow rule names, carrying its rule id', () => {
    const engine = new PolicyEngine({
      defaultAction: 'block',
      rules: [{ id: 'read-demo', effect: 'allow', tools: ['demo__read_file'] }],
    });

    expect(engine.evaluate({ exposedName: 'demo__read_file' })).toEqual({
      action: 'allow',
      ruleId: 'read-demo',
    });
  });

  it('applies deny-overrides: a block rule wins even when an allow rule also matches', () => {
    const engine = new PolicyEngine({
      defaultAction: 'allow',
      rules: [
        { id: 'allow-demo-reads', effect: 'allow', match: '^demo__read' },
        { id: 'no-secrets', effect: 'block', match: 'secret' },
      ],
    });

    const verdict = engine.evaluate({ exposedName: 'demo__read_secret' });

    expect(verdict.action).toBe('block');
    expect(verdict).toMatchObject({ action: 'block', ruleId: 'no-secrets' });
  });

  it('matches by regex on the exposed tool name when no exact list applies', () => {
    const engine = new PolicyEngine({
      defaultAction: 'block',
      rules: [{ id: 'demo-allow-all', effect: 'allow', match: '^demo__' }],
    });

    expect(engine.evaluate({ exposedName: 'demo__anything_else' }).action).toBe('allow');
  });

  it('falls back to defaultAction when nothing matches: block posture', () => {
    const engine = new PolicyEngine({ defaultAction: 'block', rules: [] });

    expect(engine.evaluate({ exposedName: 'other__tool' })).toEqual({
      action: 'block',
      ruleId: 'default',
      reason: 'No matching policy (defaultAction: block)',
    });
  });

  it('falls back to defaultAction when nothing matches: allow posture', () => {
    const engine = new PolicyEngine({
      defaultAction: 'allow',
      rules: [{ id: 'unrelated', effect: 'block', tools: ['x__y'] }],
    });

    expect(engine.evaluate({ exposedName: 'other__tool' })).toEqual({
      action: 'allow',
    });
  });
});
