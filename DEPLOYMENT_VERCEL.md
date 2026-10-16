# Deploy the web application to Vercel

This repository is configured to deploy the React frontend to Vercel and connect it to a separately hosted Django backend. End users only need a browser.

For a concrete backend hosting setup and instructions for obtaining the
`VITE_API_BASE_URL` value, see [Deploy the backend on Render](DEPLOYMENT_RENDER.md).
For a free temporary demonstration using your computer and fictional sample data,
see [Cloudflare demo setup](DEPLOYMENT_CLOUDFLARE.md).

## 1. Host the backend services

| Service | Purpose |
| --- | --- |
| Vercel | Frontend pages and static assets |
| Django ASGI web service | HTTPS API, traffic tile proxy, authenticated WebSockets |
| Celery worker | Optimization and background ingestion |
| One Celery beat scheduler | Periodic traffic/weather refresh and schedule maintenance |
| PostgreSQL and Redis | Persistent records, task queue, cache and Channels messaging |

Use a backend host that supports the supplied Docker image, persistent services, outbound provider requests and WebSockets. Build with `traffic_dss_backend` as the Docker context. The image starts Daphne and uses the host's `PORT` variable (8000 by default). It excludes local secrets, databases and test artifacts.

Copy the **variable names** from `traffic_dss_backend/.env.example` into your backend host's environment settings. Replace every placeholder. Set separate random `SECRET_KEY` and `JWT_SECRET_KEY` values, `DJANGO_ENV=production`, `DEBUG=False`, and your actual database, Redis and TomTom credentials. The web service, worker and beat must share the same database and Redis configuration. Keep these credentials out of Vercel's frontend variables.

Set these values for the actual domains:

```dotenv
ALLOWED_HOSTS=api.your-domain.com
CORS_ALLOW_ALL_ORIGINS=False
CORS_ALLOWED_ORIGINS=https://your-project.vercel.app,https://your-custom-domain.com
CSRF_TRUSTED_ORIGINS=https://api.your-domain.com
```

Remove unused domains. `ALLOWED_HOSTS` contains hostnames; CORS/CSRF entries contain full origins without paths or trailing slashes. Preview deployments need their own approved origins and preferably a staging backend. Do not enable unrestricted CORS to accommodate random preview URLs.

If the backend host terminates HTTPS at a trusted proxy, set `TRUST_PROXY_HTTPS=True` **only if that proxy strips/replaces client-supplied `X-Forwarded-Proto` headers**. This lets Django generate HTTPS pagination URLs. Secure admin cookies are enabled in production. Configure the host to redirect public HTTP to HTTPS.

Run release commands from the backend directory with production variables present:

```sh
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py check --deploy
```

Static admin assets are served by WhiteNoise after collection. If releases run in a separate disposable container, collect static assets in the image or otherwise make the collected directory available to the web container. Store uploaded media on persistent storage. Review Django's deployment checks against the host's HTTPS settings.

Run these as **three separate services**, using the same code version:

```sh
# Web (already the Docker image's default; $PORT is supplied by the host)
daphne -b 0.0.0.0 -p "$PORT" config.asgi:application
# Worker
celery -A config worker --loglevel=info
# Exactly one scheduler
celery -A config beat --loglevel=info
```

Provide a writable location for backend logs and the beat schedule file. Do not run Electron or the Windows development service launcher on the backend host. Migrations create the schema; they do not transfer local officers, bottlenecks or operational records. Import the intended dataset separately and replace the README's demo accounts before sharing access.

**Production dependency prerequisite:** the backend currently requires Django 4.2 (`<5`), which is outside support as of this deployment preparation. Upgrade to a supported Django release and run backend regression tests before public production use. This frontend hosting change does not perform that framework migration. See [Django's supported versions](https://www.djangoproject.com/download/).

## 2. Import the frontend into Vercel

1. Push the intended changes to your repository, then import it into Vercel.
2. Select the repository root (`.`), with framework **Vite**. Keep the build/install overrides in `vercel.json`:
   - Install: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`
   - Build: `npm run build:web`
   - Output directory: `dist`
3. Add the frontend variable to the relevant Production and Preview environments:

   ```dotenv
   VITE_API_BASE_URL=https://api.your-domain.com
   ```

   Use the backend origin only: no `/api`, credentials, query string or trailing path. HTTPS is required. The build rejects missing URLs and common local/private addresses, but does not test backend reachability.
4. Deploy. Add the final Vercel/custom origin to the backend's CORS allowlist and restart the backend if its configuration changed.

The SPA rewrite in `vercel.json` serves the application for direct links and refreshed nested routes. Web builds use `/assets/...`; local/desktop builds retain relative asset paths. The existing WebSocket URL builder turns the configured HTTPS origin into WSS automatically.

`VITE_*` values are public and embedded during build. Changing the backend URL requires a new frontend deployment. Never put database passwords, Django signing secrets or provider keys in a `VITE_*` variable. `.vercelignore` excludes backend and field-test files from CLI uploads; it does not remove sensitive files already committed to Git.

## 3. Verify the hosted application

- Check `https://api.your-domain.com/api/health/` and sign in from the Vercel site.
- Refresh a nested route such as `/incident-report/<existing-id>` and verify JavaScript assets load.
- Check officer lists beyond the first page; requests and pagination must remain HTTPS.
- Check dashboard and optimization WebSockets connect over WSS.
- Verify base map and traffic tiles load through the hosted API; inspect input timestamps to confirm ingestion is fresh.
- Run a **Shadow field comparison** on staging, observe progress and download its recommendation CSV. Shadow results must remain unpublishable.
- Check publication preview for an eligible operational run without confirming a real deployment during this smoke test.

A successful static build does not prove hosted API connectivity, provider access, data freshness or worker availability. Those checks require the actual deployed services.

## Local web preview

Use a hosted staging backend, or copy the root `.env.example` to `.env.web.local` with that backend's URL. In PowerShell:

```powershell
$env:VITE_API_BASE_URL = 'https://api.your-domain.com'
npm run build:web
npm run preview:web
```

Allow `http://127.0.0.1:8080` on that staging backend for this preview. `npm run build:desktop` and the existing `npm run build` preserve the local desktop build. Normal local development still defaults to `http://127.0.0.1:8000`.

References: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Vite environment variables](https://vite.dev/guide/env-and-mode), [Django proxy HTTPS configuration](https://docs.djangoproject.com/en/4.2/ref/settings/#secure-proxy-ssl-header).
