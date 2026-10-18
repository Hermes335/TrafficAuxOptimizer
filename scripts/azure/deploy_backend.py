"""Upload and provision the Azure evaluation backend without printing credentials."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".cloudflare-demo"
REMOTE = "/home/azureuser/traffic-azure-build"


def private_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as stream:
        stream.write(content)
    if os.name == "nt":
        subprocess.run(["icacls", str(path), "/inheritance:r", "/grant:r",
                        f"{getpass.getuser()}:(F)"], check=True, capture_output=True)
    else:
        path.chmod(0o600)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--key", required=True, type=Path)
    parser.add_argument("--hostname", required=True)
    parser.add_argument("--db-host", required=True)
    parser.add_argument("--db-password-file", type=Path, default=STATE / "azure-db-password.txt")
    parser.add_argument("--frontend", default="https://traffic-aux-optimizer.vercel.app")
    args = parser.parse_args()
    for value in (args.host, args.hostname, args.db_host):
        if not re.fullmatch(r"[a-zA-Z0-9.-]+", value):
            parser.error("Hostnames must contain only letters, numbers, dots, and hyphens.")
    password = args.db_password_file.read_text(encoding="utf-8-sig").rstrip("\r\n")
    if len(password) < 8:
        parser.error("Save the real database administrator password in the private password file.")
    key = args.key.resolve(strict=True)
    STATE.mkdir(parents=True, exist_ok=True)
    private_state = STATE / "azure-provision.json"
    if private_state.exists():
        config = json.loads(private_state.read_text(encoding="utf-8"))
    else:
        previous_demo = STATE / "credentials.json"
        demo_password = (json.loads(previous_demo.read_text(encoding="utf-8"))["password"]
                         if previous_demo.exists() else secrets.token_urlsafe(24))
        config = {name: secrets.token_urlsafe(48) for name in
                  ("secret_key", "jwt_secret_key", "database_app_password")}
        config["demo_password"] = demo_password
    config.update(hostname=args.hostname.lower(), frontend=args.frontend,
                  database_host=args.db_host.lower(), database_admin_password=password)
    # Read the provider key privately; never upload the local .env or database.
    provider_env = ROOT / "traffic_dss_backend" / ".env"
    for line in (provider_env.read_text(encoding="utf-8").splitlines() if provider_env.exists() else []):
        if line.startswith("TOMTOM_API_KEY="):
            config["tomtom_api_key"] = line.partition("=")[2].strip().strip("'\"")
            break
    private_write(private_state, json.dumps(config))
    private_write(STATE / "azure-login.txt",
                  "Username: demo_admin\nPassword: " + config["demo_password"] + "\n")

    tracked = subprocess.check_output(["git", "ls-files", "traffic_dss_backend"],
                                     cwd=ROOT, text=True, stderr=subprocess.DEVNULL).splitlines()
    source_files = [name for name in tracked if name.endswith(".py") or name in
                    ("traffic_dss_backend/requirements.txt", "traffic_dss_backend/pytest.ini")]
    archive = STATE / "azure-backend.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        for name in source_files:
            path = ROOT / name
            if path.is_symlink():
                raise RuntimeError("Refusing to package a source symlink.")
            bundle.add(path, arcname=str(Path(name).relative_to("traffic_dss_backend")), recursive=False)
    options = ["-i", str(key), "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
               "-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=yes",
               "-o", f"UserKnownHostsFile={STATE / 'azure_known_hosts'}"]
    target = f"azureuser@{args.host}"

    def ssh(command, **kwargs):
        subprocess.run(["ssh", "-T", *options, target, command], check=True, **kwargs)

    ssh(f"mkdir -p -m 700 {REMOTE}/source")
    for local_path, remote_name in ((archive, "source.tar.gz"),
                                    (Path(__file__).with_name("install_backend.py"), "install_backend.py")):
        subprocess.run(["scp", *options, str(local_path.relative_to(ROOT)),
                        f"{target}:{REMOTE}/{remote_name}"], check=True, cwd=ROOT)
    ssh(f"tar -xzf {REMOTE}/source.tar.gz -C {REMOTE}/source")
    # JSON travels over encrypted stdin, never through shell arguments or tool output.
    ssh(f"sudo python3 {REMOTE}/install_backend.py",
        input=json.dumps(config).encode("utf-8"))
    print("Backend provisioning completed; HTTPS and frontend cutover remain.")


if __name__ == "__main__":
    main()
