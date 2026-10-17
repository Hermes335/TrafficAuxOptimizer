# Public incident reporting

Share `https://YOUR-FRONTEND/incident-report`. The form works without an account
and adapts to phones and computers. Reporters place an exact map pin (or use
location permission, a known intersection, or coordinates), enter details, and
optionally capture or upload one photo. They receive a reference after submission.

Anonymous reports enter **Pending review**. Signed-in staff use **Review Reports**
(`/incident-review`) to inspect the details, location and photo, then approve or
reject. Approval makes the incident active on the dashboard and eligible for the
next optimization. Pending/rejected reports do not affect active incident counts
or optimization. Staff reports are immediately active. Editing and resolution
remain staff-only. Dashboard marker creation now offers bottlenecks and POIs;
incident creation belongs to the reporting page.

Camera and automatic location need HTTPS and browser permission for remote
visitors. Camera is optional; file upload and manual location are available.
The camera stream is stopped when the camera closes or the page unmounts.

## Deployment

1. Back up the database and upload directories, then run `python manage.py migrate`.
2. Set `PRIVATE_MEDIA_ROOT` to persistent storage outside the public `MEDIA_ROOT`.
   Local development defaults to `traffic_dss_backend/private-media`; the Render
   Blueprint mounts a dedicated API-service disk at `/var/incident-photos`.
   Docker Compose mounts a named `incident_photos` volume at the same path.
3. Deploy the backend and frontend together. Existing operational APIs now require
   authentication; report metadata, minimal location choices, and new submission
   are the public reporting endpoints. Map traffic requests carry staff credentials
   only to the backend tile origin.
4. Serve frontend and backend over HTTPS. Keep the frontend origin in the backend
   CORS allowlist. Frontend history fallback must route `/incident-report` to the
   app (the existing Vercel rewrite handles this).
5. Do not serve upload directories as static files. Staff photo requests use an
   authenticated API response with private cache controls. Back up private photos
   together with the database; database backups alone do not include image files.

The supplied deployment files prepare hosting configuration; editing them does not
deploy the site or provision a disk. The existing Cloudflare demo still depends on
the local backend/tunnel remaining online. A localhost URL is not a public link.

## Verification

Check a signed-out browser can report and receive a pending reference while the
dashboard, incident review, edit routes, operational APIs and photo endpoints
reject anonymous access. Verify pin coordinates survive submission and approval,
photos display for staff, rejection never activates a marker, repeated submission
retries do not create duplicates, and camera/location denial preserves the draft.
Test the camera on physical Android/iOS devices and a desktop webcam over HTTPS;
headless browser checks cover simulated devices and denied permissions only.
