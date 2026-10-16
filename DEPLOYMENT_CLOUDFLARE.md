# Free temporary demo with Cloudflare

This runs the Django API, Celery worker, scheduler, and Redis on your computer.
Cloudflare provides a temporary public HTTPS API address; Vercel hosts the frontend.
Keep the computer awake, online, and the demo launcher running during the demo.
No Cloudflare account, domain purchase, or paid hosting resource is required.

## Start

This Windows setup uses the existing Python virtual environment and Redis 7 in
the `Ubuntu` WSL distribution. It does not install a Windows service or require
an administrator account. From the repository root:

```powershell
npm.cmd run demo:cloudflare
```

The default approved frontend is `https://traffic-aux-optimizer.vercel.app`.
If Vercel assigned a different domain, specify it exactly:

```powershell
npm.cmd run demo:cloudflare -- --frontend https://YOUR-ACTUAL-PROJECT.vercel.app
```

The launcher downloads the official Windows cloudflared 2026.10.1 binary and
verifies its SHA-256 checksum against the official release. It uses an isolated
API on `127.0.0.1:8001` and Redis on port `6381`, and stops if either port is
already occupied. Ordinary local development ports and configuration are unchanged.

## Demo data and login

The public demo uses `.cloudflare-demo/public-demo.sqlite3`, containing 24
**fictional officers** and 10 **fictional locations** near the app's map center.
It does not copy your real roster, accounts, incidents, or schedules. Names and
badges explicitly identify fictional records. These are sample data for exercising
the application, not operational deployment recommendations. Live weather/traffic
provider requests still use the existing backend provider configuration when present.

A new `demo_admin` account has a randomly generated password. Open
`.cloudflare-demo/login.txt` locally for the credentials. Do not commit or publicly
share that file. Existing development accounts/passwords do not work in this demo.
Demo changes persist in the separate demo SQLite file between launcher restarts.

The launcher uses separate signing secrets, turns debug off, allows only the exact
tunnel hostname, and restricts browser requests to the configured frontend. Demo
WebSockets require both login and the approved browser origin. The operational
database is not used by the public API or its worker/scheduler.

## Connect Vercel

When the launcher reports it is ready, open `.cloudflare-demo/vercel.env`.
Its contents look like this, using the actual URL allocated to this session:

```dotenv
VITE_API_BASE_URL=https://YOUR-ASSIGNED-NAME.trycloudflare.com
```

In Vercel, enter `VITE_API_BASE_URL` as the key and the HTTPS address as its value.
Select the environments you need and deploy/redeploy the frontend. Keep the
repository root, existing build command, and output directory settings.

Check `<API-URL>/api/health/`, then log in through the Vercel frontend using the
demo credentials. Test optimization progress as well as normal dashboard requests.
Run `npm.cmd run demo:check` to verify public health, demo login, fictional data,
CORS, and WebSocket access without printing credentials or access tokens.
If the actual Vercel frontend domain differs from the approved origin, stop and
restart with `--frontend` set to the correct origin.

The URL changes when you restart the tunnel. Update the Vercel variable and
redeploy after each change. `.cloudflare-demo/running.json` records the current
launcher session; `.cloudflare-demo/vercel.env` retains the last allocated URL even
when stopped, so it does not by itself prove the tunnel is still active.

## Stop

Press Ctrl+C in the launcher terminal, or use a second terminal:

```powershell
npm.cmd run demo:stop
```

The launcher closes the public tunnel first, then stops its API, worker, scheduler,
and dedicated Redis. It does not stop your unrelated local development services.
Logs and private runtime files are in the Git-ignored `.cloudflare-demo` folder,
which is also excluded from Vercel CLI uploads.

## Limitations

Quick Tunnels are temporary testing endpoints with no uptime guarantee and a limit
of 200 in-flight requests. SQLite and a single worker are intended for a small
demo. This does not turn the app into an always-on production deployment. The
existing supported-Django upgrade requirement in `DEPLOYMENT_VERCEL.md` still
applies before public production use.

References: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
and the [pinned cloudflared release](https://github.com/cloudflare/cloudflared/releases/tag/2026.10.1).
