import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { newSessionId, loadSession, saveSession, isExpired } from './sessions.js';
import { readJsonSafe, writeFileAtomic } from './utils/fs-atomic.js';

// Helper risposte
function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}
function fail(res, code, message, status = 400) {
  return res.status(status).json({ ok: false, error: { code, message } });
}

// Path robusti rispetto alla posizione del file corrente
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_DATA_DIR = path.resolve(__dirname, '..', 'data');
const STATE_DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'dejure-demo')
  : STATIC_DATA_DIR;
const PROJECTS_DIR = path.join(STATE_DATA_DIR, 'projects');
const PROJECTS_INDEX_PATH = path.join(PROJECTS_DIR, 'index.json');
const SCOPES_DIR = path.join(STATE_DATA_DIR, 'scopes');
const SCOPES_ARCHIVE_PATH = path.join(SCOPES_DIR, 'archivio.json');

// Carica esplicitamente backend/.env anche se il processo parte dalla root
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const PORT = Number(process.env.PORT || 3001);
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 24);

// CORS: durante lo sviluppo consenti localhost:5173
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/], credentials: false }));
app.use(express.json({ limit: '1mb' }));

// Caricamento documenti
const DOCS_PATH = path.join(STATIC_DATA_DIR, 'documents.json');
const DIVORCE_DOCS_PATH = path.join(STATIC_DATA_DIR, 'divorce-documents.json');
function stripHtml(input = '') {
  return String(input).replace(/<[^>]*>/g, '');
}

function inferTabFromText(text = '') {
  const t = String(text).toLowerCase();
  if (t.includes('prassi')) return 'Prassi';
  return 'Leggi Nazionali';
}

function normalizeFromSearchPayload(payload) {
  const hits = Array.isArray(payload?.hits)
    ? payload.hits
    : (Array.isArray(payload?.hits?.hits) ? payload.hits.hits : null);
  if (!Array.isArray(hits)) return null;

  return hits.map((h) => {
    const title = h?._source?.provvedimento?.campiCalcolati?.dejure_estremo || h?._id || 'Documento';
    const fullText = h?._source?.testo || '';
    const highlight = h?.highlight?.testo?.[0]
      || h?.highlight?.['testo.italian']?.[0]
      || h?.highlight?.['testo.italian_stemmer']?.[0]
      || '';
    const excerptRaw = highlight || String(fullText).slice(0, 280);
    const excerpt = stripHtml(excerptRaw);
    const archive = h?._index === 'dpp_legge' ? 'Normativa' : 'Giurisprudenza';

    const sortDate = Array.isArray(h?.sort) && h.sort.length ? new Date(Number(h.sort[0])) : null;
    const dateStr = sortDate && !Number.isNaN(sortDate.getTime())
      ? sortDate.toLocaleDateString('it-IT')
      : '';
    const meta = [dateStr, archive].filter(Boolean).join(' · ');

    const tab = inferTabFromText(`${title} ${fullText}`);

    return {
      id: h?._id || `${h?._index || 'doc'}-${Math.random().toString(36).slice(2, 8)}`,
      archive,
      tab,
      title,
      meta,
      excerpt,
      content: fullText
    };
  });
}

async function getDocumentsData() {
  const raw = await readJsonSafe(DOCS_PATH, []);
  let items = [];

  if (Array.isArray(raw)) {
    items = raw;
  } else if (raw && Array.isArray(raw.items)) {
    items = raw.items;
  } else {
    const normalized = normalizeFromSearchPayload(raw);
    items = Array.isArray(normalized) ? normalized : [];
  }

  const divorceDocs = await readJsonSafe(DIVORCE_DOCS_PATH, []);
  if (Array.isArray(divorceDocs)) items = [...items, ...divorceDocs];

  const normalizedItems = items.map((d) => {
    if (d.tab) return d;
    return { ...d, tab: inferTabFromText(`${d.title || ''} ${d.meta || ''} ${d.content || ''}`) };
  });

  const computed = {
    'Leggi Nazionali': 0,
    'Leggi Regionali': 0,
    Prassi: 0
  };
  normalizedItems.forEach((d) => {
    if (computed[d.tab] !== undefined) computed[d.tab] += 1;
  });

  return {
    items: normalizedItems,
    tabCounts: computed
  };
}

async function getAllDocuments() {
  const out = await getDocumentsData();
  return out.items;
}
async function getDocById(id) {
  const list = await getAllDocuments();
  return list.find(d => d.id === id) || null;
}

