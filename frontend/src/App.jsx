import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getSourceVerification } from './sourceVerification'

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function markdownToHtml(markdown) {
  if (!markdown) return ''
  let text = escapeHtml(markdown)

  // Code blocks
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre><code>${code.trim()}</code></pre>`
  })

  // Headings
  text = text.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  text = text.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  text = text.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')

  // Bold / italic
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Lists
  text = text.replace(/(?:^|\n)-\s+(.+)(?=(?:\n-\s+)|\n\n|$)/g, '<li>$1</li>')
  text = text.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')

  // Paragraphs / line breaks
  const blocks = text
    .split(/\n\n+/)
    .map((block) => {
      if (/^<(h1|h2|h3|pre|ul)>/.test(block.trim())) return block
      return `<p>${block.replace(/\n/g, '<br/>')}</p>`
    })
    .join('')

  return blocks
}

function renderAssistantWithReferences(content, docsById) {
  const refs = []
  const byId = new Map()
  let seq = 0

  // Supporta anche eventuali tag <sup class="cite-dot" ...> già presenti nel testo
  const incoming = String(content || '').replace(
    /<sup\s+class=["']cite-dot["']\s+title=["']([^"']*)["']\s*>(\d+)<\/sup>/gi,
    (_, title, num) => {
      const existingNumber = Number(num)
      if (Number.isFinite(existingNumber) && existingNumber > seq) seq = existingNumber
      const id = `legacy-${existingNumber}-${title}`
      if (!byId.has(id)) {
        const ref = { number: existingNumber || ++seq, id, title: title || 'Riferimento' }
        byId.set(id, ref)
        refs.push(ref)
      }
      return `@@CITE_${existingNumber}@@`
    }
  )

  const withBadges = incoming.replace(/\[([A-Za-z0-9._:-]+)\](?!\()/g, (full, id) => {
    const doc = docsById?.[id]
    if (!doc) return full

    let ref = byId.get(id)
    if (!ref) {
      seq += 1
      ref = { number: seq, id, title: doc.title || id }
      byId.set(id, ref)
      refs.push(ref)
    }
    return `@@CITE_${ref.number}@@`
  })

  const refByNumber = new Map(refs.map((r) => [r.number, r]))
  const htmlWithMarkers = markdownToHtml(withBadges)
  const html = htmlWithMarkers.replace(/@@CITE_(\d+)@@/g, (_, n) => {
    const ref = refByNumber.get(Number(n))
    if (!ref) return ''
    return `<sup class="cite-dot" title="${escapeHtml(ref.title)}">${ref.number}</sup>`
  })

  return {
    html,
    refs
  }
}

async function api(input, init) {
  const res = await fetch(input, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!res.ok) throw new Error(`${res.status}`)
  const data = await res.json()
  if (!data?.ok) throw new Error(data?.error?.message || 'Errore API')
  return data.data
}

export default function App() {
  const [docs, setDocs] = useState([])
  const [tabCounts, setTabCounts] = useState({
    'Leggi Nazionali': 0,
    'Leggi Regionali': 30,
    Prassi: 7
  })
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [searchText, setSearchText] = useState('assegno divorzile')
  const [activeTab, setActiveTab] = useState('Leggi Nazionali')

  const [selected, setSelected] = useState(new Map())

  const [sessionId, setSessionId] = useState(null)
  const sessionIdRef = useRef(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState([
    { role: 'system', content: 'Nuova conversazione. Il modello risponderà in base ai documenti selezionati.' }
  ])
  const [streaming, setStreaming] = useState(false)
  const [streamAssistant, setStreamAssistant] = useState('')
  const chatBodyRef = useRef(null)

  const [scopeOpen, setScopeOpen] = useState(false)
  const [scopeDragActive, setScopeDragActive] = useState(false)
  const [scopeSaveModalOpen, setScopeSaveModalOpen] = useState(false)
  const [scopeSaveName, setScopeSaveName] = useState('')
  const [scopeDeleteTarget, setScopeDeleteTarget] = useState(null)
  const [scopeArchiveOpen, setScopeArchiveOpen] = useState(false)
  const [scopes, setScopes] = useState([])
  const [scopesLoading, setScopesLoading] = useState(false)
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const resultListRef = useRef(null)

  // Avviso demo: modale con overlay, visibile ad ogni refresh; chiudibile
  const [showDemoModal, setShowDemoModal] = useState(true)
  const [showSapientAlert, setShowSapientAlert] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoadingDocs(true)
    api('/api/documents')
      .then((res) => {
        if (!mounted) return
        setDocs(res.items || [])
        if (res.tabCounts) {
          setTabCounts({
            'Leggi Nazionali': res.tabCounts['Leggi Nazionali'] || 0,
            'Leggi Regionali': res.tabCounts['Leggi Regionali'] > 0 ? res.tabCounts['Leggi Regionali'] : 30,
            Prassi: res.tabCounts.Prassi > 0 ? res.tabCounts.Prassi : 7
          })
        }
      })
      .catch(() => mounted && setDocs([]))
      .finally(() => mounted && setLoadingDocs(false))
    return () => {
      mounted = false
    }
  }, [])

  async function ensureSession() {
    if (sessionIdRef.current) return sessionIdRef.current
    const out = await api('/api/sessions', { method: 'POST' })
    sessionIdRef.current = out.sessionId
    setSessionId(out.sessionId)
    return out.sessionId
  }

  async function startNewChat() {
    setMessages([
      { role: 'system', content: 'Nuova conversazione. Il modello risponderà in base ai documenti selezionati.' }
    ])
    setStreamAssistant('')
    setStreaming(false)
    sessionIdRef.current = null
    setSessionId(null)

    const sid = await ensureSession()
    await syncScope(new Map(selected), sid)
  }

  async function saveCurrentProject() {
    const sid = await ensureSession()
    const out = await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ sessionId: sid })
    })
    pushMessage('system', `Progetto salvato: ${out.name}`)
    await loadProjects()
  }

  async function saveCurrentScope(name) {
    const sid = await ensureSession()
    await syncScope(new Map(selected), sid)
    const out = await api('/api/scopes', {
      method: 'POST',
      body: JSON.stringify({ sessionId: sid, name: name && name.trim() ? name.trim() : undefined })
    })
    const savedAt = out?.savedAt ? new Date(out.savedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''
    pushMessage('system', `Perimetro salvato: ${out.name}${savedAt ? ` (ore ${savedAt})` : ''}`)
    await loadScopes()
  }

  function openSaveScopeModal() {
    setScopeSaveName('')
    setScopeSaveModalOpen(true)
  }

  async function confirmSaveScope() {
    const name = scopeSaveName.trim()
    if (!name) return
    await saveCurrentScope(name)
    setScopeSaveModalOpen(false)
  }

  async function loadScopes() {
    setScopesLoading(true)
    try {
      const out = await api('/api/scopes')
      setScopes(out.items || [])
    } finally {
      setScopesLoading(false)
    }
  }

  async function deleteScope(scopeId) {
    await api(`/api/scopes/${scopeId}`, { method: 'DELETE' })
    setScopes((prev) => prev.filter((x) => x.scopeId !== scopeId))
    pushMessage('system', 'Perimetro cancellato.')
    await loadScopes()
  }

  function requestDeleteScope(scope) {
    setScopeDeleteTarget(scope)
  }

  async function confirmDeleteScope() {
    if (!scopeDeleteTarget?.scopeId) return
    await deleteScope(scopeDeleteTarget.scopeId)
    setScopeDeleteTarget(null)
  }

  async function openScope(scopeId, options = {}) {
    const { newChat = false } = options
    const scope = await api(`/api/scopes/${scopeId}`)
    const arr = Array.isArray(scope.selectedDocuments) ? scope.selectedDocuments : []
    const next = new Map()
    arr.forEach((x) => {
      const id = x?.id || x
      if (!id) return
      const d = docs.find((doc) => doc.id === id)
      next.set(id, { id, title: d?.title || x?.title || id })
    })
    setSelected(next)

    if (newChat) {
      setMessages([
        { role: 'system', content: 'Nuova conversazione. Il modello risponderà in base ai documenti selezionati.' }
      ])
      setStreamAssistant('')
      setStreaming(false)
      sessionIdRef.current = null
      setSessionId(null)
    }

    const sid = await ensureSession()
    await syncScope(next, sid)
    setScopeArchiveOpen(false)
    if (newChat) {
      pushMessage('system', `Nuova chat avviata con perimetro: ${next.size} documenti.`)
    } else {
      pushMessage('system', `Perimetro applicato: ${next.size} documenti.`)
    }
  }

  async function loadProjects() {
    setProjectsLoading(true)
    try {
      const out = await api('/api/projects')
      setProjects(out.items || [])
    } finally {
      setProjectsLoading(false)
    }
  }

  async function openProject(projectId) {
    const project = await api(`/api/projects/${projectId}`)
    setChatOpen(true)
    setProjectsOpen(false)

    const ids = Array.isArray(project.selectedDocuments) ? project.selectedDocuments : []
    setSelected(() => {
      const next = new Map()
      ids.forEach((id) => {
        const d = docs.find((x) => x.id === id)
        next.set(id, { id, title: d?.title || id })
      })
      return next
    })

    const restored = (project.messages || []).filter((m) => ['user', 'assistant', 'system'].includes(m.role))
    setMessages(restored.length ? restored : [{ role: 'system', content: 'Progetto aperto, nessun messaggio disponibile.' }])

    // Crea una sessione fresca e riallinea contesto lato backend
    sessionIdRef.current = null
    setSessionId(null)
    const sid = await ensureSession()
    await api(`/api/sessions/${sid}/scope`, {
      method: 'PATCH',
      body: JSON.stringify({ selectedDocuments: ids })
    })

    // Re-idrata parte storico sul backend per continuità della conversazione
    for (const m of restored.slice(-20)) {
      if (m.role === 'system') continue
      try {
        await api(`/api/sessions/${sid}/messages`, {
          method: 'POST',
          body: JSON.stringify({ role: m.role, content: m.content, selectedDocuments: m.selectedDocuments })
        })
      } catch {
        // continua anche se un messaggio fallisce
      }
    }
  }

  async function syncScope(next, fixedSessionId) {
    const sid = fixedSessionId || await ensureSession()
    const ids = Array.from(next.keys())
    await api(`/api/sessions/${sid}/scope`, {
      method: 'PATCH',
      body: JSON.stringify({ selectedDocuments: ids })
    })
  }

  function updateSelection(id, title, checked) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (checked) next.set(id, { id, title })
      else next.delete(id)
      syncScope(next).catch(() => {})
      return next
    })
  }

  const filteredDocs = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (!q) return docs

    const normalize = (v) => String(v || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '')

    const nq = normalize(q)

    const matched = docs.filter((d) => {
      const raw = `${d.title} ${d.meta} ${d.excerpt} ${d.content || ''}`.toLowerCase()
      if (raw.includes(q)) return true
      const nraw = normalize(raw)
      return nraw.includes(nq)
    })
    // Demo UX: evita lista vuota, mostra comunque i documenti disponibili
    return matched.length > 0 ? matched : docs
  }, [docs, searchText])

  function classifyDocTab(doc) {
    return doc?.tab || 'Leggi Nazionali'
  }

  const visibleDocs = useMemo(() => {
    const byTab = filteredDocs.filter((d) => classifyDocTab(d) === activeTab)
    // Fallback: evita schermata vuota quando i documenti non hanno una tab coerente
    return byTab.length > 0 ? byTab : filteredDocs
  }, [filteredDocs, activeTab])

  function selectAll() {
    const next = new Map(selected)
    visibleDocs.forEach((d) => next.set(d.id, { id: d.id, title: d.title }))
    setSelected(next)
    syncScope(next).catch(() => {})
  }

  function clearAll() {
    setSelected(new Map())
    syncScope(new Map()).catch(() => {})
  }

  function shuffleResults() {
    const ul = resultListRef.current
    if (!ul) return
    const nodes = Array.from(ul.children)
    nodes.forEach((n) => (n.style.display = ''))
    for (let i = nodes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const a = nodes[i]
      const b = nodes[j]
      if (a && b && a !== b) ul.insertBefore(a, b)
    }
  }

  function runSearch() {
    const wordCount = searchText.trim().split(/\s+/u).filter(Boolean).length
    if (wordCount > 8) {
      setShowSapientAlert(true)
      return
    }

    if (!searchText.toLowerCase().includes('divorz')) shuffleResults()
  }

  function pushMessage(role, content, selectedDocuments) {
    setMessages((m) => [...m, { role, content, ...(selectedDocuments ? { selectedDocuments } : {}) }])
    queueMicrotask(() => {
      const el = chatBodyRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }

  async function sendChat(text) {
    const question = String(text || '').trim()
    if (!question || streaming) return

    const sid = await ensureSession()
    await syncScope(new Map(selected), sid)

    setStreaming(true)
    setStreamAssistant('')
    pushMessage('user', question)
    let acc = ''
    let responseDocuments

    try {
      const res = await fetch(`/api/sessions/${sid}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question })
      })

      if (!res.ok) {
        let msg = `Errore chiamata chat (${res.status})`
        try {
          const errData = await res.json()
          if (errData?.error?.message) msg = errData.error.message
        } catch {
          if (res.statusText) msg = `${msg}: ${res.statusText}`
        }
        throw new Error(msg)
      }

      if (!res.body) {
        throw new Error('Nessun contenuto ricevuto dal server')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let done = false
      let buffer = ''
      while (!done) {
        const chunk = await reader.read()
        done = chunk.done
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !done })
        let idxNL
        while ((idxNL = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idxNL).trim()
          buffer = buffer.slice(idxNL + 2)
          if (!raw.startsWith('data:')) continue
          try {
            const json = JSON.parse(raw.slice(5).trim())
            if (json.delta) {
              acc += json.delta
              setStreamAssistant(acc)
            }
            if (Array.isArray(json.selectedDocuments)) responseDocuments = json.selectedDocuments
            if (json.error) {
              acc = json.error
              setStreamAssistant(acc)
            }
          } catch {
            // ignore malformed event chunks
          }
        }
      }
    } catch (err) {
      acc = err?.message || 'Si è verificato un errore durante la richiesta a OpenAI.'
      setStreamAssistant(acc)
    } finally {
      if (acc) pushMessage('assistant', acc, responseDocuments)
      setStreamAssistant('')
      setStreaming(false)
    }
  }

  async function uploadDocumentToChat(file) {
    const sid = await ensureSession()
    await syncScope(new Map(selected), sid)
    const content = await file.text()
    const clean = String(content || '').trim()
    if (!clean) {
      pushMessage('system', `Il file "${file.name}" è vuoto.`)
      return
    }
    await api(`/api/sessions/${sid}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ name: file.name, content: clean })
    })
    pushMessage('system', `Documento caricato in chat: ${file.name}`)
  }

  function onScopeDragOver(e) {
    e.preventDefault()
    setScopeDragActive(true)
  }

  function onScopeDragLeave(e) {
    e.preventDefault()
    setScopeDragActive(false)
  }

  async function onScopeDrop(e) {
    e.preventDefault()
    setScopeDragActive(false)
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    try {
      await uploadDocumentToChat(file)
    } catch {
      // no-op
    }
  }

  const selCount = selected.size
  const docsById = useMemo(() => Object.fromEntries(docs.map((d) => [d.id, d])), [docs])

  return (
    <div>
      <div className="topbar">
        <div className="topbar-content">
          <span className="top-link">LEFEBVRE GIUFFRÈ</span>
          <span className="sep">|</span>
          <span className="top-link">LA NOSTRA OFFERTA</span>
          <span className="sep">|</span>
          <span className="top-link">NETWORK</span>
          <div className="top-right">GFL EDITORE</div>
        </div>
      </div>

      <header className="brandbar">
        <div className="brand-left">
          <img className="dejure-logo" src="/dejure-logo.png" alt="DeJure" />
    
        </div>
        <div className="brand-right">
          <h1 className="page-title">Risultati della ricerca</h1>
        </div>
      </header>

      {showDemoModal && (
        <div
          className="demo-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="demoTitle"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDemoModal(false) }}
        >
          <div className="demo-modal" role="document">
            <div className="demo-head">
              <span className="demo-pill">DEMO</span>
              <button className="demo-close" title="Chiudi" onClick={() => setShowDemoModal(false)}>×</button>
            </div>
            <div className="demo-body">
              <div id="demoTitle" className="demo-title">Questa è una demo con dati fissi</div>
              <div className="demo-text">
                L’interfaccia mostra un flusso di presentazione con contenuti statici per simulare l’esperienza.
                Seleziona uno o più documenti nei risultati e poi clicca su "Apri Chat AI" per avviare la conversazione.
              </div>
            </div>
            <div className="demo-actions">
              <button className="demo-ok" type="button" onClick={() => setShowDemoModal(false)}>Ho capito</button>
            </div>
          </div>
        </div>
      )}

      {showSapientAlert && (
        <div
          className="sapient-alert-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="sapientAlertTitle"
          aria-describedby="sapientAlertText"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSapientAlert(false) }}
        >
          <div className="sapient-alert" role="document">
            <button
              className="sapient-alert-close"
              type="button"
              aria-label="Chiudi avviso"
              onClick={() => setShowSapientAlert(false)}
            >
              ×
            </button>
            <div id="sapientAlertTitle" className="sapient-alert-title">Questa domanda è molto articolata</div>
            <p id="sapientAlertText" className="sapient-alert-text">
              Dovresti usare il tool <strong>Sapient-IA</strong> - L’Intelligenza Artificiale specialistica
              costruita sul patrimonio editoriale Lefebvre Giuffrè, dove il sapere è a supporto della tua competenza.
            </p>
            <div className="sapient-alert-actions">
              <button type="button" className="sapient-alert-cancel" onClick={() => setShowSapientAlert(false)}>
                Chiudi
              </button>
              <a
                className="sapient-alert-link"
                href="https://digital.giuffrefrancislefebvre.it/sapient-ia/"
                target="_blank"
                rel="noreferrer"
              >
                Vai a Sapient-IA
              </a>
            </div>
          </div>
        </div>
      )}

      <section className="searchband">
        <div className="search-wrap">
          <div className="search-box">
            <div className="sb-seg sb-select">Normativa <span className="chev">▾</span></div>
            <input
              id="search"
              className="sb-seg sb-input"
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  runSearch()
                }
              }}
              placeholder="Es. assegno divorzile"
            />
            <button type="button" className="sb-seg sb-icon" title="Cerca" onClick={runSearch}>🔍</button>
          </div>
          <button className="adv-btn" title="Ricerca avanzata">≡ Ricerca avanzata</button>
        </div>
        <div className="synonyms"><span className="symb">ⓘ</span> Sinonimi suggeriti</div>
      </section>

      <section className="counts-bar">
        <button className="cnav left" aria-label="Precedente" disabled>‹</button>
        <div className="counts-scroller">
          {['Leggi Nazionali', 'Leggi Regionali', 'Prassi'].map((tab) => {
            const isActive = activeTab === tab
            return (
              <button
                key={tab}
                type="button"
                className={`count-card ${isActive ? 'orange' : 'blue'}`}
                onClick={() => setActiveTab(tab)}
                aria-pressed={isActive}
              >
                <div className="num">{tabCounts[tab]}</div>
                <div className="lbl">{tab}</div>
              </button>
            )
          })}
        </div>
        <button className="cnav right" aria-label="Successivo" disabled>›</button>
      </section>

      <section className="filters">
        <div className="filters-row">
          <div className="filters-col-main">
            <div className="legend-row">
              <span className="legend-title">⚲ FILTRA</span>
              <span className="legend-line" />
            </div>
            <div className="filters-box">
              <span className="f-item">Argomento: <span className="chev-down">⌄</span></span>
              <span className="f-item">Tipo: <span className="chev-down">⌄</span></span>
              <span className="f-item">Data: <span className="chev-down">⌄</span></span>
            </div>
          </div>

          <div className="filters-col-side">
            <div className="legend-row">
              <span className="legend-title">⇵ ORDINA PER</span>
              <span className="legend-line" />
            </div>
            <div className="sort-box">
              <span className="sort-opt active">🗓 Data</span>
              <span className="sort-opt">⚖ Rilevanza</span>
            </div>
          </div>
        </div>
      </section>

      <main className="layout">
        <section className="results" aria-label="Risultati di ricerca">
          <ul className="result-list" ref={resultListRef}>
            {loadingDocs && <li className="result-item"><label>Caricamento…</label></li>}
            {!loadingDocs && visibleDocs.map((d) => (
              <li className="result-item" key={d.id}>
                <label>
                  <input
                    type="checkbox"
                    className="doc-checkbox"
                    checked={selected.has(d.id)}
                    onChange={(e) => updateSelection(d.id, d.title, e.currentTarget.checked)}
                  />
                  <div className="doc">
                    <div className="doc-title">{d.title}</div>
                    <div className="doc-meta">{d.meta} <span className="badge green">NUOVO</span></div>
                    <div className="doc-excerpt">{d.excerpt}</div>
                  </div>
                </label>
              </li>
            ))}
            {!loadingDocs && visibleDocs.length === 0 && (
              <li className="result-item"><label>Nessun risultato per la ricerca corrente.</label></li>
            )}
          </ul>
        </section>
        <section className="empty-state">
          <div className="empty-card">
            <div className="empty-title">Seleziona N documenti</div>
            <p>Spunta uno o più risultati e usa la barra arancione in basso per aprire la Chat AI sul perimetro selezionato.</p>
          </div>
        </section>
      </main>

      <aside className={`chat-drawer ${chatOpen ? 'open' : ''}`} aria-hidden={!chatOpen}>
        <div className="chat-header">
          <div className="chat-title">Chat AI</div>
          <button className="icon-btn" title="Chiudi" onClick={() => setChatOpen(false)}>×</button>
        </div>
        <div className="chat-body" ref={chatBodyRef}>
          {messages.map((m, i) => {
            if (m.role === 'system') {
              return <div key={i} className="system-hint">{m.content}</div>
            }
            if (!m.content || !String(m.content).trim()) {
              return null
            }
            return (
              <div key={i} className={`msg ${m.role}`}>
                <div className={`msg-avatar ${m.role}`}>{m.role === 'assistant' ? 'AI' : 'U'}</div>
                <MessageBubble role={m.role} content={m.content} docsById={docsById} selectedDocuments={m.selectedDocuments} />
              </div>
            )
          })}
          {streaming && (
            <div className="msg assistant">
              <div className="msg-avatar assistant">AI</div>
              <MessageBubble role="assistant" content={streamAssistant || 'Sta scrivendo…'} isTyping docsById={docsById} />
            </div>
          )}
        </div>
        <div className="prompt-suggestions">
          {(searchText.toLowerCase().includes('divorz') || Array.from(selected.keys()).some((id) => id.startsWith('divorzio-')) ? [
            {
              label: 'Evoluzione assegno divorzile',
              text: "L'assegno divorzile spetta soltanto quando l'ex coniuge non è economicamente autosufficiente? Ricostruisci l'evoluzione della giurisprudenza sulla base delle fonti selezionate."
            },
            {
              label: 'Criteri per l’assegno',
              text: "Quali sono i criteri per riconoscere l'assegno divorzile secondo le fonti selezionate?"
            }
          ] : [
            {
              label: 'Obblighi datore',
              text: "Quali obblighi deve rispettare il datore di lavoro nell'organizzazione dello smart working, con particolare riferimento agli strumenti informatici e al diritto alla disconnessione?"
            },
            {
              label: 'Orario e reperibilita',
              text: "Quali regole disciplinano la distribuzione dell'orario e la reperibilità del lavoratore durante lo smart working?"
            },
            {
              label: 'Diritto disconnessione',
              text: 'Il lavoratore può rifiutarsi di rispondere alle comunicazioni aziendali durante i periodi di disconnessione senza subire conseguenze?'
            }
          ]).map((p) => (
            <button key={p.label} className="chip" onClick={() => { setChatOpen(true); sendChat(p.text) }}>{p.label}</button>
          ))}
        </div>
        <ChatInput
          onSend={(t) => { setChatOpen(true); sendChat(t) }}
          onUploadDocument={uploadDocumentToChat}
          onOpenScope={() => setScopeOpen(true)}
          onSaveScope={openSaveScopeModal}
          onOpenScopeArchive={async () => {
            await loadScopes()
            setScopeArchiveOpen(true)
          }}
          onNewChat={startNewChat}
          streaming={streaming}
        />

        {scopeOpen && (
          <div className="scope-panel chat-bottom-panel">
            <div className="scope-header">
              <div>Documenti nel perimetro</div>
              <button className="icon-btn" title="Chiudi" onClick={() => setScopeOpen(false)}>×</button>
            </div>
            <div
              className={`scope-dropzone ${scopeDragActive ? 'active' : ''}`}
              onDragOver={onScopeDragOver}
              onDragLeave={onScopeDragLeave}
              onDrop={onScopeDrop}
            >
              <div className="scope-drop-icon">📂</div>
              <div className="scope-drop-title">Trascina qui un file dal PC</div>
              <div className="scope-drop-sub">Il documento viene aggiunto al contesto della chat.</div>
            </div>
            <ul className="scope-list">
              {selCount === 0 && <li style={{ color: '#9fb0c3' }}>Nessun documento selezionato.</li>}
              {Array.from(selected.values()).map(({ id, title }) => (
                <li key={id} className="scope-item">
                  <span>{title}</span>
                  <button className="scope-remove" title="Rimuovi dal perimetro" onClick={() => updateSelection(id, title, false)}>🗑️</button>
                </li>
              ))}
            </ul>
            <div className="scope-actions">
              <button className="btn" onClick={() => setScopeOpen(false)}>Applica modifiche</button>
            </div>
          </div>
        )}

        {projectsOpen && (
          <div className="projects-panel">
            <div className="projects-header">
              <div>Archivio progetti</div>
              <button className="icon-btn" title="Chiudi" onClick={() => setProjectsOpen(false)}>×</button>
            </div>
            <div className="projects-body">
              {projectsLoading && <div className="system-hint">Caricamento progetti...</div>}
              {!projectsLoading && projects.length === 0 && (
                <div className="system-hint">Nessun progetto salvato.</div>
              )}
              {!projectsLoading && projects.map((p) => (
                <button key={p.projectId} className="project-item" onClick={() => openProject(p.projectId)}>
                  <div className="project-name">{p.name}</div>
                  <div className="project-meta">{new Date(p.updatedAt || p.createdAt).toLocaleString('it-IT')} · {p.messagesCount || 0} messaggi</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {scopeArchiveOpen && (
          <div className="projects-panel chat-bottom-panel">
            <div className="projects-header">
              <div>Archivio perimetri</div>
              <button className="icon-btn" title="Chiudi" onClick={() => setScopeArchiveOpen(false)}>×</button>
            </div>
            <div className="projects-body">
              {scopesLoading && <div className="system-hint">Caricamento perimetri...</div>}
              {!scopesLoading && scopes.length === 0 && (
                <div className="system-hint">Nessun perimetro salvato.</div>
              )}
              {!scopesLoading && scopes.map((p) => (
                <div key={p.scopeId} className="project-item-row">
                  <button className="project-item project-item-main" onClick={() => openScope(p.scopeId)}>
                    <div className="project-name">{p.name}</div>
                    <div className="project-meta">
                      {new Date(p.updatedAt || p.createdAt).toLocaleDateString('it-IT')} · ore {new Date(p.updatedAt || p.createdAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} · {p.documentsCount || 0} documenti
                    </div>
                  </button>
                  <button
                    className="project-chat-btn"
                    title="Nuova chat con questo perimetro"
                    onClick={() => openScope(p.scopeId, { newChat: true })}
                  >
                    <svg className="project-chat-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 20h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L8 18l-4 1 1-4 11.5-11.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <button
                    className="project-delete-btn"
                    title="Cancella perimetro"
                    onClick={(e) => {
                      e.stopPropagation()
                      requestDeleteScope(p)
                    }}
                  >
                    <svg className="project-chat-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 6h18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      <path d="M8 6V4h8v2M7 6l1 14h8l1-14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {scopeSaveModalOpen && (
          <div className="scope-save-overlay" onClick={() => setScopeSaveModalOpen(false)}>
            <div className="scope-save-modal" onClick={(e) => e.stopPropagation()}>
              <div className="scope-save-head">Salva perimetro</div>
              <div className="scope-save-text">Inserisci il nome del perimetro da salvare.</div>
              <input
                className="scope-save-input"
                type="text"
                value={scopeSaveName}
                onChange={(e) => setScopeSaveName(e.currentTarget.value)}
                placeholder="Es. Perimetro smartworking"
                autoFocus
              />
              <div className="scope-save-actions">
                <button className="btn" type="button" onClick={() => setScopeSaveModalOpen(false)}>Annulla</button>
                <button className="btn primary" type="button" disabled={!scopeSaveName.trim()} onClick={confirmSaveScope}>Salva</button>
              </div>
            </div>
          </div>
        )}

        {scopeDeleteTarget && (
          <div className="scope-save-overlay" onClick={() => setScopeDeleteTarget(null)}>
            <div className="scope-save-modal" onClick={(e) => e.stopPropagation()}>
              <div className="scope-save-head">Conferma cancellazione</div>
              <div className="scope-save-text">
                Sei sicuro di voler cancellare il perimetro <strong>{scopeDeleteTarget.name}</strong>? Questa azione non può essere annullata.
              </div>
              <div className="scope-save-actions">
                <button className="btn" type="button" onClick={() => setScopeDeleteTarget(null)}>Annulla</button>
                <button className="btn" type="button" onClick={confirmDeleteScope} style={{ borderColor: '#efb9b9', color: '#a33' }}>Cancella</button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {selCount > 0 && (
        <div className="selection-bar">
          <div className="sel-left"><strong>{selCount}</strong> documenti selezionati</div>
          <div className="sel-actions">
            <button className="bar-btn" onClick={selectAll}>Seleziona tutti</button>
            <button className="bar-btn link" onClick={clearAll}>Cancella selezioni</button>
            <button className="bar-btn primary" onClick={() => setChatOpen(true)}>Apri Chat AI</button>
          </div>
        </div>
      )}

      <div className="util-bar" role="region" aria-label="Azioni rapide">
        <div className="util-wrap">
          <button className="util-btn" title="Stampa">🖨️ Stampa</button>
          <button className="util-btn" title="Scarica">⬇️ Scarica</button>
          <button className="util-btn" title="Monitora">👁️ Monitora</button>
          <button className="util-btn" title="Invia">✉️ Invia</button>
          <div className="util-spacer"></div>
          <div className="util-help">
            <button className="util-btn primary" title="Aiuto alla ricerca">✨ Aiuto alla ricerca</button>
          </div>
        </div>
      </div>

      <footer className="app-footer">
        <small>Demo con backend reale. Le risposte sono generate da OpenAI sul perimetro selezionato.</small>
      </footer>
    </div>
  )
}

function ChatInput({ onSend, onUploadDocument, onOpenScope, onSaveScope, onOpenScopeArchive, onNewChat, streaming }) {
  const [text, setText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const fileRef = useRef(null)
  const recognitionRef = useRef(null)

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await onUploadDocument(file)
    } catch {
      // silenzioso: errore gestito lato app con system message eventuale
    } finally {
      e.target.value = ''
    }
  }

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop()
      return
    }

    const rec = new SR()
    recognitionRef.current = rec
    rec.lang = 'it-IT'
    rec.interimResults = true
    rec.continuous = false

    rec.onstart = () => setListening(true)
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    rec.onresult = (event) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript
      }
      setText((prev) => `${prev} ${transcript}`.trim())
    }
    rec.start()
  }

  return (
    <form
      className="chat-input"
      onSubmit={(e) => {
        e.preventDefault()
        const t = text.trim()
        if (!t) return
        onSend(t)
        setText('')
      }}
    >
      <div className="chat-input-menu-wrap">
        <button
          type="button"
          className="chat-tool-btn"
          title="Opzioni"
          disabled={streaming}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="chat-plus-icon">+</span>
        </button>
        {menuOpen && (
          <div className="chat-menu-dropdown chat-menu-dropdown-up">
            <button className="chat-menu-item" type="button" onClick={() => { onOpenScope(); setMenuOpen(false) }}>
              <svg className="chat-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12h16M4 6h10M4 18h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Modifica perimetro
            </button>
            <button className="chat-menu-item" type="button" onClick={async () => { await onSaveScope(); setMenuOpen(false) }}>
              <svg className="chat-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 4h11l3 3v13H5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                <path d="M8 4v6h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Salva perimetro
            </button>
            <button className="chat-menu-item" type="button" onClick={async () => { await onOpenScopeArchive(); setMenuOpen(false) }}>
              <svg className="chat-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="6" width="16" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M9 10h6M9 14h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Archivio perimetri
            </button>
            <button className="chat-menu-item" type="button" onClick={async () => { await onNewChat(); setMenuOpen(false) }}>
              <svg className="chat-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Nuova chat
            </button>
            <button className="chat-menu-item" type="button" onClick={() => { fileRef.current?.click(); setMenuOpen(false) }}>
              <svg className="chat-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21.44 11.05l-8.49 8.49a6 6 0 11-8.49-8.49l8.49-8.49a4 4 0 015.66 5.66l-8.5 8.49a2 2 0 11-2.82-2.83l7.78-7.78" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Carica documento
            </button>
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.json,.csv"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        type="text"
        placeholder="Interroga il perimetro selezionato"
        autoComplete="off"
      />
      <button
        type="button"
        className={`chat-tool-btn ${listening ? 'active' : ''}`}
        title="Microfono"
        disabled={streaming}
        onClick={toggleMic}
      >
        <svg className="chat-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15a3 3 0 003-3V7a3 3 0 10-6 0v5a3 3 0 003 3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M19 11a7 7 0 01-14 0M12 18v3M8.5 21h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <button className="btn primary" type="submit">Invia</button>
    </form>
  )
}

function MessageBubble({ role, content, isTyping = false, docsById = {}, selectedDocuments = [] }) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [verificationOpen, setVerificationOpen] = useState(false)

  if (!isTyping && (!content || !String(content).trim())) {
    return null
  }

  if (role === 'assistant' || isTyping) {
    const rendered = isTyping
      ? { html: markdownToHtml(content), refs: [] }
      : renderAssistantWithReferences(content, docsById)
    const verification = isTyping ? [] : getSourceVerification(content, docsById, selectedDocuments)

    return (
      <>
        <div className={`bubble ${isTyping ? 'typing' : ''}`} dangerouslySetInnerHTML={{ __html: rendered.html }} />
        {!isTyping && (
          <>
            <div className="msg-actions">
              <button type="button" className="msg-action-btn" title="Copia risposta">⧉</button>
              <button type="button" className="msg-action-btn" title="Utile">👍</button>
              <button type="button" className="msg-action-btn" title="Non utile">👎</button>
              {rendered.refs.length > 0 && <button
                type="button"
                className="sources-link"
                onClick={() => setSourcesOpen((v) => !v)}
              >
                <span className="sources-avatars" aria-hidden="true">
                  <span className="sources-avatar a1" />
                  <span className="sources-avatar a2" />
                  <span className="sources-avatar a3" />
                </span>
                <span>{rendered.refs.length} fonti</span>
              </button>}
              <button
                type="button"
                className="verify-sources-btn"
                aria-expanded={verificationOpen}
                onClick={() => setVerificationOpen((v) => !v)}
              >
                Verifica fonti
              </button>
            </div>
            {sourcesOpen && (
              <div className="msg-sources">
                <div className="msg-sources-head">
                  <span className="msg-sources-label">Fonti</span>
                  <button
                    type="button"
                    className="msg-sources-close"
                    onClick={() => setSourcesOpen(false)}
                    title="Chiudi fonti"
                  >
                    ×
                  </button>
                </div>
                {rendered.refs.map((r) => (
                  <div key={r.id} className="msg-source-item">
                    <span className="msg-source-num">{r.number}</span>
                    <span className="msg-source-title">{r.title}</span>
                  </div>
                ))}
              </div>
            )}
            {verificationOpen && (
              <section className="verification-panel" aria-label="Verifica fonti">
                <div className="verification-heading">
                  <div>
                    <div className="verification-title">Verifica fonti</div>
                    <div className="verification-subtitle">{verification.length} {verification.length === 1 ? 'fonte o riferimento' : 'fonti e riferimenti'}</div>
                  </div>
                  <button type="button" className="msg-sources-close" aria-label="Chiudi verifica fonti" onClick={() => setVerificationOpen(false)}>×</button>
                </div>
                <p className="verification-notice">Demo: esiti predefiniti, non una verifica su DeJure. Controlla sempre testo, vigenza e principio sulla fonte originale.</p>
                {verification.length > 0 ? (
                  <div className="verification-table-wrap">
                    <table className="verification-table">
                      <thead><tr><th scope="col">Fonte</th><th scope="col">Esito</th><th scope="col">Descrizione</th></tr></thead>
                      <tbody>
                        {verification.map((item) => (
                          <tr key={item.id}>
                            <th scope="row">{item.title}</th>
                            <td><span className={`verification-status ${item.status}`}><span className="verification-dot" aria-hidden="true" />{item.label}</span></td>
                            <td>{item.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="verification-empty">Nessuna fonte selezionata o riferimento documentale riconoscibile nella risposta.</p>
                )}
                {verification.length > 0 && <p className="verification-footnote">Sono riconosciuti gli identificativi tra parentesi quadre e alcune citazioni della legge 898/1970. Le fonti selezionate ma non riconosciute come citate sono indicate separatamente. La coerenza del testo non viene verificata automaticamente.</p>}
              </section>
            )}
          </>
        )}
      </>
    )
  }

  const html = escapeHtml(content).replace(/\n/g, '<br/>')
  return <div className="bubble" dangerouslySetInnerHTML={{ __html: html }} />
}
