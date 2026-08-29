import { loadConfig, writeConfig } from '@/config/loader';
import { downstreamSchema } from '@/config/schema';
import type { WarrantConfig } from '@/config/schema';

export function resolveConfigPath(flag?: string): string {
  return flag ?? process.env.WARRANT_CONFIG ?? 'warrant.yaml';
}

export function resolveAdminUrl(flag?: string): string {
  return flag ?? process.env.WARRANT_ADMIN_URL ?? 'http://127.0.0.1:8787';
}

export async function fileAddServer(path: string, raw: unknown): Promise<WarrantConfig> {
  const parsed = downstreamSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid downstream server config: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  const config = await loadConfig(path);
  if (config.downstream.some((c) => c.name === parsed.data.name)) {
    throw new Error(`Duplicate downstream server: ${parsed.data.name}`);
  }
  config.downstream.push(parsed.data);
  await writeConfig(path, config);
  return config;
}

export async function fileRemoveServer(path: string, name: string): Promise<WarrantConfig> {
  const config = await loadConfig(path);
  if (!config.downstream.some((c) => c.name === name)) {
    throw new Error(`Unknown downstream server: ${name}`);
  }
  config.downstream = config.downstream.filter((c) => c.name !== name);
  await writeConfig(path, config);
  return config;
}

export async function fileServerNames(path: string): Promise<string[]> {
  const config = await loadConfig(path);
  return config.downstream.map((c) => c.name);
}
