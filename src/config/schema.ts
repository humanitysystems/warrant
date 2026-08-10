import { z } from 'zod';

const downstreamSchema = z.object({
  name: z.string().min(1),
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

export const warrantConfigSchema = z.object({
  server: z
    .object({
      host: z.string().default('127.0.0.1'),
      adminPort: z.number().int().min(1).max(65535).default(8787),
    })
    .default({}),
  downstream: z.array(downstreamSchema).default([]),
});

export type DownstreamConfig = z.infer<typeof downstreamSchema>;
export type WarrantConfig = z.infer<typeof warrantConfigSchema>;