async function loadProjectsIndex() {
  const data = await readJsonSafe(PROJECTS_INDEX_PATH, { items: [] });
  if (!data || !Array.isArray(data.items)) return { items: [] };
  return data;
}

async function saveProjectsIndex(index) {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  await writeFileAtomic(PROJECTS_INDEX_PATH, JSON.stringify(index, null, 2));
}

async function loadScopesArchive() {
  const data = await readJsonSafe(SCOPES_ARCHIVE_PATH, { items: [] });
  if (!data || !Array.isArray(data.items)) return { items: [] };
  return data;
}

async function saveScopesArchive(archive) {
  await fs.mkdir(SCOPES_DIR, { recursive: true });
  await writeFileAtomic(SCOPES_ARCHIVE_PATH, JSON.stringify(archive, null, 2));
}

function buildProjectName(session) {
  const firstUser = (session.messages || []).find((m) => m.role === 'user' && m.content)?.content || '';
  const short = String(firstUser).trim().slice(0, 80);
  if (short) return short;
  return `Progetto ${new Date().toLocaleString('it-IT')}`;
}

app.get('/api/health', (req, res) => ok(res, {
  status: 'ok',
  time: new Date().toISOString(),
  chatMode: 'demo'
}));

app.get('/api/documents', async (req, res) => {
  try {
    const data = await getDocumentsData();
    return ok(res, {
      items: data.items,
      total: data.items.length,
      tabCounts: data.tabCounts
    });
  } catch (e) {
    return fail(res, 'documents_read_error', 'Impossibile leggere i documenti', 500);
  }
});

app.get('/api/documents/:id', async (req, res) => {
  const { id } = req.params;
  const doc = await getDocById(id);
  if (!doc) return fail(res, 'not_found', 'Documento non trovato', 404);
  return ok(res, doc);
});

// Sessioni
app.post('/api/sessions', async (req, res) => {
  const sessionId = newSessionId();
  const now = new Date().toISOString();
  const session = {
    sessionId,
    createdAt: now,
    updatedAt: now,
    selectedDocuments: [],
    attachments: [],
    messages: []
  };
  await saveSession(session);
  return ok(res, { sessionId }, 201);
});

app.get('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const s = await loadSession(sessionId);
  if (!s) return fail(res, 'not_found', 'Sessione non trovata', 404);
  if (isExpired(s, SESSION_TTL_HOURS)) return fail(res, 'expired', 'Sessione scaduta', 410);
  return ok(res, s);
});

app.patch('/api/sessions/:sessionId/scope', async (req, res) => {
  const { sessionId } = req.params;
  const body = req.body;
  if (!body || !Array.isArray(body.selectedDocuments)) {
    return fail(res, 'invalid_body', 'selectedDocuments deve essere un array');
  }
  const s = await loadSession(sessionId);
  if (!s) return fail(res, 'not_found', 'Sessione non trovata', 404);
  if (isExpired(s, SESSION_TTL_HOURS)) return fail(res, 'expired', 'Sessione scaduta', 410);
  const docs = await getAllDocuments();
  const allow = new Set(docs.map(d => d.id));
  s.selectedDocuments = body.selectedDocuments.filter(id => allow.has(id));
  s.updatedAt = new Date().toISOString();
  await saveSession(s);
  return ok(res, { selectedDocuments: s.selectedDocuments });
});

app.post('/api/sessions/:sessionId/messages', async (req, res) => {
  const { sessionId } = req.params;
  const { role, content, selectedDocuments } = req.body || {};
  if (!role || !content || !['user', 'assistant', 'system'].includes(role))
    return fail(res, 'invalid_message', 'Messaggio non valido');
  const s = await loadSession(sessionId);
  if (!s) return fail(res, 'not_found', 'Sessione non trovata', 404);
  if (isExpired(s, SESSION_TTL_HOURS)) return fail(res, 'expired', 'Sessione scaduta', 410);
  const message = { role, content };
  if (role === 'assistant' && Array.isArray(selectedDocuments)) {
    const allowed = new Set((await getAllDocuments()).map((doc) => doc.id));
    message.selectedDocuments = selectedDocuments.filter((id) => typeof id === 'string' && allowed.has(id));
  }
  s.messages.push(message);
  s.updatedAt = new Date().toISOString();
  await saveSession(s);
  return ok(res, { messages: s.messages }, 201);
});

