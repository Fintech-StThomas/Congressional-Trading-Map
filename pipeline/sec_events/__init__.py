"""SEC Form 8-K filing events for the companies members traded (docs/sec-events.md; data dictionary: "SEC 8-K events").

Modules: submissions (download and parse one company's EDGAR submissions file and the older pages it needs), run (the
stage: which companies, parallel fetch, failure handling, pipeline/build/sec_events.json), window (the 30-day rule the
assembler uses for OrgFile.sec_events; also used by the validator).
"""
