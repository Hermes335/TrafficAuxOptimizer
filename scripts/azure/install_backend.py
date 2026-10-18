"""Run as root on the Azure evaluation VM; read private configuration from stdin."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import quote, urlsplit


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def write(path, content, mode=0o644):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    target.chmod(mode)


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run this installer through sudo.")
    config = json.load(sys.stdin)
    hostname = config["hostname"]
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", hostname):
        raise SystemExit("Invalid API hostname.")
    frontend = urlsplit(config["frontend"])
    if frontend.scheme != "https" or not frontend.hostname or frontend.path not in ("", "/") or frontend.username or frontend.query or frontend.fragment:
        raise SystemExit("Frontend must be an HTTPS origin.")
    db_host = config["database_host"]
    if not db_host.endswith(".postgres.database.azure.com") or not re.fullmatch(r"[a-z0-9.-]+", db_host):
        raise SystemExit("Expected an Azure PostgreSQL endpoint.")
    if len(config["database_admin_password"]) < 8:
        raise SystemExit("Database password is missing.")

    base = Path("/opt/trafficaux")
    app = base / "app"
    venv = base / "venv"
    source = Path("/home/azureuser/traffic-azure-build/source")
    if not source.joinpath("manage.py").is_file():
        raise SystemExit("Backend source bundle is missing.")
    if subprocess.run(["id", "trafficaux"], capture_output=True).returncode:
        run("useradd", "--system", "--home-dir", "/var/lib/trafficaux",
            "--shell", "/usr/sbin/nologin", "trafficaux")
    base.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, app, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("__pycache__", "*.sqlite3", "logs", ".pytest_cache", ".env"))
    if not venv.joinpath("bin/python").exists():
        run("python3", "-m", "venv", str(venv))
    run(str(venv / "bin/pip"), "install", "--disable-pip-version-check", "-q",
        "-r", str(app / "requirements.txt"))
    for directory in ("/var/lib/trafficaux", "/var/lib/trafficaux/private-media", "/var/log/trafficaux"):
        run("install", "-d", "-o", "trafficaux", "-g", "trafficaux", "-m", "750", directory)
    secret_config = Path("/etc/trafficaux/provision.json")
    write(secret_config, json.dumps(config), 0o600)
    provision_database = r'''
import json
import psycopg
from psycopg import sql
config = json.load(open("/etc/trafficaux/provision.json"))
with psycopg.connect(host=config["database_host"], user="trafficadmin",
        password=config["database_admin_password"], dbname="postgres",
        sslmode="verify-full", sslrootcert="/etc/ssl/certs/ca-certificates.crt",
        connect_timeout=15, autocommit=True) as connection:
    cursor = connection.cursor()
    cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = 'trafficapp'")
    if cursor.fetchone() is None:
        cursor.execute(sql.SQL("CREATE ROLE trafficapp LOGIN PASSWORD {}").format(
            sql.Literal(config["database_app_password"])))
    else:
        cursor.execute(sql.SQL("ALTER ROLE trafficapp PASSWORD {}").format(
            sql.Literal(config["database_app_password"])))
    cursor.execute("SELECT 1 FROM pg_database WHERE datname = 'traffic_dss'")
    if cursor.fetchone() is None:
        cursor.execute("CREATE DATABASE traffic_dss OWNER trafficapp")
with psycopg.connect(host=config["database_host"], user="trafficadmin",
        password=config["database_admin_password"], dbname="traffic_dss",
        sslmode="verify-full", sslrootcert="/etc/ssl/certs/ca-certificates.crt",
        connect_timeout=15, autocommit=True) as connection:
    connection.execute("GRANT USAGE, CREATE ON SCHEMA public TO trafficapp")
print("Application database and restricted database role are ready.")
'''
    try:
        run(str(venv / "bin/python"), "-c", provision_database)
    finally:
        secret_config.unlink(missing_ok=True)

    values = {
        "DJANGO_SETTINGS_MODULE": "config.settings",
        "DJANGO_ENV": "production",
        "DEBUG": "False",
        "SECRET_KEY": config["secret_key"],
        "JWT_SECRET_KEY": config["jwt_secret_key"],
        "ALLOWED_HOSTS": hostname + ",localhost,127.0.0.1",
        "CORS_ALLOW_ALL_ORIGINS": "False",
        "CORS_ALLOWED_ORIGINS": config["frontend"].rstrip("/"),
        "CSRF_TRUSTED_ORIGINS": "https://" + hostname,
        "TRUST_PROXY_HTTPS": "True",
        "DATABASE_URL": "postgres://trafficapp:" + quote(config["database_app_password"], safe="") +
            "@" + db_host + ":5432/traffic_dss?sslmode=verify-full&sslrootcert=/etc/ssl/certs/ca-certificates.crt",
        "REDIS_URL": "redis://127.0.0.1:6379/0",
        "PRIVATE_MEDIA_ROOT": "/var/lib/trafficaux/private-media",
        "LOG_DIR": "/var/log/trafficaux",
        "TOMTOM_API_KEY": config.get("tomtom_api_key", ""),
        "PYTHONUNBUFFERED": "1",
    }
    write("/etc/trafficaux/backend.env",
          "".join(f"{key}={json.dumps(value)}\n" for key, value in values.items()), 0o600)
    environment = dict(os.environ, **values)
    run(str(venv / "bin/python"), "manage.py", "migrate", "--noinput", cwd=app, env=environment)
    run(str(venv / "bin/python"), "manage.py", "collectstatic", "--noinput", cwd=app, env=environment)
    run(str(venv / "bin/python"), "manage.py", "check", "--deploy", cwd=app, env=environment)
    seed = r'''
import os, django
django.setup()
from django.contrib.auth import get_user_model
from core.models import Officer, Bottleneck
User = get_user_model()
user, created = User.objects.get_or_create(username="demo_admin")
if created:
    user.is_active = user.is_staff = user.is_superuser = True
    user.set_password(os.environ["DEMO_ACCOUNT_PASSWORD"])
    user.save()
User.objects.filter(username="anonymous").update(password="!")
if not Officer.objects.exists() and not Bottleneck.objects.exists():
    for number in range(1, 11):
        Bottleneck.objects.create(id=f"DEMO{number:02}", name=f"Fictional Demo Junction {number:02}",
            latitude=10.715 + (number // 4) * 0.006, longitude=122.55 + (number % 4) * 0.006,
            district="Fictional Demo District", road_priority_weight=1 + (number % 4) * .25,
            tsi=.3 + (number % 5) * .1, min_officers_required=1, max_officers_allowed=3,
            area_name="Fictional sample data")
    for number in range(1, 25):
        Officer.objects.create(badge_number=f"DEMO-{number:03}",
            name=f"Fictional Demo Officer {number:02}",
            shift="morning" if number <= 12 else "afternoon", status="available", user=None)
print("Evaluation account ready; seeded only fictional sample data into an empty database.")
'''
    run(str(venv / "bin/python"), "-c", seed, cwd=app,
        env=dict(environment, DEMO_ACCOUNT_PASSWORD=config["demo_password"]))

    commands = {
        "api": f"{venv}/bin/python -m daphne -b 127.0.0.1 -p 8000 config.demo_asgi:application",
        "worker": f"{venv}/bin/python -m celery -A config worker --loglevel=info --concurrency=1 --max-tasks-per-child=25",
        "beat": f"{venv}/bin/python -m celery -A config beat --loglevel=info --schedule=/var/lib/trafficaux/celerybeat-schedule",
    }
    for name, command in commands.items():
        write(f"/etc/systemd/system/trafficaux-{name}.service", f"""[Unit]
