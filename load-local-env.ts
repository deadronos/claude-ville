import fs from 'fs';
import path from 'path';

function unquote(value: string, quote: string): string {
  if (quote === '"') {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  if (quote === "'") {
    return value
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }

  return value;
}

function parseLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
  const equalsIndex = normalized.indexOf('=');
  if (equalsIndex === -1) return null;

  const key = normalized.slice(0, equalsIndex).trim();
  if (!key || !/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(key)) return null;

  const rawValue = normalized.slice(equalsIndex + 1).trim();
  if (!rawValue) return { key, value: '' };

  const quote = rawValue[0];
  if ((quote === '"' || quote === "'") && rawValue[rawValue.length - 1] === quote) {
    return { key, value: unquote(rawValue.slice(1, -1), quote) };
  }

  return { key, value: rawValue };
}

export function loadLocalEnv(filePath = path.join(process.cwd(), '.env.local')) {
  if (!fs.existsSync(filePath)) return false;

  const contents = fs.readFileSync(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }

  return true;
}

loadLocalEnv();

export default loadLocalEnv;
