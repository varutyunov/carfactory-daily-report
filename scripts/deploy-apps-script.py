#!/usr/bin/env python3
"""
Deploy Google Apps Script from the command line.

Usage:
    python scripts/deploy-apps-script.py

Reads google-apps-script.js from this repo, pushes it to the Apps Script project,
creates a new version, and updates the web app deployment.
"""

import json
import os
import sys

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# ── Configuration ────────────────────────────────────────────────────────────
SCRIPT_ID = '1mq-YfIgJEZG8owRgC2s9oV-e3hIzfvlDN_-baJCakmIUQFKlywTkXYiT'
DEPLOYMENT_ID = 'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ'
WEB_APP_URL = f'https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec'

SCOPES = [
    'https://www.googleapis.com/auth/script.projects',
    'https://www.googleapis.com/auth/script.deployments',
]

# Paths (relative to repo root)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
CREDENTIALS_FILE = os.path.join(SCRIPT_DIR, '.google-credentials.json')
TOKEN_FILE = os.path.join(SCRIPT_DIR, '.google-token.json')
SOURCE_FILE = os.path.join(REPO_ROOT, 'google-apps-script.js')

# Apps Script manifest
MANIFEST = json.dumps({
    "timeZone": "America/New_York",
    "dependencies": {},
    "webapp": {
        "executeAs": "USER_DEPLOYING",
        "access": "ANYONE_ANONYMOUS"
    },
    "exceptionLogging": "STACKDRIVER",
    "runtimeVersion": "V8",
    "oauthScopes": [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/script.scriptapp",
        "https://www.googleapis.com/auth/script.external_request"
    ]
})


def get_credentials():
    """Get or refresh OAuth2 credentials."""
    creds = None

    # Load saved token if it exists
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    # If no valid credentials, run the OAuth flow
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print('Refreshing expired token...')
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_FILE):
                print(f'ERROR: Credentials file not found at {CREDENTIALS_FILE}')
                print('Download it from Google Cloud Console → APIs & Services → Credentials')
                sys.exit(1)

            print('Starting OAuth flow — a browser window will open...')
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)

        # Save the token for next time
        with open(TOKEN_FILE, 'w') as f:
            f.write(creds.to_json())
        print('Token saved.')

    return creds


def push_code(service):
    """Push the local google-apps-script.js to the Apps Script project."""
    if not os.path.exists(SOURCE_FILE):
        print(f'ERROR: Source file not found at {SOURCE_FILE}')
        sys.exit(1)

    with open(SOURCE_FILE, 'r', encoding='utf-8') as f:
        source_code = f.read()

    print(f'Read {len(source_code):,} chars from {os.path.basename(SOURCE_FILE)}')

    body = {
        'files': [
            {
                'name': 'Code',
                'type': 'SERVER_JS',
                'source': source_code
            },
            {
                'name': 'appsscript',
                'type': 'JSON',
                'source': MANIFEST
            }
        ]
    }

    response = service.projects().updateContent(
        scriptId=SCRIPT_ID, body=body
    ).execute()

    file_count = len(response.get('files', []))
    print(f'Pushed {file_count} files to Apps Script project.')
    return response


def create_version(service, description=None):
    """Create a new immutable version of the script."""
    body = {}
    if description:
        body['description'] = description

    response = service.projects().versions().create(
        scriptId=SCRIPT_ID, body=body
    ).execute()

    version_number = response.get('versionNumber')
    print(f'Created version {version_number}.')
    return version_number


def update_deployment(service, version_number, description=None):
    """Update the web app deployment to point to the new version."""
    body = {
        'deploymentConfig': {
            'scriptId': SCRIPT_ID,
            'versionNumber': version_number,
            'description': description or f'Version {version_number}'
        }
    }

    response = service.projects().deployments().update(
        scriptId=SCRIPT_ID,
        deploymentId=DEPLOYMENT_ID,
        body=body
    ).execute()

    print(f'Updated deployment to version {version_number}.')
    return response


def main():
    description = None
    if len(sys.argv) > 1:
        description = ' '.join(sys.argv[1:])

    print('='*60)
    print('  Apps Script Deploy')
    print('='*60)
    print()

    # Step 1: Authenticate
    print('[1/4] Authenticating...')
    creds = get_credentials()
    service = build('script', 'v1', credentials=creds)
    print('Authenticated.\n')

    # Step 2: Push code
    print('[2/4] Pushing code...')
    push_code(service)
    print()

    # Step 3: Create version
    print('[3/4] Creating version...')
    version = create_version(service, description)
    print()

    # Step 4: Update deployment
    print('[4/4] Updating deployment...')
    update_deployment(service, version, description)
    print()

    # Done
    print('='*60)
    print('  DEPLOY COMPLETE')
    print(f'  Version: {version}')
    print(f'  Web app: {WEB_APP_URL}')
    print('='*60)


if __name__ == '__main__':
    main()
