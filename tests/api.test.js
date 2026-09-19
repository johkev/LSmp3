const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const port = 3127;
const baseUrl = `http://127.0.0.1:${port}`;
let serverProcess;

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server may need another moment to bind to the test port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Testserveren startet ikke.');
}

before(async () => {
  serverProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1'
    },
    stdio: 'ignore'
  });
  await waitForServer();
});

after(() => {
  serverProcess.kill();
});

test('health-endepunktet svarer OK', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
});

test('frontend og favicon serveres', async () => {
  const pageResponse = await fetch(baseUrl);
  const faviconResponse = await fetch(`${baseUrl}/favicon/favicon.svg`);

  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /Lænsmann MP3/);
  assert.equal(faviconResponse.status, 200);
  assert.match(faviconResponse.headers.get('content-type'), /image\/svg/);
});

test('Spotify-video blir avvist', async () => {
  const response = await fetch(`${baseUrl}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: 'https://open.spotify.com/track/example',
      format: 'mp4',
      quality: '720'
    })
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /Spotify støtter bare lydformatene/);
});

test('ugyldig kvalitet blir avvist', async () => {
  const response = await fetch(`${baseUrl}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/media', format: 'mp3', quality: '999' })
  });

  assert.equal(response.status, 400);
});
