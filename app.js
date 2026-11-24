// Prototipo front-end senza backend.
// Gestisce: selezione documenti, apertura chat, perimetro, simulazione risposta.

(function () {
  const resultList = document.getElementById('resultList');
  const selectionBar = document.getElementById('selectionBar');
  const selCount = document.getElementById('selCount');
  const openChatBtn = document.getElementById('openChatBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const emptyState = document.getElementById('emptyState');

  const chatDrawer = document.getElementById('chatDrawer');
  const closeChatBtn = document.getElementById('closeChatBtn');
  const chatBody = document.getElementById('chatBody');
  const chatForm = document.getElementById('chatForm');
  const chatMessage = document.getElementById('chatMessage');
  const promptSuggestions = document.getElementById('promptSuggestions');
  const scopeBtn = document.getElementById('scopeBtn');
  const scopeCount = document.getElementById('scopeCount');
  const scopePanel = document.getElementById('scopePanel');
  const scopeCloseBtn = document.getElementById('scopeCloseBtn');
  const scopeList = document.getElementById('scopeList');
  const scopeApplyBtn = document.getElementById('scopeApplyBtn');

  // Aiuto alla ricerca (modale)
  const searchHelpBtn = document.getElementById('searchHelpBtn');
  const shModal = document.getElementById('searchHelpModal');
  const shCloseBtn = document.getElementById('shCloseBtn');
  const shTextarea = document.getElementById('shTextarea');
  const shSuggestBtn = document.getElementById('shSuggestBtn');
  const shResult = document.getElementById('shResult');
  let shLastData = null; // ultimo JSON suggerimenti
  let shMode = 'suggest'; // 'suggest' | 'apply'

  // Utility bar & tooltip
  const utilHelpBtn = document.getElementById('utilHelpBtn');
  const utilHelpTip = document.getElementById('utilHelpTip');

  // Carousel counts
  const countsScroller = document.getElementById('countsScroller');
  const countsPrev = document.getElementById('countsPrev');
  const countsNext = document.getElementById('countsNext');

  // Stato selezione corrente
  const selected = new Map(); // id -> { id, title }

  function updateSelectionUI() {
    const n = selected.size;
    selCount.textContent = String(n);
    openChatBtn.disabled = n === 0;
    scopeCount.textContent = String(n);
    selectionBar.hidden = n === 0;
  }

  function getAllCheckboxes() {
    return Array.from(resultList.querySelectorAll('.doc-checkbox'));
  }

  function applySelectionFromMap() {
    const ids = new Set(Array.from(selected.keys()));
    getAllCheckboxes().forEach(cb => {
      cb.checked = ids.has(cb.dataset.id);
    });
    updateSelectionUI();
  }

  function onCheckboxChange(e) {
    const cb = e.target;
    const id = cb.dataset.id;
    const title = cb.dataset.title;
    if (cb.checked) {
      selected.set(id, { id, title });
    } else {
      selected.delete(id);
    }
    updateSelectionUI();
  }

  // Event wiring per le checkbox
  getAllCheckboxes().forEach(cb => cb.addEventListener('change', onCheckboxChange));

  // Selezione rapida
  selectAllBtn.addEventListener('click', () => {
    getAllCheckboxes().forEach(cb => {
      cb.checked = true;
      selected.set(cb.dataset.id, { id: cb.dataset.id, title: cb.dataset.title });
    });
    updateSelectionUI();
  });

  clearAllBtn.addEventListener('click', () => {
    selected.clear();
    getAllCheckboxes().forEach(cb => (cb.checked = false));
    updateSelectionUI();
  });

  // Apertura/chiusura chat
  openChatBtn.addEventListener('click', () => {
    chatDrawer.classList.add('open');
    chatDrawer.setAttribute('aria-hidden', 'false');
    emptyState.style.display = 'none';
    renderScopePanelList();
  });

  closeChatBtn.addEventListener('click', () => {
    chatDrawer.classList.remove('open');
    chatDrawer.setAttribute('aria-hidden', 'true');
  });

  // Pannello perimetro
  scopeBtn.addEventListener('click', () => {
    scopePanel.hidden = !scopePanel.hidden;
    if (!scopePanel.hidden) renderScopePanelList();
  });
  scopeCloseBtn.addEventListener('click', () => { scopePanel.hidden = true; });
  scopeApplyBtn.addEventListener('click', () => {
    // Sincronizza selezione UI -> stato già fatto durante rimozioni
    scopePanel.hidden = true;
    applySelectionFromMap();
    // Messaggio di sistema che segnala aggiornamento del perimetro
    pushSystem(`Perimetro aggiornato: ${selected.size} documenti.`);
  });

  function renderScopePanelList() {
    scopeList.innerHTML = '';
    if (selected.size === 0) {
      const li = document.createElement('li');
      li.textContent = 'Nessun documento selezionato.';
      li.style.color = '#9fb0c3';
      scopeList.appendChild(li);
      return;
    }
    for (const { id, title } of selected.values()) {
      const li = document.createElement('li');
      li.className = 'scope-item';
      const span = document.createElement('span');
      span.textContent = title;
      const btn = document.createElement('button');
      btn.className = 'scope-remove';
      btn.textContent = 'Rimuovi';
      btn.addEventListener('click', () => {
        selected.delete(id);
        renderScopePanelList();
        updateSelectionUI();
      });
      li.appendChild(span);
      li.appendChild(btn);
      scopeList.appendChild(li);
    }
  }

  // Chat helpers
  function pushMessage(role, text) {
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    chatBody.appendChild(wrap);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function pushSystem(text) {
    const div = document.createElement('div');
    div.className = 'system-hint';
    div.textContent = text;
    chatBody.appendChild(div);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function pushTyping() {
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const bubble = document.createElement('div');
    bubble.className = 'bubble typing';
    bubble.textContent = 'Sta scrivendo…';
    wrap.appendChild(bubble);
    chatBody.appendChild(wrap);
    chatBody.scrollTop = chatBody.scrollHeight;
    return () => wrap.remove();
  }

  function simulateAnswer(userText) {
    const docs = Array.from(selected.values());
    const titles = docs.map(d => `“${d.title}”`);
    const cite = titles.slice(0, 3).join('; ') + (titles.length > 3 ? '…' : '');

    const parts = [
      `Ho analizzato la tua richiesta in base al perimetro corrente (${docs.length} documenti).`,
      `Questo è un prototipo: la risposta è simulata. Nell'implementazione reale, l'AI estrarrebbe e citerebbe i passaggi rilevanti.`,
      `Documenti considerati: ${cite}`,
    ];

    // Finta latenza + sostituzione dell'indicatore di typing
    const removeTyping = pushTyping();
    setTimeout(() => {
      removeTyping();
      pushMessage('assistant', parts.join('\n\n'));
    }, Math.min(1600 + Math.random() * 1000, 2400));
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatMessage.value.trim();
    if (!text) return;
    pushMessage('user', text);
    chatMessage.value = '';
    simulateAnswer(text);
  });

  // Prompt rapidi
  promptSuggestions.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    const text = btn.dataset.text || btn.textContent.trim();
    pushMessage('user', text);
    simulateAnswer(text);
  });

  // Ricerca mock (client-side) - solo su click del bottone lente
  const search = document.getElementById('search');
  const searchBtn = document.querySelector('.sb-icon');
  function shuffleResultList() {
    const ul = resultList;
    if (!ul) return;
    const items = Array.from(ul.children);
    // Mostra sempre tutti
    items.forEach(li => (li.style.display = ''));
    // Shuffle semplice
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = items[i], b = items[j];
      if (a && b && a !== b) {
        ul.insertBefore(a, b);
      }
    }
    // Assicura che l'empty state sia nascosto
    if (emptyState) emptyState.style.display = 'none';
  }

  function performSearchFilter(query) {
    // Demo: mantieni sempre risultati visibili e rimescola
    shuffleResultList();
  }
  function runSearch() {
    const q = search ? search.value : '';
    performSearchFilter(q);
    if (q && q.trim().length > 0) showUtilTip();
  }
  if (searchBtn) searchBtn.addEventListener('click', runSearch);
  if (search) {
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runSearch();
      }
    });
  }

  // Inizializzazione
  updateSelectionUI();

  // Counts carousel handlers
  function updateCountsNav() {
    if (!countsScroller) return;
    const maxScroll = countsScroller.scrollWidth - countsScroller.clientWidth;
    const x = countsScroller.scrollLeft;
    if (countsPrev) countsPrev.disabled = x <= 2;
    if (countsNext) countsNext.disabled = x >= maxScroll - 2;
  }
  if (countsScroller) {
    countsScroller.addEventListener('scroll', () => {
      // Throttle semplice via requestAnimationFrame
      if (updateCountsNav.raf) cancelAnimationFrame(updateCountsNav.raf);
      updateCountsNav.raf = requestAnimationFrame(updateCountsNav);
    });
    updateCountsNav();
  }
  function scrollCounts(dir) {
    if (!countsScroller) return;
    const step = 240; // ~larghezza card
    countsScroller.scrollBy({ left: dir * step, behavior: 'smooth' });
    setTimeout(updateCountsNav, 300);
  }
  if (countsPrev) countsPrev.addEventListener('click', () => scrollCounts(-1));
  if (countsNext) countsNext.addEventListener('click', () => scrollCounts(1));

  // --- Aiuto alla ricerca: UI ---
  function openSearchHelp() {
    if (!shModal) return;
    shModal.hidden = false;
    shModal.setAttribute('aria-hidden', 'false');
    // focus sul campo di testo dopo apertura
    setTimeout(() => shTextarea && shTextarea.focus(), 0);
    // reset stato bottone e risultati
    shMode = 'suggest';
    shLastData = null;
    if (shSuggestBtn) shSuggestBtn.textContent = 'Suggerisci ricerca';
    if (shResult) shResult.innerHTML = '';
  }

  function closeSearchHelp() {
    if (!shModal) return;
    shModal.hidden = true;
    shModal.setAttribute('aria-hidden', 'true');
  }

  if (searchHelpBtn) searchHelpBtn.addEventListener('click', openSearchHelp);
  if (utilHelpBtn) utilHelpBtn.addEventListener('click', openSearchHelp);
  if (shCloseBtn) shCloseBtn.addEventListener('click', closeSearchHelp);
  if (shModal) {
    // Chiudi cliccando sull'overlay fuori dalla dialog
    shModal.addEventListener('click', (e) => {
      if (e.target === shModal) closeSearchHelp();
    });
  }

  // Tooltip che appare alla prima ricerca non vuota
  let tipShown = false;
  function showUtilTip() {
    if (!utilHelpTip || tipShown) return;
    utilHelpTip.hidden = false;
    requestAnimationFrame(() => utilHelpTip.classList.add('show'));
    tipShown = true;
  }
  function hideUtilTip() {
    if (!utilHelpTip) return;
    utilHelpTip.classList.remove('show');
    utilHelpTip.hidden = true;
  }
  if (utilHelpTip) {
    const close = utilHelpTip.querySelector('.tip-close');
    if (close) close.addEventListener('click', hideUtilTip);
    utilHelpTip.addEventListener('click', (e) => {
      // clic sul tooltip apre anche la modale
      if (e.target.closest('.tip-content')) {
        hideUtilTip();
        openSearchHelp();
      }
    });
  }

  function renderSearchHelpResult(data) {
    if (!shResult) return;
    shResult.innerHTML = '';

    if (!data || !Array.isArray(data.archivi) || data.archivi.length === 0) {
      const div = document.createElement('div');
      div.className = 'system-hint';
      div.textContent = 'Nessun suggerimento disponibile.';
      shResult.appendChild(div);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'sh-grid';
    data.archivi.forEach((a, idx) => {
      const card = document.createElement('div');
      card.className = 'sh-card';
      card.dataset.archive = a.nome || `archivio_${idx}`;

      const head = document.createElement('div');
      head.className = 'sh-card-head';
      const name = document.createElement('div');
      name.className = 'sh-name';
      name.textContent = a.nome || 'Archivio';
      head.appendChild(name);

      const motive = document.createElement('div');
      motive.className = 'sh-motive';
      motive.textContent = a.motivazione || '';

      const ul = document.createElement('ul');
      ul.className = 'sh-tip-list';
      (a.tipologie || []).forEach((t, i2) => {
        const li = document.createElement('li');
        li.className = 'sh-tip';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'sh-tip-cb';
        cb.id = `tip-${idx}-${i2}`;
        cb.value = t;
        const lab = document.createElement('label');
        lab.setAttribute('for', cb.id);
        lab.textContent = t;
        li.appendChild(cb);
        li.appendChild(lab);
        ul.appendChild(li);
      });

      // Clic sulla card seleziona l'archivio (esclusi click su input/label interni)
      card.addEventListener('click', (e) => {
        if (e.target.closest('input') || e.target.tagName === 'LABEL') return;
        grid.querySelectorAll('.sh-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });

      card.appendChild(head);
      if (a.motivazione) card.appendChild(motive);
      if (a.tipologie && a.tipologie.length) card.appendChild(ul);
      grid.appendChild(card);
    });

    shResult.appendChild(grid);

    if (Array.isArray(data.filtri) && data.filtri.length) {
      const ft = document.createElement('div');
      ft.className = 'sh-filters';
      const title = document.createElement('div');
      title.className = 'sh-filters-title';
      title.textContent = 'Filtri consigliati (data)';
      const chips = document.createElement('div');
      chips.className = 'sh-filter-chips';
      data.filtri.forEach((f, i3) => {
        const lab = document.createElement('label');
        lab.className = 'sh-filter-chip';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'sh-filter-cb';
        cb.id = `filt-${i3}`;
        cb.value = f;
        const span = document.createElement('span');
        span.textContent = f;
        lab.appendChild(cb);
        lab.appendChild(span);
        chips.appendChild(lab);
      });
      ft.appendChild(title);
      ft.appendChild(chips);
      shResult.appendChild(ft);
    }

    // Solo se ci sono archivi, abilita modalità "apply"
    if (Array.isArray(data.archivi) && data.archivi.length) {
      shLastData = data;
      shMode = 'apply';
      if (shSuggestBtn) shSuggestBtn.textContent = 'Applica suggerimenti';
    }
  }

  if (shSuggestBtn) {
    shSuggestBtn.addEventListener('click', async () => {
      if (!shResult) return;
      const text = (shTextarea && shTextarea.value || '').trim();
      if (shMode === 'apply' && shLastData) {
        // Prima chiudi la modale, poi applica i suggerimenti e mostra i risultati
        closeSearchHelp();
        setTimeout(() => {
          const selectedData = collectSearchHelpSelection(shLastData);
          applySuggestions(selectedData, text);
        }, 40);
        return;
      }
      shResult.innerHTML = '<div class="typing">Analizzo la richiesta…</div>';
      try {
        const out = await window.suggestSearch(text);
        renderSearchHelpResult(out);
      } catch (e) {
        const err = document.createElement('div');
        err.className = 'system-hint';
        err.textContent = 'Si è verificato un problema nel recupero dei suggerimenti.';
        shResult.innerHTML = '';
        shResult.appendChild(err);
      }
    });
  }

  // Raccoglie selezione utente dalla modale e crea un payload compatibile con applySuggestions
  function collectSearchHelpSelection(fallbackData) {
    const selectedCard = shResult.querySelector('.sh-card.selected');
    let nome = null;
    let tips = [];
    if (selectedCard) {
      nome = selectedCard.dataset.archive || selectedCard.querySelector('.sh-name')?.textContent?.trim() || null;
      tips = Array.from(selectedCard.querySelectorAll('.sh-tip-cb:checked')).map(cb => cb.value);
    }
    const filt = Array.from(shResult.querySelectorAll('.sh-filter-cb:checked')).map(cb => cb.value);
    if (!nome && Array.isArray(fallbackData.archivi) && fallbackData.archivi.length) {
      nome = fallbackData.archivi[0].nome || 'Archivio';
      tips = (fallbackData.archivi[0].tipologie || []).slice(0, 2);
    }
    return { archivi: [{ nome, tipologie: tips }], filtri: filt };
  }

  // Applica: archivio; sottocategoria; filtri; testo ricerca
  function applySuggestions(data, userText) {
    // 1) Archivio: prendi l'archivio a priorità minima
    const chosen = [...(data.archivi || [])]
      .slice()
      .sort((a, b) => (a.priorita ?? 999) - (b.priorita ?? 999))[0];
    let archiveName = chosen && chosen.nome ? String(chosen.nome) : null;
    // Normalizza a solo due etichette per la demo: Giurisprudenza o Normativa
    const nameLower = (archiveName || '').toLowerCase();
    const displayArchive = nameLower.includes('normativa') ? 'Normativa' : 'Giurisprudenza';

    // 2) Sottocategorie: lista tipologie del primo archivio scelto
    const subcats = (chosen && Array.isArray(chosen.tipologie)) ? chosen.tipologie : [];

    // 3) Filtri consigliati
    const filters = Array.isArray(data.filtri) ? data.filtri : [];

    // 4) Testo di ricerca: usa userText se fornito, altrimenti costruisci dalle tipologie
    const q = (userText && userText.trim()) || subcats.join(' ');

    // Aggiorna UI: select archivio (testo nella sb-select)
    const sbSelect = document.querySelector('.sb-select');
    if (sbSelect) {
      const chev = '<span class="chev">▾</span>';
      sbSelect.innerHTML = `${displayArchive} ${chev}`;
    }

    // Aggiorna campo ricerca
    const searchInput = document.getElementById('search');
    if (searchInput) {
      searchInput.value = q || searchInput.value;
      // Demo: mantieni sempre risultati visibili e rimescola (azione esplicita)
      if (typeof performSearchFilter === 'function') performSearchFilter(searchInput.value);
      // Focus al campo ricerca per feedback utente
      searchInput.focus();
    }

    // Nessun riepilogo visuale sotto i sinonimi (assistApplied rimosso su richiesta)

    // Messaggio di sistema nella pagina per feedback
    pushSystem('Suggerimenti applicati alla ricerca.');

    // Porta l'area risultati in vista dopo l'applicazione
    const resultsEl = document.getElementById('resultList');
    if (resultsEl) {
      setTimeout(() => {
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 30);
    }
  }

  // --- Aiuto alla ricerca: funzione mock esposta globalmente ---
  // Simula una chiamata AI; restituisce il JSON di esempio dopo una breve latenza.
  window.suggestSearch = function suggestSearch(userText) {
    // userText non è utilizzato nel mock; in futuro piloterà il modello
    const example = {
      archivi: [
        {
          nome: 'Giurisprudenza',
          motivazione: 'La richiesta riguarda orientamenti giurisprudenziali.',
          priorita: 1,
          tipologie: ['Sentenze Cassazione Civile', 'Sentenze di Merito']
        },
        {
          nome: 'Normativa',
          motivazione: 'Sono presenti riferimenti normativi.',
          priorita: 2,
          tipologie: ['Leggi nazionali']
        }
      ],
      filtri: ['Data ultimi 5 anni']
    };
    return new Promise(resolve => {
      const delay = 800 + Math.floor(Math.random() * 600);
      setTimeout(() => resolve(example), delay);
    });
  };
})();
