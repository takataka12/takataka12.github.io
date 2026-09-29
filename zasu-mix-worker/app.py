from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from typing import Any, AsyncIterator
from urllib.parse import quote

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse

from mix_engine import mix_files

SERVICE_VERSION = "0.2.1"
PART_BYTES = 40 * 1024 * 1024

WORKER_API_URL = os.environ["MIX_WORKER_API_URL"]
WORKER_SECRET = os.environ["MIX_WORKER_SECRET"]
WORKER_ID = os.environ.get("WORKER_ID", "railway-zasu-mix-v01")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "3"))
SUPABASE_URL_PUBLIC = os.environ["SUPABASE_URL_PUBLIC"]
SUPABASE_PUBLISHABLE_KEY = os.environ["SUPABASE_PUBLISHABLE_KEY"]

app = FastAPI(title="ZASU MIX Worker", version=SERVICE_VERSION)
_worker_task: asyncio.Task | None = None


def worker_headers() -> dict[str, str]:
    return {"x-worker-key": WORKER_SECRET, "content-type": "application/json"}


def retryable_http(exc: Exception) -> bool:
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
    return False


async def worker_api(payload: dict[str, Any], timeout: float = 30.0, retries: int = 3) -> dict[str, Any]:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
                r = await client.post(WORKER_API_URL, headers=worker_headers(), json=payload)
                r.raise_for_status()
                return r.json() if r.content else {}
        except Exception as exc:
            last = exc
            if not retryable_http(exc) or attempt >= retries - 1:
                raise
            await asyncio.sleep((2, 5, 10)[min(attempt, 2)])
    raise last or RuntimeError("worker_api_failed")


async def stage(job_id: str, name: str, progress: int, detail: str | None = None) -> None:
    try:
        await worker_api({
            "action": "stage", "job_id": job_id, "worker_id": WORKER_ID,
            "stage": name, "progress": progress, "detail": detail,
        }, timeout=15, retries=2)
    except Exception as exc:
        print(f"stage_update_failed id={job_id} stage={name} error={type(exc).__name__}:{exc}", flush=True)


async def heartbeat(job_id: str, stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=20)
            return
        except asyncio.TimeoutError:
            pass
        try:
            await worker_api({"action": "heartbeat", "job_id": job_id, "worker_id": WORKER_ID}, timeout=15, retries=2)
        except Exception as exc:
            print(f"heartbeat_failed id={job_id} error={type(exc).__name__}:{exc}", flush=True)


async def download_parts(parts: list[dict[str, Any]], dest: Path) -> None:
    parts = sorted(parts, key=lambda x: int(x.get("index", 0)))
    async with httpx.AsyncClient(timeout=httpx.Timeout(1800), follow_redirects=True) as client:
        with dest.open("wb") as out:
            for i, part in enumerate(parts):
                async with client.stream("GET", str(part["url"])) as r:
                    r.raise_for_status()
                    async for chunk in r.aiter_bytes():
                        out.write(chunk)
                print(f"download_part_done {dest.name} {i+1}/{len(parts)}", flush=True)


def split_file(source: Path, root: Path, prefix: str) -> list[Path]:
    parts: list[Path] = []
    with source.open("rb") as src:
        i = 0
        while True:
            data = src.read(PART_BYTES)
            if not data:
                break
            p = root / f"{prefix}.part{i:03d}"
            p.write_bytes(data)
            parts.append(p)
            i += 1
    return parts


def upload_part_sync(ticket: dict[str, Any], part: Path, bucket: str, mime_type: str) -> None:
    encoded = "/".join(quote(x, safe="") for x in str(ticket["path"]).split("/"))
    url = (
        SUPABASE_URL_PUBLIC.rstrip("/")
        + "/storage/v1/object/upload/sign/"
        + quote(bucket, safe="")
        + "/"
        + encoded
        + "?token="
        + quote(str(ticket["token"]), safe="")
    )
    with part.open("rb") as f:
        r = httpx.put(
            url,
            headers={"apikey": SUPABASE_PUBLISHABLE_KEY, "x-upsert": "false"},
            data={"cacheControl": "3600"},
            files={"": (part.name, f, mime_type)},
            timeout=1800,
        )
    r.raise_for_status()


async def upload_output(job_id: str, kind: str, path: Path, output_name: str, root: Path) -> None:
    prep = await worker_api({
        "action": "prepare_output", "job_id": job_id, "worker_id": WORKER_ID,
        "kind": kind, "output_name": output_name, "output_size_bytes": path.stat().st_size,
    }, timeout=60)
    parts = split_file(path, root, kind)
    tickets = sorted(list(prep.get("tickets") or []), key=lambda x: int(x.get("index", 0)))
    if len(parts) != len(tickets):
        raise RuntimeError(f"{kind}_ticket_mismatch:{len(parts)}:{len(tickets)}")
    for i, (part, ticket) in enumerate(zip(parts, tickets)):
        await asyncio.to_thread(upload_part_sync, ticket, part, prep["bucket"], prep["mime_type"])
        print(f"upload_part_done {kind} {i+1}/{len(parts)}", flush=True)


