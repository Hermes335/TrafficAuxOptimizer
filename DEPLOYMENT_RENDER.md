# Get the backend URL for Vercel

The value of `VITE_API_BASE_URL` is the HTTPS origin assigned to the Django
**web service** after deployment. It is not the GitHub URL, Redis URL, database
connection string, or Vercel frontend URL. No public URL has been created by
adding these files.

## Resources and cost review

The root `render.yaml` defines these resources in Singapore, near the app's
Iloilo users:

| Resource | Purpose | Configured plan |
| --- | --- | --- |
| `trafficaux-api` | Django HTTP API and WebSockets | `0.5c-512mb` |
| `trafficaux-worker` | Optimization and background tasks | `0.5c-512mb` |
| `trafficaux-beat` | One periodic scheduler | `0.5c-512mb` |
| `trafficaux-db` | PostgreSQL records | `0.1c-256mb`, 1 GB storage |
| `trafficaux-redis` | Queue, cache, and WebSocket messaging | `256mb` |

The scheduler also uses a 1 GB persistent disk. These are **paid resources**.
Review Render's displayed monthly estimate before applying the Blueprint.
These are small starting sizes, not a measured capacity recommendation; increase
worker memory if your optimization workload exceeds it. No service has been
created or billed by preparing this repository. Automatic code deploys are off;
deploy subsequent backend versions together from the Render dashboard.

## Deploy the backend

1. Commit and push `render.yaml`, this guide, and the updated backend
   `.dockerignore` to the GitHub branch you intend to deploy. Keep `.env` files
   out of Git. The existing backend Dockerfile must be in that branch as well.
2. Sign in to [Render](https://dashboard.render.com/) and connect GitHub with
   access to `Hermes335/TrafficAuxOptimizer`.
3. Open **Blueprints**, choose **New Blueprint Instance**, select that repository
   and branch, and use the root `render.yaml` file. Resource names in this file
   must not collide with unrelated existing Render resources.
4. When prompted, provide:

   | Variable | What to enter |
   | --- | --- |
   | `CORS_ALLOWED_ORIGINS` | The exact frontend origin, e.g. `https://YOUR-PROJECT.vercel.app`, without a trailing slash or path. Multiple approved origins may be comma-separated. |
   | `TOMTOM_API_KEY` | Your actual TomTom API key, entered privately in Render. This is needed for live traffic integration. |

   If Vercel has not assigned a frontend domain yet, choose the intended project
   name there first and confirm its domain; update this variable if the final
   domain differs. The allowlist must contain the actual frontend domain before
   browser login works. Do not enable unrestricted CORS.
5. Review the services and cost estimate, then deploy the Blueprint. Render
   generates shared signing secrets and wires the database and Redis URLs.
   The API's allowed hostname comes from its actual Render hostname. All three
   Python services use the same credentials and data stores.
6. Wait for the API migration step and all services to finish deploying. The web
   service collects admin static files in its serving container before starting
   Daphne. If a background service starts before the first migration finishes,
   inspect its logs and restart it after migrations succeed. Keep exactly one
   scheduler; its disk prevents overlapping instances during deployments.
7. Open `trafficaux-api` and copy the **actual public HTTPS URL shown by Render**.
   Render may add a suffix; do not guess the URL from the service name. Open
   `<that-url>/api/health/` and confirm it returns `{"status":"ok"}`.
   This check confirms the API responds, not that ingestion and optimization work.
8. In the API service's Render Shell, run `python manage.py createsuperuser` and
   choose a new password interactively. The new database starts empty. Your local
   accounts, officers, bottlenecks, and schedules are not transferred by migrations;
   import the intended dataset separately before operational use. Do not publish
   the local test accounts and passwords.

## Enter the value in Vercel

Replace `EXAMPLE_NAME` with `VITE_API_BASE_URL`. Paste the copied API HTTPS URL
as its value, with no `/api` or other path. Select the appropriate environments,
then deploy the frontend using the repository root and its existing `vercel.json`.

For example only, if Render actually assigned `https://trafficaux-api-abc.onrender.com`:

```dotenv
VITE_API_BASE_URL=https://trafficaux-api-abc.onrender.com
```

Use your real assigned URL. Confirm the final frontend domain is included in
`CORS_ALLOWED_ORIGINS` and redeploy/restart the Python services if configuration
changed. Newly approved preview origins must be added explicitly. Frontend
environment changes require a new Vercel deployment.

Test browser login, HTTPS pagination, WSS connections, traffic tiles, background
optimization, and periodic data refresh. The complete checklist is in
[DEPLOYMENT_VERCEL.md](DEPLOYMENT_VERCEL.md).

## Before public production use

The backend requires Django 5.2 LTS (`>=5.2,<5.3`). The Azure deployment preparation
passed all 355 backend regression tests on Django 5.2.18 using isolated SQLite
test settings. Verify the deployed PostgreSQL application and the checks below
on the chosen host. See [Django's supported versions](https://www.djangoproject.com/download/).

The API service has a separate 1 GB persistent disk at `/var/incident-photos` for
incident photos (`PRIVATE_MEDIA_ROOT`). This disk is an additional paid resource;
review the Blueprint before deploying. Photos are served through authenticated
`/api/incidents/<id>/photo/` requests, including with `DEBUG=False`. Do not expose
this directory through a public static/media route. The scheduler disk stores its
schedule only. Keep backend credentials in Render, and put only the public API
origin in Vercel's `VITE_*` settings. See [public reporting](INCIDENT_REPORTING.md)
for migrations, verification, and backup requirements.

References: [Render Blueprints](https://render.com/docs/blueprint-spec),
[Docker services](https://render.com/docs/docker),
[Celery workers](https://render.com/docs/deploy-celery),
[persistent disks](https://render.com/docs/disks),
and [pricing](https://render.com/pricing).
