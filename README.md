
  # TrafficAuxOptimizer Design Help and Demo

  This is a code bundle for TrafficAuxOptimizer Design Help and Demo. The original project is available at https://www.figma.com/design/7G6CKf8Fay63TGRibN7g5W/TrafficAuxOptimizer-Design-Help-and-Demo.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the desktop app with the local backend.

  The renderer runs on Vite at `http://127.0.0.1:5173`, and the Electron backend listens on `http://127.0.0.1:3001`.


Still needs your intervention:

PostgreSQL/PostGIS runtime setup and confirmation.
Redis runtime setup for cache and Channels/Celery.
Celery worker and beat processes.
Real external API keys for TomTom, OpenWeatherMap, and PAGASA.
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