async def process_job(job: dict[str, Any]) -> None:
    job_id = str(job["id"])
    stop = asyncio.Event()
    hb = asyncio.create_task(heartbeat(job_id, stop))
    try:
        with tempfile.TemporaryDirectory(prefix=f"zasu-mix-{job_id[:8]}-") as td:
            root = Path(td)
            vocal = root / "vocal.input"
            instrumental = root / "instrumental.input"
            mix_out = root / "ZASU_MIX_24bit.wav"
            wet_out = root / "ZASU_VOCAL_WET_24bit.wav"

            await stage(job_id, "downloading", 18, "vocal")
            await download_parts(list(job.get("vocal_parts") or []), vocal)
            await stage(job_id, "downloading", 28, "instrumental")
            await download_parts(list(job.get("instrumental_parts") or []), instrumental)

            await stage(job_id, "analyzing", 38, "loudness_and_format")
            await stage(job_id, "mixing", 50, f"style={job.get('mix_style','modern')}")
            report = await asyncio.to_thread(
                mix_files,
                vocal,
                instrumental,
                mix_out,
                wet_out,
                str(job.get("mix_style") or "modern"),
                float(job.get("vocal_gain_db") or 0.0),
                int(job.get("reverb_amount") or 0),
                float(job.get("eq_body_db") or 0.0),
                float(job.get("eq_presence_db") or 0.0),
                float(job.get("eq_air_db") or 0.0),
            )

            await stage(job_id, "preparing_results", 76, "24bit_wav")
            await stage(job_id, "uploading_results", 82, "mix")
            await upload_output(job_id, "mix", mix_out, "ZASU_MIX_24bit.wav", root)
            await stage(job_id, "uploading_results", 90, "wet_vocal")
            await upload_output(job_id, "vocal", wet_out, "ZASU_VOCAL_WET_24bit.wav", root)

            await stage(job_id, "finalizing", 96, "verify_outputs")
            await worker_api({
                "action": "complete", "job_id": job_id, "worker_id": WORKER_ID, "report": report,
            }, timeout=60)
            print(
                f"mix_complete id={job_id} style={job.get('mix_style')} "
                f"mix_bytes={mix_out.stat().st_size} wet_bytes={wet_out.stat().st_size}",
                flush=True,
            )
    except Exception as exc:
        retry = retryable_http(exc)
        print(f"mix_failed id={job_id} error={type(exc).__name__}:{exc}", flush=True)
        try:
            await worker_api({
                "action": "fail", "job_id": job_id, "worker_id": WORKER_ID,
                "error": f"{type(exc).__name__}:{exc}", "retryable": retry,
            }, timeout=30, retries=2)
        except Exception as report_exc:
            print(f"fail_report_error id={job_id} error={type(report_exc).__name__}:{report_exc}", flush=True)
    finally:
        stop.set()
        try:
            await hb
        except Exception:
            pass


async def poll_loop() -> None:
    backoff = POLL_INTERVAL
    while True:
        try:
            data = await worker_api({"action": "claim", "worker_id": WORKER_ID}, timeout=30)
            job = data.get("job")
            if job:
                backoff = POLL_INTERVAL
                await process_job(job)
            else:
                await asyncio.sleep(POLL_INTERVAL)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"poll_error {type(exc).__name__}:{exc}", flush=True)
            await asyncio.sleep(backoff)
            backoff = min(60.0, max(POLL_INTERVAL, backoff * 1.8))


@app.on_event("startup")
async def startup() -> None:
    global _worker_task
    if _worker_task is None:
        _worker_task = asyncio.create_task(poll_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    global _worker_task
    if _worker_task:
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
        _worker_task = None


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "zasu-mix-worker",
        "version": SERVICE_VERSION,
        "styles": ["natural", "modern", "rock", "loud"],
        "outputs": ["mixed_24bit_wav", "wet_vocal_24bit_wav"],
        "controls": ["vocal_gain_db", "reverb_amount", "eq_body_db", "eq_presence_db", "eq_air_db"],
        "pitch_correction": False,
        "timing_correction": False,
        "mastering_isolated": True,
    }


async def stream_remote_parts(parts: list[dict[str, Any]]) -> AsyncIterator[bytes]:
    parts = sorted(parts, key=lambda x: int(x.get("index", 0)))
    async with httpx.AsyncClient(timeout=httpx.Timeout(1800), follow_redirects=True) as client:
        for part in parts:
            async with client.stream("GET", str(part["url"])) as r:
                r.raise_for_status()
                async for chunk in r.aiter_bytes():
                    yield chunk


@app.get("/download/{job_id}/{kind}")
async def download(job_id: str, kind: str, token: str = Query(..., min_length=16)) -> StreamingResponse:
    if kind not in {"mix", "vocal"}:
        raise HTTPException(status_code=400, detail="invalid_kind")
    try:
        data = await worker_api({
            "action": "download_source", "job_id": job_id, "worker_id": WORKER_ID,
            "access_token": token, "kind": kind,
        }, timeout=30)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail="download_unavailable")
    except Exception:
        raise HTTPException(status_code=502, detail="download_unavailable")
    name = str(data.get("name") or ("ZASU_MIX.wav" if kind=="mix" else "ZASU_VOCAL_WET.wav"))
    encoded = quote(name, safe="")
    return StreamingResponse(
        stream_remote_parts(list(data.get("parts") or [])),
        media_type="audio/wav",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}", "Cache-Control": "no-store"},
    )
