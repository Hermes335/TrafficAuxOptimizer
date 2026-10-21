// Test the deployed sign-in page in an isolated browser profile. Never log credentials or tokens.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const state = path.join(root, '.cloudflare-demo');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const azure = process.argv.includes('--azure')
    ? JSON.parse(fs.readFileSync(path.join(state, 'azure-provision.json'), 'utf8')) : null;
  const runtime = azure || JSON.parse(fs.readFileSync(path.join(state, 'running.json'), 'utf8'));
  const credentials = azure ? { username: 'demo_admin', password: azure.demo_password }
    : JSON.parse(fs.readFileSync(path.join(state, 'credentials.json'), 'utf8'));
  const profile = fs.mkdtempSync(path.join(state, 'browser-check-'));
  const browser = spawn(process.env.BROWSER_EXE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let launchError;
  browser.on('error', error => { launchError = error; });
  let socket;
  let call;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let attempt = 0; attempt < 150 && !fs.existsSync(portFile); attempt++) {
      if (launchError) throw launchError;
      await wait(100);
    }
    if (!fs.existsSync(portFile)) throw new Error('Isolated browser did not start.');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    let loginStatus;
    let loginOrigin;
    let trafficActivityStatus;
    let loginSubmitted = false;
    const protectedRequestsBeforeLogin = new Set();
    const pending = new Map();
    socket.onmessage = message => {
      const event = JSON.parse(message.data);
      if (event.id) {
        const request = pending.get(event.id);
        if (!request) return;
        pending.delete(event.id);
        clearTimeout(request.timeout);
        event.error ? request.reject(new Error(event.error.message)) : request.resolve(event.result);
      } else if (event.method === 'Network.requestWillBeSent') {
        const pathname = new URL(event.params.request.url).pathname;
        if (!loginSubmitted && pathname.startsWith('/api/dashboard/')) protectedRequestsBeforeLogin.add(pathname);
      } else if (event.method === 'Network.responseReceived') {
        const response = event.params.response;
        if (new URL(response.url).pathname === '/api/auth/login/') {
          loginStatus = response.status;
          loginOrigin = new URL(response.url).origin;
        }
        if (event.params.type !== 'Preflight' && new URL(response.url).pathname === '/api/traffic/activity/') {
          trafficActivityStatus = response.status;
        }
      }
    };
    call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 20000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error('Browser evaluation failed.');
      return result.result.value;
    };
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Network.enable');
    await call('Page.navigate', { url: runtime.frontend + '/login' });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      ready = await evaluate("!!document.querySelector('#username') && !!document.querySelector('#password')");
      if (ready) break;
      await wait(200);
    }
    if (!ready) throw new Error('The deployed login form did not load.');
    if (process.argv.includes('--login-requests')) {
      await wait(1000);
      if (protectedRequestsBeforeLogin.size) throw new Error('The public sign-in page requested protected dashboard data.');
      console.log('PASS: public sign-in page makes no protected dashboard requests.');
    }
    await evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      for (const [id, value] of ${JSON.stringify([['username', credentials.username], ['password', credentials.password]])}) {
        const input = document.getElementById(id);
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await wait(100);
    loginSubmitted = true;
    await evaluate("document.querySelector('button[type=submit]').click()");
    let pathname;
    for (let attempt = 0; attempt < 100; attempt++) {
      pathname = await evaluate('location.pathname');
      if (pathname !== '/login') break;
      await wait(200);
    }
    console.log('Browser login HTTP status:', loginStatus ?? 'No login response received');
    console.log('Resulting page:', pathname);
    if (azure && loginOrigin !== 'https://' + azure.hostname) {
      throw new Error('The deployed frontend is not using the expected Azure backend.');
    }
    if (loginStatus !== 200 || pathname === '/login') {
      const visibleError = await evaluate("document.querySelector('.bg-red-50')?.innerText || 'No error displayed'");
      console.log('Visible sign-in error:', visibleError);
      throw new Error('Deployed browser sign-in failed.');
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      await wait(1000);
      if (await evaluate('location.pathname') === '/login') {
        throw new Error('The dashboard returned to login after sign-in.');
      }
    }
    await call('Page.reload');
    await wait(3000);
    const session = await evaluate("({ path: location.pathname, token: !!localStorage.getItem('auth_token'), user: !!localStorage.getItem('auth_user') })");
    if (session.path === '/login' || !session.token || !session.user) {
      throw new Error('The browser session did not survive a dashboard reload.');
    }
    console.log('PASS: deployed login stays signed in through dashboard loading and a full page reload.');
    if (process.argv.includes('--traffic-activity')) {
      if (trafficActivityStatus !== 204) throw new Error('The deployed browser did not send a successful traffic activity heartbeat.');
      console.log('PASS: deployed signed-in browser sends the traffic activity heartbeat.');
    }
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) {
      await call('Browser.close').catch(() => {});
      socket.close();
    } else if (browser.exitCode === null) {
      browser.kill();
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
