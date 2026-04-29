# Prompt for Claude Code Desktop — Apps Script Auto-Deploy Setup

Paste this entire prompt into Claude Code on your desktop:

---

I need you to set up automated deployment of Google Apps Script from the command line so I never have to manually paste code in the Apps Script editor again.

## Goal
Create a Python script at `scripts/deploy-apps-script.py` that:
1. Reads `google-apps-script.js` from this repo
2. Pushes it to my Google Apps Script project
3. Creates a new versioned deployment of the web app
4. Prints the deployment URL when done

## My Apps Script Details
- **Google Sheet ID:** `1eUXKqWP_I_ysXZUDDhNLvWgPxOcqd_bsFKrD3p9chVE`
- The script is **container-bound** to this Google Sheet (not standalone)
- It's deployed as a **web app** (Execute as: Me, Access: Anyone)
- Current web app URL ends with: `AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec`

## Steps to complete

### Step 1: Find or create the Google Cloud project
- Open `https://console.cloud.google.com` in the browser
- Check if there's already a project associated with this Google Sheet/Apps Script
- If not, create one called "Car Factory"

### Step 2: Enable the Apps Script API
- In the Google Cloud project, go to APIs & Services → Library
- Search for "Apps Script API" and enable it
- Also enable "Google Drive API" if not already enabled

### Step 3: Create OAuth2 Desktop credentials
- Go to APIs & Services → Credentials
- Create OAuth 2.0 Client ID (Application type: Desktop app, name: "Car Factory CLI")
- Download the credentials JSON file
- Save it as `scripts/.google-credentials.json` (add to .gitignore)

### Step 4: Get the Apps Script project ID
- Open the Google Sheet → Extensions → Apps Script
- In the Apps Script editor, go to Project Settings (gear icon)
- Copy the Script ID — this is needed for the API calls
- Save it somewhere in the deploy script

### Step 5: Write the deploy script
The script should:
1. Load credentials from `scripts/.google-credentials.json`
2. Check for saved token in `scripts/.google-token.json` — if missing, run OAuth flow (open browser, get auth code)
3. Use the token to call the Apps Script API:
   - `PUT https://script.googleapis.com/v1/projects/{scriptId}/content` — push the code
   - `POST https://script.googleapis.com/v1/projects/{scriptId}/versions` — create a version
   - `PUT https://script.googleapis.com/v1/projects/{scriptId}/deployments/{deploymentId}` — update the web app deployment to the new version
4. Print success message with the web app URL

OAuth scopes needed:
- `https://www.googleapis.com/auth/script.projects`
- `https://www.googleapis.com/auth/script.deployments`

The script content to push is in `google-apps-script.js` — wrap it as:
```json
{
  "files": [
    {
      "name": "Code",
      "type": "SERVER_JS",
      "source": "<contents of google-apps-script.js>"
    },
    {
      "name": "appsscript",
      "type": "JSON",
      "source": "{\"timeZone\":\"America/New_York\",\"dependencies\":{},\"webapp\":{\"executeAs\":\"USER_DEPLOYING\",\"access\":\"ANYONE_ANONYMOUS\"},\"exceptionLogging\":\"STACKDRIVER\",\"runtimeVersion\":\"V8\"}"
    }
  ]
}
```

### Step 6: Add to .gitignore
Add these lines to .gitignore:
```
scripts/.google-credentials.json
scripts/.google-token.json
```

### Step 7: Test it
Run `python scripts/deploy-apps-script.py` and verify:
- It opens a browser for first-time auth
- It pushes the code successfully
- It creates a new deployment
- The web app URL still works (test with: `curl https://script.google.com/macros/s/.../exec`)

### Step 8: Run the first deploy
After the script works, deploy the current `google-apps-script.js` which has:
- Car color coding for column B
- Error logging on all Supabase helpers
- Reconciler logging for inserts/updates/deletes

---

After this is set up, the remote Claude (Claude Code CLI) will be able to run `python scripts/deploy-apps-script.py` to deploy Apps Script changes without any browser interaction.
