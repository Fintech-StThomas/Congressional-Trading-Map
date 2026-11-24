"""Release index repair: list the previously current release when an earlier run's index write failed."""
from __future__ import annotations

from typing import Any, Callable

from .release_blobs import blob_key, verify_body
from .release_history import build_time_of, record_activation, validate_index
from .release_manifest import decode_json, validate_pointer
from .release_refs import load_descriptor
from .release_store import IMMUTABLE_CACHE, INDEX, get_object, is_withdrawn


def index_previous(client: Any, bucket: str, previous: tuple[bytes, str] | None, sleep: Callable, now: Callable) -> None:
    """The release that was current until now must be listed too: its index write may have failed on its own day and
    the site only serves listed releases. Best effort (a withdrawn or unreadable one is skipped); costs one GET of
    the index and, only when the entry is missing, one descriptor read and one meta.json read."""
    if previous is None:
        return
    try:
        old = validate_pointer(decode_json(previous[0]))["release_id"]
        got = get_object(client, bucket, INDEX, sleep)
        if got is not None and any(e["release_id"] == old for e in validate_index(decode_json(got[0]))["releases"]):
            return
        if is_withdrawn(client, bucket, old, sleep):  # a withdrawn release is never re-listed
            return
        loaded = load_descriptor(client, bucket, old, sleep)
        if loaded is None:
            return
        meta = loaded[0]["files"]["meta.json"]
        body = verify_body(get_object(client, bucket, blob_key(meta["sha256"]), sleep), meta, None, IMMUTABLE_CACHE)
        record_activation(client, bucket, old, build_time_of(body), now=now, sleep=sleep)
        print(f"release index: added the previous release {old}, which an earlier run had not indexed")
    except Exception as exc:  # never blocks the activation that already succeeded; the next run tries again
        print(f"release index: could not check the previous release ({type(exc).__name__}); continuing")
