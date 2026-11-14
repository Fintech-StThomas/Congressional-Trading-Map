"""Pipeline entry point: python -m pipeline.run [--stage NAME ...]. The stage table is in pipeline/README.md."""
from __future__ import annotations

import argparse
import resource
import time
from typing import Callable

from . import assemble, companies, edges_committees, edges_trades, spine, trades, validate
from .holdings import run as holdings
from .util import EDGES_DIR, ORGS_DIR, OUT, SOURCES_DIR, read_json, write_json


def fec() -> None:
    """The FEC module (pipeline/fec/, maintained separately) writes its plug-in files into pipeline/build."""
    from .fec import run as fec_run
    if fec_run.main([]) != 0:
        raise SystemExit("fec stage failed")


def lda() -> None:
    """The LDA module (pipeline/lda/) writes lobbyist_money and revolving_door plug-in files. It downloads only when
    LDA_API_KEY is set, falls back to cached pages on an outage, and is skipped when there is neither."""
    import os
    if os.environ.get("PT_ENABLE_LDA") != "1":
        # Off by default: lobbying ties are not published until their attribution has been reviewed and the
        # assembler has been run and validated with them. Set PT_ENABLE_LDA=1 to turn the stage on.
        # The assembler merges every plug-in file it finds, so "off" must also mean no lobbying files left over.
        for stale in (EDGES_DIR / "lda.jsonl", ORGS_DIR / "lda.jsonl", SOURCES_DIR / "lda.json"):
            if stale.exists():
                stale.unlink()
                print(f"  lda: removed {stale.name} left by an earlier enabled run")
        print("  lda: skipped (set PT_ENABLE_LDA=1 to enable)")
        return
    from .lda import download as lda_dl, run as lda_run
    if not os.environ.get("LDA_API_KEY") and not lda_dl.windows():
        print("  lda: skipped (no LDA_API_KEY and no cached pages in pipeline/.cache/lda)")
        return
    try:
        # with a key: fetch what is missing plus a new posting window, for at most 45 minutes (resumes next run)
        lda_run.main(["--download", "--new-window", "--max-minutes", "45"] if os.environ.get("LDA_API_KEY") else [])
    except Exception as e:  # noqa: BLE001 - lobbying data is optional; never fail the whole pipeline
        print(f"  lda: failed ({type(e).__name__}: {e}); previous plug-in files left in place")


def holdings_publish() -> None:
    """Rerun the holdings stage once the new tree is in place. Why: its overlaps compare each holding with the
    member's *published* file (contract), and before assemble that file is the previous build's. The plug-in files
    it rewrites are identical to the first pass, so assemble need not run again; meta.json's holdings report is
    updated to this pass."""
    holdings.run()
    meta = read_json(OUT / "meta.json")
    meta["reports"]["holdings"] = read_json(SOURCES_DIR / "holdings.json")["report"]
    write_json(OUT / "meta.json", meta)


STAGES: dict[str, Callable[[], None]] = {
    "spine": spine.run,
    "trades": trades.run,
    "companies": companies.run,
    "fec": fec,
    "edges_trades": edges_trades.run,
    "edges_committees": edges_committees.run,
    "lda": lda,
    "holdings": holdings.run,  # before assemble, so its `owns` edges are merged in the same run
    "assemble": assemble.run,  # carries the holdings files over when it swaps web/public/data
    "holdings_publish": holdings_publish,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", action="append", choices=[*STAGES, "validate"],
                        help="run only these stages (repeatable); default: all stages in order, then validate")
    args = parser.parse_args()
    chosen = args.stage or [*STAGES, "validate"]
    for name in [*STAGES, "validate"]:
        if name not in chosen:
            continue
        t0 = time.monotonic()
        print(f"\n=== {name} ===", flush=True)
        if name == "validate":
            if validate.main() != 0:
                raise SystemExit(1)
        else:
            STAGES[name]()
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20  # KiB on Linux -> GiB
        print(f"=== {name} done in {time.monotonic() - t0:.1f}s (peak RSS so far {peak:.2f} GiB) ===", flush=True)


if __name__ == "__main__":
    main()
