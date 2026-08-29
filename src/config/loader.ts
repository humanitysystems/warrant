import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { warrantConfigSchema, type WarrantConfig } from '@/config/schema';

export async function loadConfig(path = 'warrant.yaml'): Promise<WarrantConfig> {
  const filePath = resolve(path);
  const source = await readFile(filePath, 'utf8');
  return warrantConfigSchema.parse(parse(source));
}

export async function writeConfig(path: string, config: WarrantConfig): Promise<void> {
  const filePath = resolve(path);
  const source = stringify(config);
  await writeFile(filePath, source, 'utf8');
}
