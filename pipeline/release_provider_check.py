"""Check that the object store honours the conditional-write and header semantics the release archive relies on.

    python -m pipeline.release_provider_check

Uses the publishers' R2_* variables. Writes only under `release-provider-check/<random run id>/` and deletes
exactly the keys it created. Exit 0 when every check passes, 1 when any fails, 2 when configuration is missing.
"""
from __future__ import annotations

import secrets
import sys
from typing import Any, Callable

from .publish_r2 import MissingConfig, _code, client_from_env
from .release_store import IMMUTABLE_CACHE, POINTER_CACHE, precondition_failed, status

ROOT = "release-provider-check/"
CTYPE = "application/json"


class _Run:
    def __init__(self, client: Any, bucket: str, run_id: str):
        self.client, self.bucket, self.prefix = client, bucket, f"{ROOT}{run_id}/"
        self.created: list[str] = []
        self.results: list[tuple[str, bool, str]] = []

    def put(self, name: str, body: bytes, cache: str = IMMUTABLE_CACHE, **condition: str) -> None:
        key = self.prefix + name
        if key not in self.created:
            self.created.append(key)
        self.client.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType=CTYPE,
                               CacheControl=cache, **condition)

    def read(self, name: str) -> tuple[bytes, dict]:
        response = self.client.get_object(Bucket=self.bucket, Key=self.prefix + name)
        return response["Body"].read(), response

    def record(self, name: str, check: Callable[[], str]) -> None:
        try:
            self.results.append((name, True, check()))
        except AssertionError as exc:
            self.results.append((name, False, str(exc)))
        except Exception as exc:  # noqa: BLE001 - only a short secret-free code is ever reported
            self.results.append((name, False, _code(exc)))

    def rejects(self, name: str, body: bytes, cache: str = IMMUTABLE_CACHE, **condition: str) -> None:
        try:
            self.put(name, body, cache, **condition)
        except Exception as exc:  # noqa: BLE001
            assert precondition_failed(exc), f"rejected with {_code(exc)}, not 412/PreconditionFailed"
            return
        raise AssertionError("write was accepted although its condition should have failed")


def run_checks(client: Any, bucket: str, run_id: str | None = None) -> tuple[list[tuple[str, bool, str]], bool]:
    """Return ([(check, passed, detail)], cleanup_ok). Deletes exactly the keys it attempted to create."""
    run = _Run(client, bucket, run_id or secrets.token_hex(8))
    first, second = b'{"v":1}', b'{"v":2}'

    def create_once():
        run.put("create.json", first, IfNoneMatch="*")
        return "If-None-Match: * created a new key"

    def create_twice():
        run.rejects("create.json", second, IfNoneMatch="*")
        body, _ = run.read("create.json")
        assert body == first, "existing key was overwritten"
        return "second create rejected with 412; original bytes intact"

    def headers():
        body, response = run.read("create.json")
        assert response.get("ContentType") == CTYPE, "Content-Type did not round-trip"
        assert response.get("CacheControl") == IMMUTABLE_CACHE, "Cache-Control did not round-trip"
        assert response.get("ContentEncoding") in (None, ""), "unexpected Content-Encoding"
        return "Content-Type and Cache-Control read back exactly"

    def body_readback():
        body, response = run.read("create.json")
        assert body == first and response.get("ContentLength") == len(first), "body or length mismatch"
        return "body and length read back exactly"

    def head_metadata():
        head = client.head_object(Bucket=bucket, Key=run.prefix + "create.json")
        assert head.get("ContentLength") == len(first), "HEAD did not report the exact size"
        assert head.get("ContentType") == CTYPE and head.get("CacheControl") == IMMUTABLE_CACHE, "HEAD headers differ"
        return "HEAD reports exact size, Content-Type and Cache-Control (used for blob reuse checks)"

    def listing_sizes():
        page = client.list_objects_v2(Bucket=bucket, Prefix=run.prefix)
        sizes = {item["Key"]: item["Size"] for item in page.get("Contents", [])}
        assert sizes.get(run.prefix + "create.json") == len(first), "listing did not report the exact size"
        return "prefix listing reports object sizes (used for --measure and withdrawal)"

    def delete_idempotent():
        run.put("gone.json", first, IfNoneMatch="*")
        client.delete_object(Bucket=bucket, Key=run.prefix + "gone.json")
        client.delete_object(Bucket=bucket, Key=run.prefix + "gone.json")
        try:
            client.head_object(Bucket=bucket, Key=run.prefix + "gone.json")
        except Exception as exc:  # noqa: BLE001
            assert status(exc, (404,), ("404", "NoSuchKey", "NotFound")), f"HEAD failed with {_code(exc)}, not 404"
            return "deleting a missing key succeeds; HEAD then reports 404"
        raise AssertionError("object still exists after delete")

    state: dict[str, str] = {}

    def match_current():
        run.put("pointer.json", first, POINTER_CACHE, IfNoneMatch="*")
        state["etag"] = run.read("pointer.json")[1]["ETag"]
        run.put("pointer.json", second, POINTER_CACHE, IfMatch=state["etag"])
        body, response = run.read("pointer.json")
        assert body == second and response["CacheControl"] == POINTER_CACHE, "If-Match write with current ETag not applied"
        assert response["ETag"] != state["etag"], "ETag did not change after a write"
        return "If-Match with the current ETag succeeded"

    def match_stale():
        assert "etag" in state, "needs the previous check to have set up the key"
        run.rejects("pointer.json", b'{"v":3}', POINTER_CACHE, IfMatch=state["etag"])
        assert run.read("pointer.json")[0] == second, "stale If-Match overwrote the object"
        return "If-Match with a stale ETag rejected with 412; bytes intact"

    try:
        for name, fn in (("create-once (If-None-Match)", create_once), ("second-create-rejected", create_twice),
                         ("headers-round-trip", headers), ("body-read-back", body_readback),
                         ("head-metadata", head_metadata), ("listing-sizes", listing_sizes),
                         ("delete-idempotent", delete_idempotent),
                         ("if-match-current-succeeds", match_current), ("if-match-stale-rejected", match_stale)):
            run.record(name, fn)
    finally:
        failed = 0
        for key in run.created:
            assert key.startswith(run.prefix)
            try:
                client.delete_object(Bucket=bucket, Key=key)
            except Exception:  # noqa: BLE001
                failed += 1
    return run.results, failed == 0


def main(argv: list[str] | None = None) -> int:
    if argv:
        print("release provider check takes no arguments", file=sys.stderr)
        return 2
    try:
        client, bucket = client_from_env(require=True)
        results, cleaned = run_checks(client, bucket)
    except MissingConfig as exc:
        print(f"provider check FAILED: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 - never print SDK messages (they can carry the endpoint)
        print(f"provider check FAILED: {_code(exc)}", file=sys.stderr)
        return 1
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")
    print(f"{'PASS' if cleaned else 'FAIL'}  cleanup: " + ("all test keys deleted" if cleaned else
                                                          f"some keys under {ROOT} could not be deleted"))
    ok = cleaned and all(passed for _, passed, _ in results)
    print("provider check " + ("PASSED" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
