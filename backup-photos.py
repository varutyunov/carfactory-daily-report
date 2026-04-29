"""
Car Factory Photo Backup — Supabase → Google Drive
Backs up Deal and Form (deposit) photos, organized by customer name.

Folder structure:
  Car Factory Backups/
    Deals/
      Scott Vetter Kegley - 2012 Volkswagen Jetta (2026-04-04)/
        doc_1.jpeg
        doc_2.jpeg
    Forms/
      Samaira Cruz - 1998 Honda CR-V (2026-04-03)/
        id.jpg
        signed_form.jpg

Usage: python backup-photos.py
"""

import os, json, urllib.request, urllib.error, ssl, time, sys, re

SB_URL = 'https://hphlouzqlimainczuqyc.supabase.co'
SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo'
BUCKET = 'car-photos'
BACKUP_DIR = r'G:\My Drive\Car Factory Backups'

HEADERS = {
    'apikey': SB_KEY,
    'Authorization': f'Bearer {SB_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
}

ctx = ssl.create_default_context()

def api_get(endpoint):
    """GET from Supabase REST API."""
    url = f'{SB_URL}/rest/v1/{endpoint}'
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, context=ctx) as resp:
        return json.loads(resp.read().decode())

def storage_request(path, method='GET', body=None):
    """Request to Supabase Storage API."""
    url = f'{SB_URL}/storage/v1/{path}'
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f'  API error {e.code}: {e.read().decode()[:200]}')
        return None

def sign_url(storage_path):
    """Get a signed download URL."""
    result = storage_request(f'object/sign/{BUCKET}/{storage_path}',
                             method='POST', body={'expiresIn': 3600})
    if result and 'signedURL' in result:
        return f'{SB_URL}/storage/v1{result["signedURL"]}'
    return None

def download_file(storage_path, local_path):
    """Download a file from Supabase Storage to local path."""
    url = sign_url(storage_path)
    if not url:
        print(f'    ✗ Could not sign: {storage_path}')
        return False
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, context=ctx) as resp:
            with open(local_path, 'wb') as f:
                f.write(resp.read())
        return True
    except Exception as e:
        print(f'    ✗ Download failed: {e}')
        return False

def safe_name(name):
    """Make a string safe for use as a folder name."""
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    return name.strip()[:80]

def extract_path(url):
    """Extract storage path from a Supabase URL."""
    if not url:
        return None
    # Strip query params
    clean = url.split('?')[0]
    m = re.search(r'/car-photos/(.+)$', clean)
    return m.group(1) if m else None

def backup_deals():
    """Back up all deal photos organized by customer."""
    print('\n--- DEALS ---')
    deals_dir = os.path.join(BACKUP_DIR, 'Deals')
    os.makedirs(deals_dir, exist_ok=True)

    deals = api_get('deals?select=id,customer_name,vehicle_desc,photo_urls,created_at&order=created_at.desc')
    print(f'Found {len(deals)} deals')

    downloaded = 0
    skipped = 0
    for d in deals:
        name = d.get('customer_name', 'Unknown')
        vehicle = d.get('vehicle_desc', 'Unknown Vehicle')
        date = (d.get('created_at') or '')[:10]
        photos_raw = d.get('photo_urls')
        if not photos_raw:
            continue

        try:
            photos = json.parse(photos_raw) if isinstance(photos_raw, str) else photos_raw
        except:
            try:
                photos = json.loads(photos_raw)
            except:
                continue

        if not photos:
            continue

        folder_name = safe_name(f'{name} - {vehicle} ({date})')
        folder_path = os.path.join(deals_dir, folder_name)

        for i, url in enumerate(photos):
            storage_path = extract_path(url)
            if not storage_path:
                continue
            ext = storage_path.rsplit('.', 1)[-1] if '.' in storage_path else 'jpg'
            local_file = os.path.join(folder_path, f'doc_{i+1}.{ext}')
            if os.path.exists(local_file):
                skipped += 1
                continue
            print(f'  {folder_name}/doc_{i+1}.{ext}')
            if download_file(storage_path, local_file):
                downloaded += 1
            time.sleep(0.2)

    print(f'Deals: {downloaded} downloaded, {skipped} already backed up')
    return downloaded

def backup_forms():
    """Back up all deposit/form photos organized by customer."""
    print('\n--- FORMS ---')
    forms_dir = os.path.join(BACKUP_DIR, 'Forms')
    os.makedirs(forms_dir, exist_ok=True)

    deposits = api_get('deposits?select=id,customer_name,vehicle_desc,id_photo_url,signed_form_url,created_at&order=created_at.desc')
    print(f'Found {len(deposits)} forms')

    downloaded = 0
    skipped = 0
    for d in deposits:
        name = d.get('customer_name', 'Unknown')
        vehicle = d.get('vehicle_desc', 'Unknown Vehicle')
        date = (d.get('created_at') or '')[:10]

        folder_name = safe_name(f'{name} - {vehicle} ({date})')
        folder_path = os.path.join(forms_dir, folder_name)

        # ID photo
        id_url = d.get('id_photo_url')
        if id_url:
            storage_path = extract_path(id_url)
            if storage_path:
                ext = storage_path.rsplit('.', 1)[-1] if '.' in storage_path else 'jpg'
                local_file = os.path.join(folder_path, f'id_photo.{ext}')
                if os.path.exists(local_file):
                    skipped += 1
                else:
                    print(f'  {folder_name}/id_photo.{ext}')
                    if download_file(storage_path, local_file):
                        downloaded += 1
                    time.sleep(0.2)

        # Signed form photo
        sf_url = d.get('signed_form_url')
        if sf_url:
            storage_path = extract_path(sf_url)
            if storage_path:
                ext = storage_path.rsplit('.', 1)[-1] if '.' in storage_path else 'jpg'
                local_file = os.path.join(folder_path, f'signed_form.{ext}')
                if os.path.exists(local_file):
                    skipped += 1
                else:
                    print(f'  {folder_name}/signed_form.{ext}')
                    if download_file(storage_path, local_file):
                        downloaded += 1
                    time.sleep(0.2)

    print(f'Forms: {downloaded} downloaded, {skipped} already backed up')
    return downloaded

def main():
    print('=' * 50)
    print('Car Factory Photo Backup')
    print(f'Saving to: {BACKUP_DIR}')
    print('=' * 50)

    total = 0
    total += backup_deals()
    total += backup_forms()

    print(f'\n{"=" * 50}')
    if total:
        print(f'Done! {total} new files backed up to Google Drive.')
    else:
        print('Backup is up to date — nothing new to download.')
    print('=' * 50)

if __name__ == '__main__':
    main()
