"""Pipeline entry point: python -m pipeline.run [--stage NAME ...]."""
from __future__ import annotations

import argparse
import time
from typing import Callable

from . import assemble, companies, edges_committees, edges_trades, spine, trades, validate


def fec() -> None:
    """The FEC module (pipeline/fec/, maintained separately) writes its plug-in files into pipeline/build."""
    from .fec import run as fec_run
    if fec_run.main([]) != 0:
        raise SystemExit("fec stage failed")


def lda() -> None:
    """The LDA module (pipeline/lda/) writes lobbyist_money and revolving_door plug-in files. It downloads only when
    LDA_API_KEY is set, falls back to cached pages on an outage, and is skipped when there is neither."""
    import os
    from .lda import download as lda_dl, run as lda_run
    if not os.environ.get("LDA_API_KEY") and not lda_dl.windows():
        print("  lda: skipped (no LDA_API_KEY and no cached pages in pipeline/.cache/lda)")
        return
    try:
        # with a key: fetch what is missing plus a new posting window, for at most 45 minutes (resumes next run)
        lda_run.main(["--download", "--new-window", "--max-minutes", "45"] if os.environ.get("LDA_API_KEY") else [])
    except Exception as e:  # noqa: BLE001 - lobbying data is optional; never fail the whole pipeline
        print(f"  lda: failed ({type(e).__name__}: {e}); previous plug-in files left in place")


STAGES: dict[str, Callable[[], None]] = {
    "spine": spine.run,
    "trades": trades.run,
    "companies": companies.run,
    "fec": fec,
    "edges_trades": edges_trades.run,
    "edges_committees": edges_committees.run,
    "lda": lda,
    "assemble": assemble.run,
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
        print(f"=== {name} done in {time.monotonic() - t0:.1f}s ===", flush=True)


if __name__ == "__main__":
    main()
