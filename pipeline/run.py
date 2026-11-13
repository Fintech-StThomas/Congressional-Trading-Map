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


STAGES: dict[str, Callable[[], None]] = {
    "spine": spine.run,
    "trades": trades.run,
    "companies": companies.run,
    "fec": fec,
    "edges_trades": edges_trades.run,
    "edges_committees": edges_committees.run,
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
