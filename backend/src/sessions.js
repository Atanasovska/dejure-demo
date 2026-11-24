import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { readJsonSafe, writeFileAtomic } from './utils/fs-atomic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'dejure-demo')
  : path.resolve(__dirname, '..', 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

// Semplice lock per sessione (in memoria, per singolo processo)
const locks = new Map();
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const p = new Promise((res) => (release = res));
  locks.set(key, prev.then(() => p));
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === p) locks.delete(key);
  }
}

export function newSessionId() {
  return randomUUID();
}

export async function getSessionPath(sessionId) {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

export async function loadSession(sessionId) {
  const p = await getSessionPath(sessionId);
  return await readJsonSafe(p, null);
}

export async function saveSession(session) {
  const p = await getSessionPath(session.sessionId);
  await withLock(session.sessionId, async () => {
    await writeFileAtomic(p, JSON.stringify(session, null, 2));
  });
}

export function isExpired(session, ttlHours = 24) {
  if (!session?.createdAt) return false;
  const ttlMs = ttlHours * 3600 * 1000;
  return Date.now() - new Date(session.createdAt).getTime() > ttlMs;
}
