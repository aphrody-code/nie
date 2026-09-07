#!/usr/bin/env python3
"""Minimal OVH API client for the DNS zones this VPS depends on.

The `ovh` python module is not installed here, so the request is signed by hand:
`SHA1(secret + "+" + consumer + "+" + METHOD + "+" + url + "+" + body + "+" + timestamp)`.

Credentials are read from a file and never printed. Three accounts exist on this machine and
they see different zones — see docs/OVH.md. Default is the `aphrody.com` account.

    scripts/ops/ovh.py zones
    scripts/ops/ovh.py export aphrody.com
    scripts/ops/ovh.py records aphrody.com
    scripts/ops/ovh.py add aphrody.com CNAME foo aphrody.com. --ttl 300 --apply
    scripts/ops/ovh.py delete aphrody.com 5432864457 --apply

Writes are refused unless `--apply` is passed, and every write ends with a zone refresh.
"""

from __future__ import annotations

import argparse
import configparser
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://eu.api.ovh.com/1.0"

ACCOUNTS = {
    # name          file                                  zones it can see
    "aphrody": "/home/ubuntu/.bash_secrets",          # aphrody.com, rpbey.fr
    "rosegriffon": "/home/ubuntu/.ovh.conf",          # rosegriffon.fr
    "dbfr": "/home/ubuntu/.config/ovh/dbfr.conf",     # dragonballfr.com
}

_EXPORT = re.compile(r"^\s*export\s+(OVH_[A-Z_]+)=[\"']?([^\"'\s]+)", re.M)


def credentials(account: str) -> tuple[str, str, str]:
    path = Path(ACCOUNTS.get(account, account))
    text = path.read_text(encoding="utf-8", errors="replace")
    found = dict(_EXPORT.findall(text))
    if found:
        missing = {"OVH_APPLICATION_KEY", "OVH_APPLICATION_SECRET", "OVH_CONSUMER_KEY"} - found.keys()
        if missing:
            raise SystemExit(f"{path}: missing {sorted(missing)}")
        return (found["OVH_APPLICATION_KEY"], found["OVH_APPLICATION_SECRET"], found["OVH_CONSUMER_KEY"])
    parser = configparser.ConfigParser()
    parser.read(path)
    if "ovh-eu" not in parser:
        raise SystemExit(f"{path}: no [ovh-eu] section and no OVH_* exports")
    section = parser["ovh-eu"]

    def field(name: str) -> str | None:
        return section.get(name) or section.get("dns_ovh_" + name)

    key, secret, consumer = field("application_key"), field("application_secret"), field("consumer_key")
    if not (key and secret and consumer):
        raise SystemExit(f"{path}: incomplete [ovh-eu] section")
    return (key, secret, consumer)


def call(creds, method: str, path: str, body=None):
    url = BASE + path
    payload = "" if body is None else json.dumps(body)
    stamp = str(int(time.time()))
    raw = "+".join([creds[1], creds[2], method, url, payload, stamp])
    request = urllib.request.Request(
        url,
        data=payload.encode() if body is not None else None,
        method=method,
        headers={
            "X-Ovh-Application": creds[0],
            "X-Ovh-Consumer": creds[2],
            "X-Ovh-Timestamp": stamp,
            "X-Ovh-Signature": "$1$" + hashlib.sha1(raw.encode()).hexdigest(),
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{method} {path} -> HTTP {error.code}: {error.read().decode(errors='replace')[:300]}")
    if not data:
        return None
    try:
        return json.loads(data)
    except json.JSONDecodeError:
        return data.decode(errors="replace")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--account", default="aphrody", help="aphrody | rosegriffon | dbfr | path to a file")
    parser.add_argument("--apply", action="store_true", help="required for any write")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("zones")
    for name in ("export", "records", "zone", "refresh"):
        sub.add_parser(name).add_argument("zone")
    add = sub.add_parser("add")
    add.add_argument("zone")
    add.add_argument("type")
    add.add_argument("subdomain")
    add.add_argument("target")
    add.add_argument("--ttl", type=int, default=300)
    delete = sub.add_parser("delete")
    delete.add_argument("zone")
    delete.add_argument("record_id")
    args = parser.parse_args()
    creds = credentials(args.account)

    if args.command == "zones":
        print("\n".join(call(creds, "GET", "/domain/zone")))
    elif args.command == "zone":
        print(json.dumps(call(creds, "GET", f"/domain/zone/{args.zone}"), indent=1))
    elif args.command == "export":
        print(call(creds, "GET", f"/domain/zone/{args.zone}/export"))
    elif args.command == "records":
        rows = [call(creds, "GET", f"/domain/zone/{args.zone}/record/{i}")
                for i in call(creds, "GET", f"/domain/zone/{args.zone}/record")]
        for row in sorted(rows, key=lambda r: (r["fieldType"], r["subDomain"])):
            print(f"{row['id']}\t{row['fieldType']}\t{row['subDomain'] or '@'}\t{row['ttl']}\t{row['target']}")
    elif args.command in {"add", "delete", "refresh"}:
        if not args.apply:
            return print(f"refusing to {args.command} without --apply") or 1
        if args.command == "add":
            body = {"fieldType": args.type, "subDomain": args.subdomain, "target": args.target, "ttl": args.ttl}
            print(json.dumps(call(creds, "POST", f"/domain/zone/{args.zone}/record", body), indent=1))
        elif args.command == "delete":
            call(creds, "DELETE", f"/domain/zone/{args.zone}/record/{args.record_id}")
            print(f"deleted {args.record_id}")
        call(creds, "POST", f"/domain/zone/{args.zone}/refresh", body={})
        print("zone refreshed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
