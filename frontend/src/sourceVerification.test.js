import test from 'node:test'
import assert from 'node:assert/strict'
import { getSourceVerification } from './sourceVerification.js'

const docs = {
  'divorzio-legge': { title: 'Legge', verification: { status: 'ok', label: 'Fonte presente', description: 'Scheda demo' } },
  'divorzio-cass': { title: 'Cassazione', verification: { status: 'warning', label: 'Da contestualizzare', description: 'Pronuncia successiva' } },
  doc1: { title: 'Altra fonte' }
}

test('mostra una sola riga per ciascun riferimento citato e mantiene gli esiti predefiniti', () => {
  const rows = getSourceVerification('Norma [divorzio-legge], sentenza [divorzio-cass] e ancora [divorzio-legge].', docs)
  assert.deepEqual(rows.map(({ id, status }) => ({ id, status })), [
    { id: 'divorzio-legge', status: 'ok' },
    { id: 'divorzio-cass', status: 'warning' }
  ])
})

test('distingue riferimenti assenti e fonti prive di un esito demo', () => {
  const rows = getSourceVerification('[doc-mancante] [doc1] [upl1]', docs)
  assert.deepEqual(rows.map(({ status }) => status), ['missing', 'unknown', 'unknown'])
  assert.match(rows[0].description, /non dimostra che la fonte non esista/)
})

test('mostra la fonte inventata della risposta demo come non trovata in DeJure', () => {
  const rows = getSourceVerification('[doc-cass-99999-2025]', docs)
  assert.deepEqual(rows[0], {
    id: 'doc-cass-99999-2025',
    title: 'Cass. civ., sez. I, 15 giugno 2025, n. 99999',
    status: 'missing',
    label: 'Non trovata nella banca dati DeJure',
    description: 'Il riferimento non è presente nella banca dati DeJure simulata; questo non dimostra che la fonte non esista.'
  })
})

test('ignora link markdown e testo non identificabile come riferimento', () => {
  assert.deepEqual(getSourceVerification('[divorzio-legge](https://example.com) [nota] nessuna fonte', docs), [])
})

test('riconosce la legge 898/1970 citata senza identificativo', () => {
  const id = 'divorzio-legge-898-1970'
  const law = { [id]: { title: 'Legge 898/1970', verification: { status: 'ok', label: 'Fonte presente', description: 'Testo fornito' } } }
  for (const citation of ['Legge 1 dicembre 1970, n. 898', 'legge n. 898/1970', 'L. n. 898 del 1970', 'legge **898/1970**']) {
    const rows = getSourceVerification(`Ai sensi della ${citation}.`, law, [id])
    assert.equal(rows.length, 1, citation)
    assert.equal(rows[0].id, id, citation)
    assert.equal(rows[0].status, 'ok', citation)
  }
})

test('include il perimetro originario senza attribuire citazioni o esiti alle fonti non citate', () => {
  const rows = getSourceVerification('Si veda [divorzio-cass].', docs, ['divorzio-legge', 'divorzio-cass'])
  assert.deepEqual(rows.map(({ id, status, label }) => ({ id, status, label })), [
    { id: 'divorzio-cass', status: 'warning', label: 'Da contestualizzare' },
    { id: 'divorzio-legge', status: 'unknown', label: 'Selezionata, non citata' }
  ])
})
