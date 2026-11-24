"""Test doubles for the OpenFEC modules: a fake requests session that serves recorded or generated pages and records
every call, so no test touches the network. Used by test_fec_api.py and test_fec_purposes.py."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

FIX = Path(__file__).parent / "fixtures" / "fec_api"


def fixture(name: str) -> dict:
    return json.loads((FIX / name).read_text())


class Resp:
    def __init__(self, status: int = 200, body: Any = None, headers: dict | None = None, text: str | None = None) -> None:
        self.status_code, self.headers, self._body, self._text = status, headers or {}, body, text

    def json(self) -> Any:
        if self._text is not None:
            return json.loads(self._text)
        return self._body


class Session:
    """`route(path, params)` returns a Resp (or raises) for each call; every call is kept in `calls`."""

    def __init__(self, route: Callable[[str, dict], Resp]) -> None:
        self.route, self.calls = route, []

    def get(self, url: str, params: dict | None = None, **kw: Any) -> Resp:
        path = url.split("/v1", 1)[1]
        self.calls.append((path, dict(params or {})))
        return self.route(path, dict(params or {}))


def ok(results: list[dict], page: int = 1, pages: int = 1, count: int | None = None) -> Resp:
    return Resp(200, {"pagination": {"count": len(results) if count is None else count, "page": page, "pages": pages,
                                     "per_page": 100}, "results": results})


def paged(rows: list[dict], params: dict) -> Resp:
    """Serve `rows` 100 to a page the way OpenFEC does."""
    p = int(params.get("page", 1))
    pages = max(1, -(-len(rows) // 100))
    return ok(rows[(p - 1) * 100:p * 100], p, pages, len(rows))


def purposes_route(data: dict[int, dict[str, list[tuple[str, float, int]]]]) -> Callable[[str, dict], Resp]:
    """{cycle: {committee: [(purpose, total, count)]}} -> a by_purpose server honouring committee_id and cycle."""
    def route(path: str, params: dict) -> Resp:
        assert path == "/schedules/schedule_b/by_purpose/", path
        ids = params["committee_id"]
        rows = [{"committee_id": c, "cycle": params["cycle"], "purpose": p, "total": t, "count": n,
                 "memo_count": 0, "memo_total": "0.00"}
                for c in sorted(ids) for p, t, n in data.get(params["cycle"], {}).get(c, [])]
        return paged(rows, params)
    return route
