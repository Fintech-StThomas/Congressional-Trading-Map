# Portraits

- Source: https://github.com/unitedstates/images (450x550 JPGs via https://unitedstates.github.io/images/congress/450x550/), official Congressional Directory / Bioguide photographs from the U.S. Government Publishing Office.
- Licence: public domain (works of the U.S. federal government).
- Retrieved: 2026-11-13. Member list from https://unitedstates.github.io/congress-legislators/ (CC0), all members with a term ending on or after 2000-01-01.
- Processing: cover-crop (centre-top) to 300x366, WebP quality 78, metadata stripped, colours unchanged. Regenerate with `python scripts/assets/fetch_portraits.py`.
- `index.json` lists available ids (`have`) and current members without a photo (`missing_current`). Missing photos are left missing; no other sources are used.
