# One-time setup: clasp-based Apps Script deploy

The `google-apps-script.js` file at the repo root is the source of truth. After
this is wired up, redeploys are a single command:

```bash
./scripts/deploy-apps-script.sh
```

The script copies `google-apps-script.js` → `apps-script/Code.gs`, runs
`clasp push --force`, then `clasp deploy --deploymentId <existing>` so the
live `script.google.com/macros/s/AKfyc…Xb-luQ/exec` URL serves the new code
without changing.

## What's already done

- `clasp` v3.3.0 installed globally (`npm install -g @google/clasp`).
- `apps-script/.clasp.json` and `apps-script/appsscript.json` scaffolded.
- `apps-script/.claspignore` set so only `Code.gs` + manifest get pushed.
- `scripts/deploy-apps-script.sh` written; uses the existing deployment ID
  (`AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ`)
  so the public URL is preserved.

## What you have to do once

### 1. Authorize clasp with the Google account that owns the script

```bash
clasp login
```

A browser window opens — sign in as the account that has Edit access to the
Apps Script project. After "Logged in" appears in the terminal, you're set.

### 2. Enable the Apps Script API for that account

Open https://script.google.com/home/usersettings and flip
**"Google Apps Script API"** to **On**. Without this, `clasp push` returns
`User has not enabled the Apps Script API`.

### 3. Paste the Script ID into `.clasp.json`

1. Open https://script.google.com → your Car Factory project.
2. Click the gear icon (⚙ Project Settings) in the left sidebar.
3. Copy the **Script ID** (long alphanumeric string, distinct from the
   deployment ID in the web app URL).
4. Open `apps-script/.clasp.json` and replace `REPLACE_WITH_SCRIPT_ID` with
   the script ID. Save.

### 4. Test it

```bash
./scripts/deploy-apps-script.sh
```

Expected output:

```
→ Copying google-apps-script.js → apps-script/Code.gs
→ clasp push (force, to overwrite remote)
└─ Code.gs
└─ appsscript.json
Pushed 2 files.
→ clasp deploy --deploymentId AKfyc…Xb-luQ (updates existing URL)
- AKfyc…Xb-luQ @HEAD
✓ Done. Live URL unchanged: https://script.google.com/macros/s/AKfyc…Xb-luQ/exec
```

After that, every code change to `google-apps-script.js` lands on the live
URL with one command.

## Flags

- `./scripts/deploy-apps-script.sh` — pushes + updates the existing
  deployment (preserves URL). **Use this 99% of the time.**
- `./scripts/deploy-apps-script.sh --new` — pushes + creates a NEW
  deployment URL. Only useful if you intentionally want a fresh URL (which
  would also require updating `_SHEETS_URL` in `index.html` and every
  Python script under `scripts/`).

## Troubleshooting

- **`User has not enabled the Apps Script API`** → step 2 above.
- **`Could not read API credentials`** → `clasp login` again (token expired
  after long inactivity).
- **`Invalid script ID`** → step 3 above; the value still has the
  placeholder, or you pasted the deployment ID by mistake. The script ID
  comes from Project Settings, not from the web app URL.
- **`Permission denied`** on the script → `clasp login` was run as the
  wrong account. Run `clasp logout` then `clasp login` again as the script
  owner.
