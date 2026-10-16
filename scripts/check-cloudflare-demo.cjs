const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const state = path.resolve(__dirname, '..', '.cloudflare-demo');

function checkSocket(url, origin, shouldConnect) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin, handshakeTimeout: 15000 });
    const timer = setTimeout(() => finish(new Error('WebSocket check timed out')), 20000);
    let complete = false;
    function finish(error) {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      socket.terminate();
      error ? reject(error) : resolve();
    }
    socket.on('open', () => {
      if (!shouldConnect) finish(new Error('Unapproved WebSocket connection was accepted'));
    });
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString());
      if (message.event === 'connected') socket.send(JSON.stringify({ type: 'ping' }));
      if (message.event === 'pong') finish();
    });
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      // The tunnel can wrap an origin's rejected upgrade in a different HTTP
      // error status. The security property is that no connection is upgraded;
      // the valid-token/approved-origin connection is checked separately.
      if (!shouldConnect && response.statusCode >= 400) finish();
      else finish(new Error(`Unexpected WebSocket HTTP status ${response.statusCode}`));
    });
    socket.on('error', () => {
      if (!complete) finish(new Error('WebSocket transport failed'));
    });
  });
}

async function main() {
  const { url, frontend } = JSON.parse(fs.readFileSync(path.join(state, 'running.json'), 'utf8'));
  const { username, password } = JSON.parse(fs.readFileSync(path.join(state, 'credentials.json'), 'utf8'));
  assert.match(url, /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/);
  const request = (route, options = {}) => fetch(url + route, {
    ...options, signal: AbortSignal.timeout(20000),
  });
  let response = await request('/api/health/');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  console.log('PASS: public HTTPS health check');
  for (const origin of [frontend, 'https://unapproved.example.com']) {
    response = await request('/api/auth/login/', {
      method: 'OPTIONS', headers: { Origin: origin,
        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    assert.equal(response.headers.get('access-control-allow-origin'), origin === frontend ? origin : null);
    await response.arrayBuffer();
  }
  console.log('PASS: exact frontend CORS; other origins rejected');
  response = await request('/api/dashboard/officers/');
  assert.equal(response.status, 401);
  await response.arrayBuffer();
  response = await request('/api/auth/login/', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: frontend },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  const { access } = await response.json();
  assert.ok(access);
  for (const [route, count, prefix] of [
    ['officers', 24, 'Fictional Demo Officer '],
    ['bottlenecks', 10, 'Fictional Demo Junction '],
  ]) {
    response = await request(`/api/dashboard/${route}/`, {
      headers: { Authorization: `Bearer ${access}`, Origin: frontend },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload.results;
    assert.equal(rows.length, count);
    assert.ok(rows.every(row => row.name.startsWith(prefix)));
  }
  console.log('PASS: demo login and authenticated fictional roster/map requests');
  const socketUrl = url.replace('https:', 'wss:') + '/ws/dashboard/';
  await checkSocket(socketUrl + '?token=' + encodeURIComponent(access), frontend, true);
  await checkSocket(socketUrl, frontend, false);
  await checkSocket(socketUrl + '?token=' + encodeURIComponent(access), 'https://unapproved.example.com', false);
  console.log('PASS: public WSS ping/pong; anonymous and unapproved origins rejected');
}

main().catch(error => {
  // Avoid logging request objects, credentials, or query-string access tokens.
  console.error('Demo verification failed:', error.message);
  process.exitCode = 1;
});