Description=TrafficAux evaluation {name}
After=network-online.target redis-server.service
Wants=network-online.target
Requires=redis-server.service

[Service]
Type=simple
User=trafficaux
Group=trafficaux
WorkingDirectory={app}
EnvironmentFile=/etc/trafficaux/backend.env
ExecStart={command}
Restart=on-failure
RestartSec=5
TimeoutStopSec=45
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/trafficaux /var/log/trafficaux

[Install]
WantedBy=multi-user.target
""")
    nginx_shared = """server_names_hash_bucket_size 128;
map $http_upgrade $traffic_connection_upgrade {
    default upgrade;
    '' close;
}
log_format traffic_safe '$remote_addr [$time_local] "$request_method $uri $server_protocol" $status $body_bytes_sent';
"""
    write("/etc/nginx/conf.d/trafficaux.conf", nginx_shared)
    nginx_site = """server {
    listen 80;
    server_name HOSTNAME;
    client_max_body_size 12m;
    access_log /var/log/nginx/trafficaux-access.log traffic_safe;
    add_header X-Content-Type-Options nosniff always;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $traffic_connection_upgrade;
        proxy_read_timeout 600s;
    }
}
"""
    certificate = Path("/etc/letsencrypt/live") / hostname
    if certificate.joinpath("fullchain.pem").exists():
        tls_settings = ("listen 443 ssl;\n"
                        f"    ssl_certificate {certificate}/fullchain.pem;\n"
                        f"    ssl_certificate_key {certificate}/privkey.pem;\n"
                        "    include /etc/letsencrypt/options-ssl-nginx.conf;\n"
                        "    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;")
        nginx_site = nginx_site.replace("listen 80;", tls_settings)
        nginx_site += "server { listen 80; server_name HOSTNAME; return 301 https://$host$request_uri; }\n"
    write("/etc/nginx/sites-available/trafficaux", nginx_site.replace("HOSTNAME", hostname))
    enabled = Path("/etc/nginx/sites-enabled/trafficaux")
    if not enabled.exists():
        enabled.symlink_to("/etc/nginx/sites-available/trafficaux")
    run("nginx", "-t")
    run("systemctl", "daemon-reload")
    run("systemctl", "enable", "--now", "trafficaux-api", "trafficaux-worker", "trafficaux-beat")
    run("systemctl", "restart", "trafficaux-api", "trafficaux-worker", "trafficaux-beat")
    run("systemctl", "reload", "nginx")
    print("Backend services configured. HTTPS must be provisioned and verified before frontend cutover.")


if __name__ == "__main__":
    main()
