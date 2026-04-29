# Add location column to deals26 — Paste into Desktop Claude

Run this SQL in the Supabase dashboard for the Car Factory project (project ref: hphlouzqlimainczuqyc):

1. Open https://supabase.com/dashboard in the browser
2. Select the Car Factory project
3. Go to SQL Editor
4. Paste and run this:

```sql
ALTER TABLE deals26 ADD COLUMN IF NOT EXISTS location text DEFAULT 'DeBary';
UPDATE deals26 SET location = 'DeBary' WHERE location IS NULL;
```

5. Verify it worked by running:

```sql
SELECT id, car_desc, location FROM deals26 ORDER BY sort_order DESC LIMIT 5;
```

All rows should show `location = 'DeBary'`.

That's it — just the SQL, nothing else.