app.post('/api/sessions/:sessionId/attachments', async (req, res) => {
  const { sessionId } = req.params;
  const { name, content } = req.body || {};
  if (!name || typeof name !== 'string') return fail(res, 'invalid_attachment', 'name non valido');
  if (!content || typeof content !== 'string') return fail(res, 'invalid_attachment', 'content non valido');
  if (content.length > 200000) return fail(res, 'attachment_too_large', 'Documento troppo grande (max 200.000 caratteri)');

  const s = await loadSession(sessionId);
  if (!s) return fail(res, 'not_found', 'Sessione non trovata', 404);
  if (isExpired(s, SESSION_TTL_HOURS)) return fail(res, 'expired', 'Sessione scaduta', 410);

  const attachments = Array.isArray(s.attachments) ? s.attachments : [];
  attachments.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.slice(0, 180),
    content,
    createdAt: new Date().toISOString()
  });
  s.attachments = attachments;
  s.updatedAt = new Date().toISOString();
  await saveSession(s);
  return ok(res, { total: attachments.length }, 201);
});

// Progetti: salvataggio chat e archivio
app.post('/api/projects', async (req, res) => {
  const { sessionId, name } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string') {
    return fail(res, 'invalid_body', 'sessionId obbligatorio');
  }

  const s = await loadSession(sessionId);
  if (!s) return fail(res, 'not_found', 'Sessione non trovata', 404);

  const projectId = newSessionId();
  const now = new Date().toISOString();
  const projectName = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 180) : buildProjectName(s);

  const project = {
    projectId,
    name: projectName,
    createdAt: now,
    updatedAt: now,
    sourceSessionId: sessionId,
    selectedDocuments: s.selectedDocuments || [],
    attachments: s.attachments || [],
    messages: s.messages || []
  };

  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);
  await writeFileAtomic(projectPath, JSON.stringify(project, null, 2));

  const index = await loadProjectsIndex();
  index.items.unshift({
    projectId,
    name: projectName,
    createdAt: now,
    updatedAt: now,
    sourceSessionId: sessionId,
    messagesCount: (project.messages || []).length
  });
  await saveProjectsIndex(index);

  return ok(res, { projectId, name: projectName }, 201);
});

app.get('/api/projects', async (req, res) => {
  const index = await loadProjectsIndex();
  const items = [...index.items].sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });
  return ok(res, { items, total: items.length });
});

app.get('/api/projects/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);
  const project = await readJsonSafe(projectPath, null);
  if (!project) return fail(res, 'not_found', 'Progetto non trovato', 404);
  return ok(res, project);
});

// Perimetri: salvataggio e archivio
app.post('/api/scopes', async (req, res) => {
  const { sessionId, name } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string') {
    return fail(res, 'invalid_body', 'sessionId obbligatorio');
  }

  const s = await loadSession(sessionId);
  if (!s) return fail(res, 'not_found', 'Sessione non trovata', 404);

  const ids = Array.isArray(s.selectedDocuments) ? s.selectedDocuments : [];
  if (!ids.length) return fail(res, 'empty_scope', 'Nessun documento selezionato nel perimetro', 400);

  const docs = await getAllDocuments();
  const byId = new Map(docs.map((d) => [d.id, d]));
  const selectedDocuments = ids.map((id) => ({ id, title: byId.get(id)?.title || id }));

  const now = new Date().toISOString();
  const scopeId = newSessionId();
  const scopeName = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 180) : `Perimetro ${new Date().toLocaleString('it-IT')}`;
  const documentsCount = selectedDocuments.length;
  const scope = {
    scopeId,
    name: scopeName,
    createdAt: now,
    updatedAt: now,
    sourceSessionId: sessionId,
    documentsCount,
    selectedDocuments
  };

  const archive = await loadScopesArchive();
  archive.items.unshift(scope);
  await saveScopesArchive(archive);

  return ok(res, {
    scopeId,
    name: scopeName,
    documentsCount,
    savedAt: now
  }, 201);
});

app.get('/api/scopes', async (req, res) => {
  const archive = await loadScopesArchive();
  const items = [...archive.items].sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  }).map((s) => ({
    scopeId: s.scopeId,
    name: s.name,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    documentsCount: s.documentsCount || (Array.isArray(s.selectedDocuments) ? s.selectedDocuments.length : 0)
  }));
  return ok(res, { items, total: items.length });
});

app.get('/api/scopes/:scopeId', async (req, res) => {
  const { scopeId } = req.params;
  const archive = await loadScopesArchive();
  const scope = archive.items.find((x) => x.scopeId === scopeId) || null;
  if (!scope) return fail(res, 'not_found', 'Perimetro non trovato', 404);
  return ok(res, scope);
});

