"""Copy approved local officers/junctions/markers to Azure, add-only, plan first."""
import argparse
import json
from pathlib import Path
import subprocess
from urllib.parse import unquote, urlsplit

import environ
import psycopg
from psycopg.rows import dict_row

from receive_selected_records import FIELDS

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    environ.Env.read_env(ROOT / 'traffic_dss_backend/.env')
    source = urlsplit(environ.Env()('DATABASE_URL'))
    if source.hostname not in {'localhost', '127.0.0.1', '::1'}:
        parser.error('Expected the local PostgreSQL source.')
    tables = {'officers': 'core_officer', 'junctions': 'core_bottleneck', 'markers': 'core_poi'}
    with psycopg.connect(host=source.hostname, port=source.port or 5432,
                         user=unquote(source.username or ''), password=unquote(source.password or ''),
                         dbname=unquote(source.path.lstrip('/')), row_factory=dict_row,
                         connect_timeout=10, options='-c default_transaction_read_only=on') as db:
        payload = {group: db.execute('SELECT ' + ','.join(fields) + ' FROM ' + tables[group] +
                                    ' WHERE NOT is_deleted ORDER BY ' + fields[0]).fetchall()
                   for group, fields in FIELDS.items()}
    # No local passwords, account links, officer positions, or traffic readings leave this process.
    for row in payload['officers']:
        if row['status'] == 'deployed':
            row['status'] = 'available'
    markets = 0
    for row in payload['markers']:
        if row['category'] == 'market':
            row['category'] = 'other'
            markets += 1
    print('Market markers mapped to supported Other place category:', markets, flush=True)
    encoded = json.dumps(payload, allow_nan=False).encode('utf-8')
    options = ['-i', r'D:\CodingRelated\Codes.Ams\traffic-off-database_key.pem',
               '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', 'ConnectTimeout=15', '-o', 'UserKnownHostsFile=' +
               str(ROOT / '.cloudflare-demo/azure_known_hosts').replace('\\', '/')]
    target = 'azureuser@13.70.20.184'
    subprocess.run(['scp', *options, 'scripts/azure/receive_selected_records.py',
                    target + ':/home/azureuser/receive_selected_records.py'], cwd=ROOT, check=True)
    remote = 'sudo /opt/trafficaux/venv/bin/python -B /home/azureuser/receive_selected_records.py'
    if args.apply:
        remote += ' --apply'
    subprocess.run(['ssh', *options, target, remote], input=encoded, check=True)


if __name__ == '__main__':
    main()
