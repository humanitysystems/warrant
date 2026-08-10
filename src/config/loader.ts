import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { warrantConfigSchema, type WarrantConfig } from './schema.js';

export async function loadConfig(path = 'warrant.yaml'): Promise<WarrantConfig> {
  const filePath = resolve(path);
  const source = await readFile(filePath, 'utf8');
  return warrantConfigSchema.parse(parse(source));
}
