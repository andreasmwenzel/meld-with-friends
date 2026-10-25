#!/usr/bin/env bash
# Trigger a production deploy of main on Vercel by hand, via the API. Merges to main normally deploy
# through the Git integration; use this if one is missed. Needs VERCEL_TOKEN in ~/.config/meld/env.
set -euo pipefail
set -a; . ~/.config/meld/env; set +a
python3 -I - "$VERCEL_TOKEN" <<'EOF'
import json, sys, time, urllib.request
t = sys.argv[1]
def call(url, method="GET", body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {t}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r: return json.load(r)
    except urllib.error.HTTPError as e: return {"error": e.code, "body": e.read().decode()[:400]}
p = call("https://api.vercel.com/v9/projects/meld-with-friends")
repo_id = p["link"]["repoId"]
d = call("https://api.vercel.com/v13/deployments", "POST", {"name": "meld-with-friends", "project": "meld-with-friends", "target": "production",
    "gitSource": {"type": "github", "repoId": repo_id, "ref": "main"}})
if "error" in d: print(d); sys.exit(1)
print("deployment:", d.get("id"), d.get("url"))
for _ in range(60):
    time.sleep(10)
    s = call(f"https://api.vercel.com/v13/deployments/{d['id']}")
    st = s.get("readyState"); print(st, flush=True)
    if st in ("READY", "ERROR", "CANCELED"): sys.exit(0 if st == "READY" else 1)
EOF
