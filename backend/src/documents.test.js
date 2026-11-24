import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

test('API documenti include le schede demo e conserva quelle esistenti', async () => {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));

  const server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  try {
    let response;
    for (let i = 0; i < 50; i += 1) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/documents`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(response, 'Il server non si è avviato');
    assert.equal(response.status, 200);
    const { data } = await response.json();
    const docs = data.items.filter((item) => item.id.startsWith('divorzio-'));
    assert.equal(docs.length, 3);
    assert.deepEqual(docs.map((doc) => doc.verification.status), ['ok', 'warning', 'ok']);
    const law = docs.find((doc) => doc.id === 'divorzio-legge-898-1970');
    assert.equal(law.source.hitId, '2067794-6283668-1');
    assert.equal(law.source.flagVigente, 0);
    assert.match(law.content, /non ha mezzi adeguati o comunque non può procurarseli per ragioni oggettive/);
    assert.match(law.content, /Comma abrogato dall' articolo 6/);
    assert.ok(data.items.some((doc) => doc.id === 'doc1'));
  } finally {
    server.kill();
  }
});
