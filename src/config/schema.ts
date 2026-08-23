import { z } from 'zod';

const downstreamSchema = z.object({
  name: z.string().min(1),
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

const policyRuleSchema = z
  .object({
    id: z.string().min(1),
    effect: z.enum(['allow', 'block']),
    tools: z.array(z.string().min(1)).optional(),
    match: z
      .string()
      .refine((value) => {
        try {
          new RegExp(value);
          return true;
        } catch {
          return false;
        }
      }, 'match must be a valid regular expression')
      .optional(),
  })
  .refine((rule) => rule.tools !== undefined || rule.match !== undefined, {
    message: 'policy rule requires tools or match',
  });

export const warrantConfigSchema = z.object({
  server: z
    .object({
      host: z.string().default('127.0.0.1'),
      adminPort: z.number().int().min(1).max(65535).default(8787),
    })
    .default({}),
  downstream: z.array(downstreamSchema).default([]),
  policies: z
    .object({
      defaultAction: z.enum(['allow', 'block']).default('allow'),
      rules: z.array(policyRuleSchema).default([]),
    })
    .default({}),
  storage: z
    .object({
      path: z.string().min(1).default('warrant.db'),
    })
    .default({}),
});

export type PolicyConfig = z.infer<typeof warrantConfigSchema>['policies'];

export type DownstreamConfig = z.infer<typeof downstreamSchema>;
export type WarrantConfig = z.infer<typeof warrantConfigSchema>;
export type WarrantConfigInput = z.input<typeof warrantConfigSchema>;