app.delete('/api/scopes/:scopeId', async (req, res) => {
  const { scopeId } = req.params;
  const archive = await loadScopesArchive();
  const before = archive.items.length;
  archive.items = archive.items.filter((x) => x.scopeId !== scopeId);
  if (archive.items.length === before) return fail(res, 'not_found', 'Perimetro non trovato', 404);
  await saveScopesArchive(archive);

  return ok(res, { deleted: true });
});

// Chat: streaming SSE-like via fetch (POST) con text/event-stream
app.post('/api/sessions/:sessionId/chat', async (req, res) => {
  const { sessionId } = req.params;
  const { message } = req.body || {};
  if (!message || typeof message !== 'string')
    return fail(res, 'invalid_body', 'message mancante o non valido');

  const s = await loadSession(sessionId);
  if (!s) return fail(res, 'not_found', 'Sessione non trovata', 404);
  if (isExpired(s, SESSION_TTL_HOURS)) return fail(res, 'expired', 'Sessione scaduta', 410);
  const send = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      // socket chiuso dal client/proxy
    }
  };

  const initSse = () => {
    if (res.headersSent) return;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
  };

  try {
    // Costruisci contesto dai documenti selezionati
    const docs = await getAllDocuments();
    const byId = new Map(docs.map(d => [d.id, d]));
    const scopeDocs = (s.selectedDocuments || []).map(id => byId.get(id)).filter(Boolean);

    const attachments = Array.isArray(s.attachments) ? s.attachments : [];

    // Salva subito il messaggio utente
    s.messages.push({ role: 'user', content: message });
    s.updatedAt = new Date().toISOString();
    await saveSession(s);

    // Se non ci sono documenti nel perimetro, ritorna messaggio utile e chiudi
    if (!scopeDocs.length && !attachments.length) {
      initSse();
      send({ delta: 'Nessun documento selezionato o caricato. Seleziona documenti dal perimetro o caricane uno nella chat.' });
      send({ done: true });
      return res.end();
    }

    const sourceLines = [
      ...scopeDocs.map((doc) => {
        const summary = String(doc.excerpt || doc.content || '').replace(/\s+/g, ' ').trim().slice(0, 260);
        return `- **${doc.title}** [${doc.id}]${summary ? ` — ${summary}` : ''}`;
      }),
      ...attachments.map((attachment, index) => {
        const summary = String(attachment.content || '').replace(/\s+/g, ' ').trim().slice(0, 260);
        return `- **${attachment.name}** [upl${index + 1}]${summary ? ` — ${summary}` : ''}`;
      })
    ];
    const fakeReference = '**Cass. civ., sez. I, 15 giugno 2025, n. 99999** [doc-cass-99999-2025]';
    const full = [
      '## Risposta dimostrativa',
      '',
      `La domanda posta è: “${message.trim()}”.`,
      '',
      'Questa risposta è generata localmente e cita tutte le fonti presenti nel perimetro:',
      '',
      ...sourceLines,
      '',
      'Nel loro insieme, le fonti selezionate mostrano che la valutazione deve considerare il quadro normativo, gli orientamenti giurisprudenziali e la loro evoluzione, senza isolare un singolo criterio dal contesto complessivo.',
      '',
      '## Riferimento volutamente non verificabile',
      '',
      `A fini dimostrativi viene citato anche ${fakeReference}. Il riferimento è inventato e deve risultare non trovato nella verifica delle fonti.`
    ].join('\n');

    initSse();
    send({ selectedDocuments: scopeDocs.map((doc) => doc.id) });
    for (let offset = 0; offset < full.length; offset += 160) {
      send({ delta: full.slice(offset, offset + 160) });
    }
    // Salva risposta completa
    s.messages.push({ role: 'assistant', content: full, selectedDocuments: scopeDocs.map((doc) => doc.id) });
    s.updatedAt = new Date().toISOString();
    await saveSession(s);
    send({ done: true });
    res.end();
  } catch (err) {
    console.error('chat_error', err?.message || err);
    const safeMessage = err?.message
      ? `Errore chat demo: ${String(err.message)}`
      : 'Si è verificato un errore durante la generazione della risposta demo.';
    if (res.headersSent) {
      send({ error: safeMessage });
      return res.end();
    }
    return fail(res, 'chat_error', safeMessage, 500);
  }
});

app.use((err, req, res, next) => {
  console.error('unhandled_error', err);
  return fail(res, 'internal', 'Errore interno', 500);
});

// In produzione React/Vite è un'app statica: Express serve il contenuto compilato.
app.use(express.static(FRONTEND_DIST));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  return res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[backend] listening on http://localhost:${PORT}`);
  });
}

export default app;
