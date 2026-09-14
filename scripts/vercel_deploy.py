#!/usr/bin/env python3
"""Upload production files to the existing Vercel project (no-op build)."""
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get("VERCEL_TOKEN") or os.environ.get("VERCEL_ACCESS_TOKEN") or ""
PROJECT_ID = os.environ.get("VERCEL_PROJECT_ID") or "prj_fRIFCFi1sfhC5iELndsuekR3l3qm"
TEAM_ID = os.environ.get("VERCEL_TEAM_ID") or os.environ.get("VERCEL_ORG_ID") or "team_AIHT521u3r2h9DXR2QJkNQ8I"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TARGET = os.environ.get("VERCEL_DEPLOY_TARGET") or "production"

if not TOKEN:
    print("Missing VERCEL_TOKEN", file=sys.stderr)
    sys.exit(1)


def api(method, path, body=None, headers=None, raw=False):
    if "?" in path:
        url = f"https://api.vercel.com{path}&teamId={TEAM_ID}"
    else:
        url = f"https://api.vercel.com{path}?teamId={TEAM_ID}"
    h = {"Authorization": f"Bearer {TOKEN}"}
    if headers:
        h.update(headers)
    data = None
    if body is not None:
        if raw:
            data = body
        else:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw_body = e.read().decode()
        try:
            return e.code, json.loads(raw_body)
        except Exception:
            return e.code, {"raw": raw_body}


file_specs = []


def add(local_path, deploy_path):
    with open(local_path, "rb") as f:
        content = f.read()
    sha = hashlib.sha1(content).hexdigest()
    file_specs.append(
        {
            "path": deploy_path,
            "sha": sha,
            "size": len(content),
            "content": content,
        }
    )


def walk_add(local_root, deploy_root):
    for root, _dirs, files in os.walk(local_root):
        for fn in files:
            if fn.startswith("."):
                continue
            lp = os.path.join(root, fn)
            rel = os.path.relpath(lp, local_root).replace(os.sep, "/")
            add(lp, f"{deploy_root}/{rel}")


for name in (
    "index.html",
    "lumo-logo.png",
    "lumo-logo-192.png",
    "lumo-logo-email.png",
    "vercel.json",
    "package.json",
):
    add(os.path.join(ROOT, name), name)

walk_add(os.path.join(ROOT, "assets"), "assets")
walk_add(os.path.join(ROOT, "api"), "api")

print(f"Total files: {len(file_specs)}")

for fs in file_specs:
    status, resp = api(
        "POST",
        "/v2/files",
        body=fs["content"],
        raw=True,
        headers={
            "Content-Length": str(fs["size"]),
            "x-vercel-digest": fs["sha"],
        },
    )
    if status not in (200, 201):
        print("UPLOAD FAIL", fs["path"], status, resp)
        sys.exit(1)
    print("uploaded", fs["path"], fs["sha"][:10], status)

payload = {
    "name": "lumoedge",
    "project": PROJECT_ID,
    "target": TARGET,
    "files": [{"file": fs["path"], "sha": fs["sha"], "size": fs["size"]} for fs in file_specs],
    "projectSettings": {
        "framework": None,
        "buildCommand": "true",
        "installCommand": "true",
        "outputDirectory": ".",
    },
}
status, resp = api("POST", "/v13/deployments", body=payload)
print("DEPLOY STATUS", status)
print("id", resp.get("id"))
print("url", resp.get("url"))
print("readyState", resp.get("readyState") or resp.get("status"))
if status not in (200, 201):
    print(json.dumps(resp, indent=2)[:3000])
    sys.exit(1)
if resp.get("error"):
    print(json.dumps(resp, indent=2)[:3000])
    sys.exit(1)
