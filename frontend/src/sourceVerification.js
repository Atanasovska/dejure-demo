export function getSourceVerification(content, docsById = {}, selectedDocuments = []) {
  const demoMissingTitles = {
    'doc-cass-99999-2025': 'Cass. civ., sez. I, 15 giugno 2025, n. 99999'
  }
  const references = []
  const seen = new Set()
  const addReference = (id, cited) => {
    const doc = docsById[id]
    if (!doc && !/^(?:doc|divorzio-|upl)\w*[\w.:-]*$/i.test(id)) return
    if (seen.has(id)) return
    seen.add(id)

    const verification = doc?.verification
    references.push({
      id,
      title: doc?.title || demoMissingTitles[id] || id,
      status: !cited ? 'unknown' : verification?.status || (doc || /^upl/i.test(id) ? 'unknown' : 'missing'),
      label: !cited ? 'Selezionata, non citata' : verification?.label || (doc || /^upl/i.test(id) ? 'Non valutata' : 'Non trovata nella banca dati DeJure'),
      description: !cited ? 'La fonte era nel perimetro, ma non è stata individuata tra le citazioni della risposta.' : verification?.description || (doc || /^upl/i.test(id)
        ? 'Non è disponibile un esito simulato per questa fonte.'
        : 'Il riferimento non è presente nella banca dati DeJure simulata; questo non dimostra che la fonte non esista.')
    })
  }

  const text = String(content || '')
  const pattern = /\[([A-Za-z0-9._:-]+)\](?!\()/g
  for (const match of text.matchAll(pattern)) addReference(match[1], true)

  const lawCitation = /\b(?:legge|l\.)\s*(?:n\.\s*)?(?:(?:1|01)\s+dicembre\s+1970\s*,?\s*(?:n\.\s*)?898|898\s*(?:\/\s*1970|\s+(?:del\s+)?1970))\b/i
  if (docsById['divorzio-legge-898-1970'] && lawCitation.test(text.replace(/[*_]/g, ''))) {
    addReference('divorzio-legge-898-1970', true)
  }

  for (const id of selectedDocuments) {
    if (docsById[id]) addReference(id, false)
  }
  return references
}
