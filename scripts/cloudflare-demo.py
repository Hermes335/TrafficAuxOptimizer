"""Run an isolated Windows/WSL demo through a temporary Cloudflare URL."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'traffic_dss_backend'
STATE = ROOT / '.cloudflare-demo'
API_PORT = 8001
REDIS_PORT = 6381
CLOUDFLARED_VERSION = '2026.10.1'
CLOUDFLARED_SHA256 = '4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6'
HIDDEN = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0


def frontend_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
            or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise argparse.ArgumentTypeError('Use the exact HTTPS frontend origin, without a path.')
    return f'https://{parsed.netloc}'


def port_is_open(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.5):
            return True
    except OSError:
        return False


def demo_environment(config, origin, hostname='localhost'):
    environment = os.environ.copy()
    environment.update({
        'DJANGO_SETTINGS_MODULE': 'config.settings',
        'DJANGO_ENV': 'production', 'DEBUG': 'False',
        'SECRET_KEY': config['secret_key'], 'JWT_SECRET_KEY': config['jwt_secret_key'],
        'DATABASE_URL': f'sqlite:///{(STATE / "public-demo.sqlite3").as_posix()}',
        'REDIS_URL': f'redis://127.0.0.1:{REDIS_PORT}/0',
        'CELERY_BROKER_URL': f'redis://127.0.0.1:{REDIS_PORT}/0',
        'CELERY_RESULT_BACKEND': f'redis://127.0.0.1:{REDIS_PORT}/0',
        'ALLOWED_HOSTS': f'localhost,127.0.0.1,{hostname}',
        'CORS_ALLOW_ALL_ORIGINS': 'False', 'CORS_ALLOWED_ORIGINS': origin,
        'CSRF_TRUSTED_ORIGINS': f'https://{hostname}' if hostname != 'localhost' else origin,
        'TRUST_PROXY_HTTPS': 'True', 'LOG_DIR': str(STATE / 'logs'),
        'PYTHONUNBUFFERED': '1', 'PYTHONUTF8': '1',
    })
    return environment


def run_backend(args, environment):
    subprocess.run([sys.executable, *args], cwd=BACKEND, env=environment,
                   check=True, creationflags=HIDDEN)


def prepare_database(config, environment):
    database = STATE / 'public-demo.sqlite3'
    if database.exists() and (STATE / 'synthetic-database-ready').exists():
        run_backend(['manage.py', 'migrate', '--noinput'], environment)
        return
    print('Preparing a separate database with fictional demo officers and locations...', flush=True)
    # Never export or read operational roster records for this public demo.
    run_backend(['manage.py', 'migrate', '--noinput'], environment)
    account_env = dict(environment, DEMO_ACCOUNT_PASSWORD=config['password'])
    run_backend(['-c', '\n'.join([
        'import os, django', 'django.setup()',
        'from django.contrib.auth import get_user_model',
        "user, _ = get_user_model().objects.get_or_create(username='demo_admin')",
        'user.is_active = user.is_staff = user.is_superuser = True',
        "user.set_password(os.environ['DEMO_ACCOUNT_PASSWORD'])", 'user.save()',
        'from core.models import Bottleneck, Officer',
        'for number in range(1, 11):',
        '    Bottleneck.objects.update_or_create(',
        "        id=f'DEMO{number:02}', defaults={",
        "            'name': f'Fictional Demo Junction {number:02}',",
        "            'latitude': 10.715 + (number // 4) * 0.006,",
        "            'longitude': 122.55 + (number % 4) * 0.006,",
        "            'district': 'Fictional Demo District',",
        "            'road_priority_weight': 1 + (number % 4) * 0.25,",
        "            'tsi': 0.3 + (number % 5) * 0.1,",
        "            'min_officers_required': 1, 'max_officers_allowed': 3,",
        "            'area_name': 'Fictional sample data',",
        "        })",
        'for number in range(1, 25):',
        '    Officer.objects.update_or_create(',
        "        badge_number=f'DEMO-{number:03}', defaults={",
        "            'name': f'Fictional Demo Officer {number:02}',",
        "            'shift': 'morning' if number <= 12 else 'afternoon',",
        "            'status': 'available', 'user': None,",
        "        })",
    ])], account_env)
    (STATE / 'synthetic-database-ready').write_text('fictional-data-only\n', encoding='utf-8')


def cloudflared_binary():
    binary = STATE / 'bin' / 'cloudflared.exe'
    binary.parent.mkdir(parents=True, exist_ok=True)
    if not binary.exists():
        url = ('https://github.com/cloudflare/cloudflared/releases/download/'
               f'{CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe')
        print(f'Downloading official cloudflared {CLOUDFLARED_VERSION}...', flush=True)
        temporary = binary.with_suffix('.download')
        with urlopen(url, timeout=60) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != CLOUDFLARED_SHA256:
            temporary.unlink()
            raise RuntimeError('cloudflared checksum did not match the official release.')
        temporary.replace(binary)
    if hashlib.sha256(binary.read_bytes()).hexdigest() != CLOUDFLARED_SHA256:
        raise RuntimeError('cloudflared checksum did not match the pinned official release.')
    return binary


def acquire_lock():
    import msvcrt
    handle = (STATE / 'launcher.lock').open('a+b')
    handle.seek(0, 2)
    if handle.tell() == 0:
        handle.write(b'0')
        handle.flush()
    handle.seek(0)
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        handle.close()
        raise RuntimeError('A demo is already running. Use npm.cmd run demo:stop first.')
    return handle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend', type=frontend_origin,
                        default='https://traffic-aux-optimizer.vercel.app')
    parser.add_argument('--stop', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    STATE.mkdir(exist_ok=True)
    if args.stop:
        (STATE / 'stop-requested').touch()
        print('Stop requested. Only services owned by the demo launcher will be stopped.')
        return
    if os.name != 'nt':
        raise RuntimeError('This launcher currently requires Windows with Ubuntu in WSL.')
    lock = acquire_lock()
    processes = []
    logs = []
    redis_started = False
    ready_file = STATE / 'running.json'
    (STATE / 'stop-requested').unlink(missing_ok=True)

    def start(label, command, environment=None):
        log = (STATE / f'{label}.log').open('w', encoding='utf-8')
        logs.append(log)
        process = subprocess.Popen(command, cwd=BACKEND, env=environment,
                                   stdout=log, stderr=subprocess.STDOUT,
                                   creationflags=HIDDEN)
        processes.append((label, process))
        return process

    def check_processes():
        if (STATE / 'stop-requested').exists():
            raise KeyboardInterrupt()
        for label, process in processes:
            if process.poll() is not None:
                raise RuntimeError(f'{label} exited. See {STATE / (label + ".log")}')

    try:
        config_path = STATE / 'credentials.json'
        if config_path.exists():
            config = json.loads(config_path.read_text(encoding='utf-8'))
        else:
            config = {'username': 'demo_admin', 'password': secrets.token_urlsafe(24),
                      'secret_key': secrets.token_urlsafe(48),
                      'jwt_secret_key': secrets.token_urlsafe(48)}
            config_path.write_text(json.dumps(config, indent=2), encoding='utf-8')
        (STATE / 'login.txt').write_text(
            f'Username: {config["username"]}\nPassword: {config["password"]}\n', encoding='utf-8')
        environment = demo_environment(config, args.frontend)
        prepare_database(config, environment)
        run_backend(['manage.py', 'check'], environment)
        run_backend(['manage.py', 'collectstatic', '--noinput'], environment)
        binary = cloudflared_binary()
        if args.prepare_only:
            print('Demo database and cloudflared are ready; nothing has been exposed publicly.')
            return
        for port in (API_PORT, REDIS_PORT):
            if port_is_open(port):
                raise RuntimeError(f'Port {port} is occupied; no existing service will be replaced.')
        start('redis', ['wsl.exe', '-d', 'Ubuntu', '--exec', 'redis-server',
                        '--bind', '127.0.0.1', '--port', str(REDIS_PORT),
                        '--save', '', '--appendonly', 'no'])
        redis_started = True
        import redis
        cache = redis.Redis(host='127.0.0.1', port=REDIS_PORT, socket_timeout=2)
        for _ in range(60):
            check_processes()
            try:
                if cache.ping():
                    break
            except redis.RedisError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('Demo Redis did not become reachable through WSL localhost forwarding.')

        # Allocate the public hostname before allowing it in Django. Until the
        # API starts the tunnel can only return an origin-unavailable error.
        start('tunnel', [str(binary), '--no-autoupdate', 'tunnel', '--protocol', 'http2',
                         '--url', f'http://127.0.0.1:{API_PORT}'])
        tunnel_url = None
        for _ in range(90):
            check_processes()
            match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com',
                              (STATE / 'tunnel.log').read_text(encoding='utf-8', errors='replace'))
            if match:
                tunnel_url = match.group()
                break
            time.sleep(1)
        if not tunnel_url:
            raise RuntimeError('Cloudflare did not assign a URL; inspect .cloudflare-demo/tunnel.log.')
        environment = demo_environment(config, args.frontend, urlsplit(tunnel_url).hostname)
        start('api', [sys.executable, '-m', 'daphne', '-b', '127.0.0.1',
                      '-p', str(API_PORT), 'config.demo_asgi:application'], environment)
        for _ in range(60):
            check_processes()
            try:
                with urlopen(f'http://127.0.0.1:{API_PORT}/api/health/', timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('Demo API failed its local health check.')
        start('worker', [sys.executable, '-m', 'celery', '-A', 'config', 'worker',
                         '--pool=solo', '--concurrency=1', '--loglevel=info',
                         '--hostname=cloudflare-demo@%h'], environment)
        start('beat', [sys.executable, '-m', 'celery', '-A', 'config', 'beat',
                       '--loglevel=info', '--schedule', str(STATE / 'celerybeat-schedule')], environment)
        (STATE / 'vercel.env').write_text(f'VITE_API_BASE_URL={tunnel_url}\n', encoding='utf-8')
        ready_file.write_text(json.dumps({'url': tunnel_url, 'frontend': args.frontend,
                                         'launcher_pid': os.getpid()}, indent=2), encoding='utf-8')
        print(f'\nBackend URL: {tunnel_url}\nVercel variable: VITE_API_BASE_URL={tunnel_url}', flush=True)
        print(f'Login credentials: {STATE / "login.txt"}', flush=True)
        print(f'Allowed frontend: {args.frontend}', flush=True)
        print('Keep this launcher running. Stop with Ctrl+C or npm.cmd run demo:stop.', flush=True)
        while not (STATE / 'stop-requested').exists():
            check_processes()
            time.sleep(1)
    finally:
        # Close the tunnel first so cleanup never leaves an unmanaged public API.
        for label, process in sorted(processes, key=lambda item: item[0] != 'tunnel'):
            if label != 'redis' and process.poll() is None:
                if os.name == 'nt':
                    # Virtual-environment Python launchers can spawn another
                    # Python process. Stop this specific owned tree as a unit.
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=HIDDEN, timeout=10, check=False)
                else:
                    process.terminate()
        for label, process in processes:
            if label != 'redis':
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
        if redis_started:
            try:
                subprocess.run(['wsl.exe', '-d', 'Ubuntu', '--exec', 'redis-cli',
                                '-p', str(REDIS_PORT), 'shutdown', 'nosave'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=HIDDEN, timeout=5, check=False)
            except (OSError, subprocess.TimeoutExpired):
                pass
            for label, process in processes:
                if label == 'redis' and process.poll() is None:
                    process.terminate()
        ready_file.unlink(missing_ok=True)
        for log in logs:
            log.close()
        lock.close()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nDemo stopped.')
    except Exception as error:
        print(f'Demo setup failed: {error}', file=sys.stderr)
        sys.exit(1)
