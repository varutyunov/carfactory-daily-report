#!/usr/bin/env python3
"""
Daily Google Drive backup of the Car Factory project.

What it does
------------
Mirrors the project root (C:\\Users\\Vlad\\Desktop\\carfactory) into the Drive
folder "Car Factory App Backup". On every run it:
  - Walks the local tree, skipping junk + sensitive files.
  - Creates any missing subfolders in Drive.
  - For each file: if it already exists in Drive AND the Drive copy's
    modifiedTime is newer than the local mtime, it's skipped. Otherwise the
    Drive copy is replaced with the latest local version.
  - Prints a one-line summary at the end.

Excluded from backup (handled elsewhere):
  - .git/, node_modules/, .claude/        → reproducible / restored from GitHub
  - logs5*, logs6*, logs7*, *.zip, temp_form.png → noise
  - supabase_keys.txt, OneSignal.txt, "GitHub key 3.20.26.txt",
    scripts/.google-credentials.json, scripts/.google-token.json,
    apps-script/.clasprc.json → secrets, belong in a password manager

Auth
----
Reuses scripts/.google-credentials.json + scripts/.google-token.json (the
same ones deploy-apps-script.py uses). First run will prompt for OAuth
consent in a browser; subsequent runs are headless.

Schedule
--------
Run nightly at 8 PM. On Windows, see scripts/backup-to-drive.cmd which
Task Scheduler invokes.

Usage:
    python scripts/backup-to-drive.py
    python scripts/backup-to-drive.py --dry-run   # show plan, upload nothing
    python scripts/backup-to-drive.py --root /path/to/carfactory
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload
except ImportError:
    sys.stderr.write(
        "Missing Google API libraries. Install with:\n"
        "  pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib\n"
    )
    sys.exit(1)

# ── Configuration ────────────────────────────────────────────────────────────

DRIVE_BACKUP_FOLDER_NAME = "Car Factory App Backup"
SCOPES = ["https://www.googleapis.com/auth/drive"]

# Excluded paths (anywhere in the tree). Match against any path component.
EXCLUDED_DIR_NAMES = {
    ".git", "node_modules", ".claude",
    "logs5", "logs6", "logs7",
    "Inventory",          # raw dealer-side files (gitignored)
    ".trash", ".vscode",
}
# Excluded by suffix
EXCLUDED_SUFFIXES = {".zip"}
# Excluded exact filenames (anywhere in tree). Sensitive credentials.
EXCLUDED_FILES = {
    "supabase_keys.txt",
    "OneSignal.txt",
    "GitHub key 3.20.26.txt",
    "last_update_id.txt",
    ".google-credentials.json",
    ".google-token.json",
    ".clasprc.json",
    "temp_form.png",
}
# Hidden files at any depth — skip dotfiles like .DS_Store, .clasprc.json, etc.
SKIP_HIDDEN = True


# ── Auth ─────────────────────────────────────────────────────────────────────

def get_drive_service(repo_root: Path):
    creds_path = repo_root / "scripts" / ".google-credentials.json"
    token_path = repo_root / "scripts" / ".google-token.json"
    if not creds_path.exists():
        sys.exit(
            f"google-credentials.json not found at {creds_path}\n"
            "Download from Google Cloud Console (OAuth client ID, type=Desktop)\n"
            "and save as scripts/.google-credentials.json."
        )

    creds = None
    if token_path.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
        except Exception:
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception:
                creds = None
        if not creds:
            flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), SCOPES)
            creds = flow.run_local_server(port=0)
        with token_path.open("w", encoding="utf-8") as f:
            f.write(creds.to_json())

    return build("drive", "v3", credentials=creds, cache_discovery=False)


# ── Drive helpers ────────────────────────────────────────────────────────────

def find_or_create_folder(svc, name, parent_id=None):
    safe_name = name.replace("'", "\\'")
    q = (
        f"name = '{safe_name}' "
        f"and mimeType = 'application/vnd.google-apps.folder' "
        f"and trashed = false"
    )
    if parent_id:
        q += f" and '{parent_id}' in parents"
    res = svc.files().list(q=q, fields="files(id, name)", pageSize=10).execute()
    files = res.get("files", [])
    if files:
        return files[0]["id"]
    body = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    if parent_id:
        body["parents"] = [parent_id]
    return svc.files().create(body=body, fields="id").execute()["id"]


def find_file_in_folder(svc, name, parent_id):
    safe_name = name.replace("'", "\\'")
    q = (
        f"name = '{safe_name}' "
        f"and mimeType != 'application/vnd.google-apps.folder' "
        f"and trashed = false "
        f"and '{parent_id}' in parents"
    )
    res = svc.files().list(
        q=q, fields="files(id, name, modifiedTime, size)", pageSize=10
    ).execute()
    files = res.get("files", [])
    return files[0] if files else None


def upload_or_update(svc, local_path: Path, parent_id, existing=None, dry_run=False):
    """Upload local_path to Drive under parent_id. If existing is given, update it."""
    media = None if dry_run else MediaFileUpload(
        str(local_path), resumable=local_path.stat().st_size > 5 * 1024 * 1024
    )
    if existing:
        if dry_run:
            return ("update", existing["id"])
        meta = {}  # name and parents stay the same
        f = svc.files().update(
            fileId=existing["id"],
            body=meta,
            media_body=media,
            fields="id",
        ).execute()
        return ("update", f["id"])
    body = {"name": local_path.name, "parents": [parent_id]}
    if dry_run:
        return ("create", None)
    f = svc.files().create(body=body, media_body=media, fields="id").execute()
    return ("create", f["id"])


# ── Local tree walking ───────────────────────────────────────────────────────

def is_excluded(rel_path: Path) -> bool:
    parts = rel_path.parts
    for p in parts[:-1]:  # all directory components
        if p in EXCLUDED_DIR_NAMES:
            return True
        if SKIP_HIDDEN and p.startswith("."):
            return True
    name = parts[-1]
    if name in EXCLUDED_FILES:
        return True
    if SKIP_HIDDEN and name.startswith("."):
        return True
    if rel_path.suffix.lower() in EXCLUDED_SUFFIXES:
        return True
    return False


def walk_local(root: Path):
    """Yield relative file paths under root, skipping excluded entries."""
    for dirpath, dirnames, filenames in os.walk(root):
        d = Path(dirpath)
        rel_dir = d.relative_to(root) if d != root else Path(".")
        # In-place prune of dirnames so os.walk doesn't descend into them
        pruned = []
        for sub in dirnames:
            if sub in EXCLUDED_DIR_NAMES:
                continue
            if SKIP_HIDDEN and sub.startswith("."):
                continue
            pruned.append(sub)
        dirnames[:] = pruned
        for fn in filenames:
            rel = (rel_dir / fn) if str(rel_dir) != "." else Path(fn)
            if is_excluded(rel):
                continue
            yield rel


# ── Main sync ────────────────────────────────────────────────────────────────

def sync(repo_root: Path, dry_run: bool = False):
    svc = get_drive_service(repo_root)

    backup_root_id = find_or_create_folder(svc, DRIVE_BACKUP_FOLDER_NAME)
    print(f"Backup folder: https://drive.google.com/drive/folders/{backup_root_id}")

    # Cache: rel_dir -> drive_folder_id
    folder_cache = {Path("."): backup_root_id}

    def ensure_folder(rel_dir: Path) -> str:
        if rel_dir in folder_cache:
            return folder_cache[rel_dir]
        parent_rel = rel_dir.parent if rel_dir.parent != rel_dir else Path(".")
        parent_id = ensure_folder(parent_rel)
        fid = find_or_create_folder(svc, rel_dir.name, parent_id)
        folder_cache[rel_dir] = fid
        return fid

    files = sorted(walk_local(repo_root))
    print(f"Local files (after filters): {len(files)}")

    counts = {"created": 0, "updated": 0, "skipped": 0, "failed": 0}
    for rel in files:
        local = repo_root / rel
        rel_dir = rel.parent if str(rel.parent) != "." else Path(".")
        try:
            parent_id = ensure_folder(rel_dir)
            existing = find_file_in_folder(svc, local.name, parent_id)
            if existing and existing.get("modifiedTime"):
                drive_mtime = datetime.fromisoformat(
                    existing["modifiedTime"].replace("Z", "+00:00")
                )
                local_mtime = datetime.fromtimestamp(local.stat().st_mtime, tz=timezone.utc)
                # Skip if Drive copy is newer or equal (we backed it up already)
                if drive_mtime >= local_mtime:
                    counts["skipped"] += 1
                    continue
            action, _ = upload_or_update(svc, local, parent_id, existing, dry_run=dry_run)
            counts["created" if action == "create" else "updated"] += 1
            if (counts["created"] + counts["updated"]) % 25 == 0:
                print(
                    f"  ...progress: created={counts['created']} "
                    f"updated={counts['updated']} skipped={counts['skipped']}"
                )
        except HttpError as e:
            print(f"  HTTP error on {rel}: {e}", file=sys.stderr)
            counts["failed"] += 1
        except Exception as e:
            print(f"  error on {rel}: {e}", file=sys.stderr)
            counts["failed"] += 1

    print(
        "\nBackup summary: "
        f"created={counts['created']} updated={counts['updated']} "
        f"skipped={counts['skipped']} failed={counts['failed']}"
    )
    print(f"View at: https://drive.google.com/drive/folders/{backup_root_id}")
    return counts


def main():
    ap = argparse.ArgumentParser(description="Mirror project to Google Drive backup folder.")
    ap.add_argument(
        "--root",
        default=str(Path(__file__).resolve().parent.parent),
        help="Project root (default: parent of this script).",
    )
    ap.add_argument("--dry-run", action="store_true", help="Plan only, no uploads.")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        sys.exit(f"Project root does not exist: {root}")

    started = time.time()
    counts = sync(root, dry_run=args.dry_run)
    print(f"Elapsed: {time.time() - started:.1f}s")
    sys.exit(0 if counts["failed"] == 0 else 1)


if __name__ == "__main__":
    main()
