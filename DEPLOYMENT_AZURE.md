# Azure evaluation deployment

The React frontend stays on Vercel. An existing Ubuntu 24.04 x64 VM runs Daphne,
one Celery worker, one Celery beat scheduler, Redis and Nginx. PostgreSQL Flexible
Server holds application records. A database server or VM being ready does not
mean the application has been deployed.

## Resources and private inputs

Use the exact resource sizes covered by the account's displayed allowances:

| Resource | Evaluation configuration |
| --- | --- |
| VM | Standard_B2ats_v2, Ubuntu 24.04 x64, one instance |
| OS disk | 64 GiB Premium SSD P6, LRS |
| PostgreSQL | Burstable Standard_B1ms, PostgreSQL 16, 32 GiB storage |
| Backups | Seven days, geo-redundancy off; monitor actual backup storage |
| Database firewall | Allow only the VM's static public IPv4 |
| VM inbound rules | SSH from administrator's public IP; HTTP/HTTPS publicly |

Use the same region for VM and database. Do not enable extra paid resources by
default. Monitor costs, free-service meters and credit expiry in the Azure portal.
Budgets and reminders do not automatically stop charges. At the end of the
evaluation, export the database and private media, then remove unneeded resources.
Stopping a VM alone leaves other resources allocated.

The public IP resource's Configuration page can assign an Azure-managed DNS name.
Use the actual resulting FQDN, including any generated suffix. Verify DNS points
to the VM before requesting a certificate. This does not require a Namecheap domain.

Keep the SSH private key outside Git. The ignored .cloudflare-demo directory holds
azure-db-password.txt (the database administrator password only), azure_known_hosts,
and generated provisioning credentials. Do not post their contents or upload the
directory. The deploy helper restricts generated credential files to the local user.

## Preparation and deployment

The VM needs Python 3.12 and python3-venv, Redis, Nginx, certbot and
python3-certbot-nginx. For the small evaluation VM, add 2 GiB swap and verify free
memory under the actual workload. Redis must listen on loopback only.

The requirements use Django 5.2 LTS. During preparation, 355 backend tests passed
on Django 5.2.18 using config.test_settings with an isolated in-memory SQLite
database/cache. This does not substitute for PostgreSQL migration and hosted checks.

From the repository root, run the following with real resource values:

    .venv\Scripts\python.exe scripts\azure\deploy_backend.py --host VM_IPV4 --key PATH_TO_PRIVATE_KEY --hostname ACTUAL_AZURE_DNS_NAME --db-host ACTUAL_POSTGRES_ENDPOINT

First establish and verify the server's SSH host key in azure_known_hosts. The
helper requires strict host-key checking. It packages tracked backend Python
source, requirements and pytest configuration; local databases, .env, media and
logs are excluded. Private configuration travels over SSH stdin, not command-line
arguments. The existing local TomTom key is read privately if available.

The installer creates a restricted trafficapp database role and traffic_dss
database with TLS certificate verification. It runs migrations and collectstatic,
then creates demo_admin and fictional officers/junctions only in an empty database.
Existing operational records and local markers are not automatically migrated.
The account password is saved locally in azure-login.txt; existing account
passwords are not reset on repeat deployment.

The API, worker and beat run as a separate trafficaux Linux user under systemd.
The API binds to loopback, and the evaluation ASGI entry point requires approved
origins and authentication for WebSockets. Nginx overwrites proxy headers and its
access log excludes query strings containing WebSocket tokens. Provisioning starts
these services but does not obtain the TLS certificate or change Vercel settings.

## HTTPS and cutover

After DNS and ports 80/443 are verified, obtain a certificate for the actual
hostname with Certbot's Nginx plugin and enable HTTP-to-HTTPS redirection. Test
health, login, authenticated reads, private media, WebSockets, queued optimization
and scheduler operation before updating Vercel's VITE_API_BASE_URL. Use the exact
backend HTTPS origin without /api and redeploy the frontend. The default approved
frontend is https://traffic-off-optimizer.vercel.app; previews need explicit approval.

Verify the initial fictional evaluation deployment with:

    node scripts/check-cloudflare-demo.cjs --azure --optimize
    node scripts/check-deployed-login.cjs --azure

The first check verifies public HTTPS, exact-origin CORS, authenticated data and
WebSockets, and a queued Shadow optimization plus CSV export without publishing.
It expects the initial 24 fictional officers and 10 fictional junctions. The
browser check also verifies the frontend actually uses the Azure origin and
stays signed in after a dashboard refresh. Run it after Vercel redeployment.
Both checks read credentials privately from the ignored provisioning file.
After demo records have been edited, use `--existing-data` with the first check
to verify access and WebSockets without requiring the original seeded records.

For routine verification with existing operational records, run:

    node scripts/check-cloudflare-demo.cjs --azure --existing-data --workflows
    node scripts/check-deployed-login.cjs --azure --traffic-activity --login-requests

The workflow check verifies the response formats used by schedule review,
publication provenance, officer skills, incident review, run history, and run
readiness for both shifts. Readiness is checked without starting a run or
publishing a schedule; an ended shift or staffing shortage can legitimately be
reported in a successful readiness response. The browser check also rejects
protected dashboard requests made by the public sign-in page before login.

Vercel deploys the frontend independently of the Azure backend. A successful
Vercel build does not install new API endpoints or database migrations on the VM.
Deploy the matching backend code and required migrations before releasing a
frontend that uses new endpoints, then run these checks. An HTTP 404 from a
required workflow endpoint fails verification even if `/api/health/` is healthy.

See DEPLOYMENT_VERCEL.md for the full hosted verification checklist.

## Background traffic quota

The frontend posts an authenticated presence heartbeat once a minute while a
signed-in tab is visible. With `TRAFFIC_POLL_ONLY_WHEN_ACTIVE=True` (the default),
traffic polling pauses after 180 seconds without a heartbeat. Hidden tabs,
signed-out users, ordinary API polling and health checks do not extend presence.
Multiple visible users share the lease; one closing the app cannot pause others.
Returning requests a traffic refresh when due, with a shared five-minute cooldown
preventing duplicate provider calls from overlapping users and scheduled jobs.
Visible-tab heartbeats also queue a refresh after the cooldown expires, so a
scheduled poll arriving early does not defer collection until the next beat cycle.
If enqueueing fails, the endpoint returns a retryable 503 and releases its queue
guard; the next visible heartbeat retries even though viewer presence is active.
Requests already in progress can finish; queued work rechecks activity before collecting.
Missing/unavailable presence cache pauses traffic polling to conserve quota.

This pauses the background traffic collection task, including its fallback
requests. Weather and operational maintenance schedules continue. It does not
stop Azure compute or prevent map tiles requested directly by a browser. Saved
traffic observations remain intact and continue to age normally; an idle period
does not make old observations fresh or override optimization input validation.
`TRAFFIC_ACTIVITY_TIMEOUT` configures the grace period (minimum 90 seconds).
Set `TRAFFIC_POLL_ONLY_WHEN_ACTIVE=False` only when continuous unattended traffic
collection is required. Browser heartbeat changes require a Vercel deployment.
Verify the deployed heartbeat with
`node scripts/check-deployed-login.cjs --azure --traffic-activity`.

References: [Azure free services](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/create-free-services),
[PostgreSQL provisioning](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/quickstart-create-server),
[Azure public DNS labels](https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-addresses),
[Django supported releases](https://www.djangoproject.com/download/).
