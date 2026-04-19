
  # TrafficAuxOptimizer Design Help and Demo

  This is a code bundle for TrafficAuxOptimizer Design Help and Demo. The original project is available at https://www.figma.com/design/7G6CKf8Fay63TGRibN7g5W/TrafficAuxOptimizer-Design-Help-and-Demo.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` for the basic renderer + desktop flow.

  Run `npm run dev:local` for the stable Windows local stack (backend + Celery worker + renderer + desktop).

  Run `npm run stop:local` to stop the local stack processes in one command.

  Optional for scheduled jobs: run `npm run dev:beat` in a separate terminal.

  The renderer runs on Vite at `http://127.0.0.1:5173`, and the Electron backend listens on `http://127.0.0.1:3001`.


Still needs your intervention:

PostgreSQL/PostGIS runtime setup and confirmation.
Redis runtime setup for cache and Channels/Celery.
Celery worker and beat processes.
Real external API keys for TomTom, and a PAGASA endpoint if you use one.
Final auth policy for desktop mode versus full JWT enforcement.
WebSocket auth policy for desktop mode versus token-required connections.
Production env values, including secrets, database URL, Redis URL, and VITE_API_BASE_URL if you want to override the default.
Docker/production deployment target and host/port mapping.
Real performance validation on your dataset and infra.
Full smoke test of login/logout, WebSockets, and Docker compose in your environment.
  
List of Items added to gitignore:
# Node
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Build outputs
dist/
build/
coverage/

# Python
.venv/
venv/
__pycache__/
*.py[cod]
*.sqlite3

# Env files
.env
.env.*
!.env.example

# OS/editor noise
.DS_Store
Thumbs.db
.vscode/settings.json

Set up PostgreSQL/PostGIS first. This is the foundation for the real backend data model, and it removes the current SQLite fallback from the normal path.

Start Redis next. Channels and Celery both depend on it, so there’s no point bringing workers up before Redis is stable.

Run Celery worker and beat. That gets weather, traffic, cleanup, and optimization background jobs actually executing.

Decide the auth policy for desktop mode versus full JWT mode. That choice affects API behavior and websocket behavior, so it should be locked before testing the app flow.

Decide the websocket auth policy. Keep it aligned with the API auth decision so you do not end up with one open and the other locked down.

Fill real production env values. At minimum, set secrets, database URL, Redis URL, and VITE_API_BASE_URL if you want the renderer to point somewhere other than localhost.

Confirm TomTom and PAGASA configuration. TomTom key is already important for traffic/map overlays, and PAGASA only matters if you want that fallback path.

Choose the deployment target and port mapping. Do this before packaging so the final host/port layout does not need rework.

Run performance validation on your real dataset and infrastructure. This should happen after the stack is stable, not before.

Finish with a full smoke test: login/logout, websocket reconnects, optimization flow, and Docker compose if you are deploying with containers.

You found the conflict: Windows is running a Redis service on port 6379.

Next step:

Open PowerShell as Administrator.
Stop the Windows Redis service:
Stop-Service Redis
Optional, prevent it from coming back on boot:
Set-Service Redis -StartupType Disabled
Verify the port is free:
netstat -ano | findstr :6379
You want no LISTENING line anymore.

Go back to Ubuntu and make sure WSL Redis is still running:
sudo service redis-server start
redis-cli ping
You want PONG.

Then in the project root, restart the app stack:
npm run stop:local
npm run dev:local