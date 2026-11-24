import { promises as fs } from 'fs';
import path from 'path';

// Scrittura atomica: scrive su file temporaneo e poi rinomina
export async function writeFileAtomic(filePath, data, options = 'utf8') {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${Date.now()}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmp, data, options);
  await fs.rename(tmp, filePath);
}

export async function readJsonSafe(filePath, fallback = null) {
  try {
    const txt = await fs.readFile(filePath, 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}
