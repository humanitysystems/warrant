import type { PolicyConfig } from '@/config/schema';

export type { PolicyConfig };

export interface ToolCallRef {
  exposedName: string;
}

export type Verdict =
  | { action: 'allow'; ruleId?: string }
  | { action: 'confirm'; ruleId: string; reason: string }
  | { action: 'block'; ruleId: string; reason: string };

const DEFAULT_BLOCK_RULE_ID = 'default';

export class PolicyEngine {
  private readonly rules: { rule: PolicyConfig['rules'][number]; regex?: RegExp }[];

  constructor(private readonly config: Omit<PolicyConfig, 'confirmTimeoutMs'>) {
    this.rules = config.rules.map((rule) => ({
      rule,
      ...(rule.match !== undefined ? { regex: new RegExp(rule.match) } : {}),
    }));
  }

  evaluate(call: ToolCallRef): Verdict {
    const matches = this.matchesFor(call);
    const blocked = matches.find(({ rule }) => rule.effect === 'block');
    if (blocked) {
      return {
        action: 'block',
        ruleId: blocked.rule.id,
        reason: `Matched block rule "${blocked.rule.id}"`,
      };
    }
    const confirmed = matches.find(({ rule }) => rule.effect === 'confirm');
    if (confirmed) {
      return {
        action: 'confirm',
        ruleId: confirmed.rule.id,
        reason: `Matched confirm rule "${confirmed.rule.id}"`,
      };
    }
    const allowed = matches.find(({ rule }) => rule.effect === 'allow');
    if (allowed) return { action: 'allow', ruleId: allowed.rule.id };
    return this.defaultVerdict();
  }

  private matchesFor(call: ToolCallRef) {
    return this.rules.filter(
      ({ rule, regex }) =>
        (rule.tools !== undefined && rule.tools.includes(call.exposedName)) ||
        regex?.test(call.exposedName) === true,
    );
  }

  private defaultVerdict(): Verdict {
    return this.config.defaultAction === 'block'
      ? {
          action: 'block',
          ruleId: DEFAULT_BLOCK_RULE_ID,
          reason: 'No matching policy (defaultAction: block)',
        }
      : { action: 'allow' };
  }
}
