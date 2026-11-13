# Geo

- `us-states.json`: TopoJSON from the `us-atlas` npm package v3 (`states-10m.json`, https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json), unmodified. Objects: `states`, `nation`. Feature ids are state FIPS codes. Intended for d3-geo `geoAlbersUsa`.
- `state-meta.json`: postal code -> `{fips, name}` for 50 states, DC, PR, GU, VI, AS, MP.
- Source data: US Census Bureau cartographic boundary files, via us-atlas (https://github.com/topojson/us-atlas).
- Licence: us-atlas is ISC; underlying Census data is public domain.
- Retrieved: 2026-11-13.
- Note: the TopoJSON contains geometry for all 50 states, DC, and PR, GU, VI, AS, MP. `geoAlbersUsa` projects only the 50 states and DC (returns null for the territories), so delegates from PR/GU/VI/AS/MP need a separate placement.
