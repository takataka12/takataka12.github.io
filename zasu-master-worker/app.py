from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import subprocess
import tempfile
import sys
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from urllib.parse import quote

ENGINE_VERSION = "0.4.1"
SERVICE_VERSION = "1.1.0"
LOUD_PROFILE_VERSION = "OTV-1.0"

WORKER_API_URL = os.environ["MASTER_WORKER_API_URL"]
WORKER_SECRET = os.environ["MASTER_WORKER_SECRET"]
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "5"))
WORKER_ID = os.environ.get("WORKER_ID") or f"railway-{socket.gethostname()}"
SUPABASE_URL_PUBLIC = os.environ["SUPABASE_URL_PUBLIC"]
SUPABASE_PUBLISHABLE_KEY = os.environ["SUPABASE_PUBLISHABLE_KEY"]

# Supabase Free Storage limits a single object to 50 MB.
# Keep individual result objects safely below that ceiling and split the
# lossless master only when necessary. The download endpoint reassembles it.
SIGNED_OBJECT_LIMIT = 45 * 1024 * 1024
MASTER_PART_BYTES = 40 * 1024 * 1024

app = FastAPI(title="ZASU MASTER PUNCH Worker", version=SERVICE_VERSION)
_stop = asyncio.Event()


def worker_headers() -> dict[str, str]:
    return {"x-worker-key": WORKER_SECRET, "content-type": "application/json"}


def _is_retryable_http(exc: Exception) -> bool:
    if isinstance(
        exc,
        (
            httpx.ReadTimeout,
            httpx.ConnectTimeout,
            httpx.ConnectError,
            httpx.RemoteProtocolError,
            httpx.PoolTimeout,
        ),
    ):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
    return False


def _is_retryable_job_error(exc: Exception) -> bool:
    return _is_retryable_http(exc)


async def worker_api(
    payload: dict[str, Any],
    timeout: float = 30.0,
    retries: int = 3,
) -> dict[str, Any]:
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
                response = await client.post(
                    WORKER_API_URL,
                    headers=worker_headers(),
                    json=payload,
                )
                response.raise_for_status()
                if not response.content:
                    return {}
                return response.json()
        except Exception as exc:
            last_exc = exc
            if not _is_retryable_http(exc) or attempt >= retries - 1:
                raise
            await asyncio.sleep((2, 5, 10)[min(attempt, 2)])
    if last_exc:
        raise last_exc
    raise RuntimeError("worker_api_failed")


async def safe_stage(
    job_id: str,
    stage: str,
    progress: int,
    detail: str | None = None,
) -> None:
    try:
        await worker_api(
            {
                "action": "stage",
                "job_id": job_id,
                "worker_id": WORKER_ID,
                "stage": stage,
                "progress": progress,
                "detail": detail,
            },
            timeout=15,
            retries=2,
        )
    except Exception as exc:
        print(
            f"stage_update_failed id={job_id} stage={stage} "
            f"error={type(exc).__name__}:{exc}",
            flush=True,
        )


async def heartbeat_loop(job_id: str, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=20)
            return
        except asyncio.TimeoutError:
            pass
        try:
            await worker_api(
                {
                    "action": "heartbeat",
                    "job_id": job_id,
                    "worker_id": WORKER_ID,
                },
                timeout=15,
                retries=2,
            )
        except Exception as exc:
            print(
                f"heartbeat_failed id={job_id} "
                f"error={type(exc).__name__}:{exc}",
                flush=True,
            )


async def download_to(url: str, path: Path) -> None:
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(1800.0),
        follow_redirects=True,
    ) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            with path.open("wb") as f:
                async for chunk in response.aiter_bytes():
                    f.write(chunk)


async def download_parts_to(urls: list[str], path: Path) -> None:
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(1800.0),
        follow_redirects=True,
    ) as client:
        with path.open("wb") as out:
            for index, url in enumerate(urls):
                async with client.stream("GET", url) as response:
                    response.raise_for_status()
                    async for chunk in response.aiter_bytes():
                        out.write(chunk)
                print(
                    f"download_part_done index={index + 1}/{len(urls)}",
                    flush=True,
                )


def _upload_signed_sync(ticket: dict[str, Any], path: Path) -> None:
    size = path.stat().st_size
    if size > 50 * 1024 * 1024:
        raise RuntimeError(f"result_file_too_large:{path.name}:{size}")

    content_type = "audio/mp4" if path.suffix.lower() == ".m4a" else "application/octet-stream"
    encoded_path = "/".join(quote(part, safe="") for part in str(ticket["path"]).split("/"))
    signed_url = (
        SUPABASE_URL_PUBLIC.rstrip("/")
        + "/storage/v1/object/upload/sign/master-results/"
        + encoded_path
        + "?token="
        + quote(str(ticket["token"]), safe="")
    )

    with path.open("rb") as f:
        response = httpx.put(
            signed_url,
            headers={
                "apikey": SUPABASE_PUBLISHABLE_KEY,
                "x-upsert": "false",
            },
            data={"cacheControl": "3600"},
            files={"": (path.name, f, content_type)},
            timeout=1800.0,
        )
    response.raise_for_status()


async def upload_signed(ticket: dict[str, Any], path: Path) -> None:
    await asyncio.to_thread(_upload_signed_sync, ticket, path)


def to_flac(source: Path, dest: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-c:a",
            "flac",
            "-compression_level",
            "8",
            str(dest),
        ],
        check=True,
    )


def to_preview_m4a(source: Path, dest: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(dest),
        ],
        check=True,
    )


def split_binary_file(source: Path, workdir: Path) -> list[Path]:
    parts: list[Path] = []
    with source.open("rb") as src:
        index = 0
        while True:
            data = src.read(MASTER_PART_BYTES)
            if not data:
                break
            part = workdir / f"master.flac.part{index:03d}"
            part.write_bytes(data)
            parts.append(part)
            index += 1
    if len(parts) < 2:
        raise RuntimeError("master_split_failed")
    return parts


def process_sync(workdir: Path, mastering_profile: str = "standard") -> tuple[dict[str, Any], dict[str, Path]]:
    input_path = workdir / "input"
    master_wav = workdir / "master.wav"
    fair_dir = workdir / "fair"
    fair_dir.mkdir(parents=True, exist_ok=True)

    mastering_profile = mastering_profile if mastering_profile in {"standard", "loud_otv"} else "standard"
    if mastering_profile == "loud_otv":
        cmd = [
            sys.executable,
            "/app/loud_otv_profile.py",
            str(input_path),
            str(master_wav),
            "--fair-ab",
            str(fair_dir),
        ]
    else:
        cmd = [
            sys.executable,
            "/app/punch_engine.py",
            str(input_path),
            str(master_wav),
            "--true-peak",
            "-0.8",
            "--fair-ab",
            str(fair_dir),
        ]
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=os.environ.copy(),
    )
    if proc.stderr:
        print("punch_subprocess_stderr\n" + proc.stderr[-8000:], flush=True)
    if proc.returncode != 0:
        raise RuntimeError(f"punch_subprocess_exit:{proc.returncode}")

    report_path = master_wav.with_suffix(".report.json")
    if not report_path.exists():
        raise RuntimeError("punch_report_missing")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if mastering_profile == "standard":
        report["profile"] = {
            "id": "standard",
            "label": "STANDARD",
            "version": "1.0",
            "policy": "PUNCH adaptive / do-no-harm",
        }

    master_flac = workdir / "master.flac"
    before_preview = workdir / "before_fair.m4a"
    after_preview = workdir / "after_fair.m4a"

    to_flac(master_wav, master_flac)
    to_preview_m4a(fair_dir / "before_FAIR.wav", before_preview)
    to_preview_m4a(fair_dir / "after_FAIR.wav", after_preview)

    return report, {
        "master": master_flac,
        "before_preview": before_preview,
        "after_preview": after_preview,
    }


async def process_job(job: dict[str, Any]) -> None:
    job_id = str(job["id"])
    mastering_profile = str(job.get("mastering_profile") or "standard")
    if mastering_profile not in {"standard", "loud_otv"}:
        mastering_profile = "standard"
    tmp = Path(tempfile.mkdtemp(prefix="zasu-master-"))
    heartbeat_stop = asyncio.Event()
    heartbeat_task = asyncio.create_task(heartbeat_loop(job_id, heartbeat_stop))

    try:
        await safe_stage(job_id, "downloading", 15, "source_download")
        print(f"job_stage id={job_id} stage=download_start", flush=True)
        input_path = tmp / "input"
        await download_to(job["input_url"], input_path)
        print(
            f"job_stage id={job_id} stage=download_done "
            f"bytes={input_path.stat().st_size}",
            flush=True,
        )

        await safe_stage(job_id, "mastering", 35, f"engine={ENGINE_VERSION};profile={mastering_profile}")
        print(
            f"job_stage id={job_id} stage=punch_start engine={ENGINE_VERSION} profile={mastering_profile}",
            flush=True,
        )
        report, outputs = await asyncio.to_thread(process_sync, tmp, mastering_profile)
        print(f"job_stage id={job_id} stage=punch_done", flush=True)

        await safe_stage(job_id, "preparing_results", 70, "encode_and_package")
        master = outputs["master"]
        master_parts_paths: list[str] = []

        print(f"job_stage id={job_id} stage=upload_results_start", flush=True)
        await safe_stage(job_id, "uploading_results", 80, "upload_start")

        if master.stat().st_size <= SIGNED_OBJECT_LIMIT:
            await upload_signed(job["outputs"]["master"], master)
        else:
            parts = await asyncio.to_thread(split_binary_file, master, tmp)
            prepared = await worker_api(
                {
                    "action": "prepare_master_parts",
                    "job_id": job_id,
                    "worker_id": WORKER_ID,
                    "part_count": len(parts),
                },
                timeout=30,
                retries=3,
            )
            tickets = prepared.get("parts") or []
            if len(tickets) != len(parts):
                raise RuntimeError("master_part_ticket_mismatch")
            for index, (ticket, part) in enumerate(zip(tickets, parts), start=1):
                await safe_stage(
                    job_id,
                    "uploading_results",
                    min(92, 80 + int(index / len(parts) * 10)),
                    f"master_part={index}/{len(parts)}",
                )
                await upload_signed(ticket, part)
                master_parts_paths.append(str(ticket["path"]))

        await upload_signed(job["outputs"]["before_preview"], outputs["before_preview"])
        await upload_signed(job["outputs"]["after_preview"], outputs["after_preview"])

        print(f"job_stage id={job_id} stage=upload_results_done", flush=True)
        await safe_stage(job_id, "finalizing", 95, "result_validation")

        await worker_api(
            {
                "action": "complete",
                "job_id": job_id,
                "worker_id": WORKER_ID,
                "report": report,
                "master_parts": master_parts_paths,
            },
            timeout=45,
            retries=3,
        )
        print(f"job_stage id={job_id} stage=complete", flush=True)

    except Exception as exc:
        retryable = _is_retryable_job_error(exc)
        try:
            fail_result = await worker_api(
                {
                    "action": "fail",
                    "job_id": job_id,
                    "worker_id": WORKER_ID,
                    "error": f"{type(exc).__name__}: {exc}",
                    "retryable": retryable,
                },
                timeout=30,
                retries=3,
            )
            print(
                f"job_fail_recorded id={job_id} "
                f"retrying={fail_result.get('retrying', False)}",
                flush=True,
            )
        except Exception as fail_exc:
            print(
                f"job_fail_report_error id={job_id} "
                f"error={type(fail_exc).__name__}:{fail_exc}",
                flush=True,
            )
        raise
    finally:
        heartbeat_stop.set()
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass
        shutil.rmtree(tmp, ignore_errors=True)


async def poll_loop() -> None:
    consecutive_errors = 0
    while not _stop.is_set():
        try:
            result = await worker_api(
                {"action": "claim", "worker_id": WORKER_ID},
                timeout=20,
                retries=3,
            )
            consecutive_errors = 0
            job = result.get("job")
            if job:
                try:
                    await process_job(job)
                except Exception as exc:
                    print(
                        f"job_failed id={job.get('id')} "
                        f"error={type(exc).__name__}:{exc}",
                        flush=True,
                    )
            else:
                await asyncio.sleep(POLL_INTERVAL)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            consecutive_errors += 1
            delay = min(60.0, max(10.0, POLL_INTERVAL * (2 ** min(consecutive_errors, 4))))
            print(
                f"poll_error {type(exc).__name__}: {exc} "
                f"backoff={delay:.0f}s",
                flush=True,
            )
            await asyncio.sleep(delay)


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(poll_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    _stop.set()


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "zasu-master-worker",
        "service_version": SERVICE_VERSION,
        "engine_version": ENGINE_VERSION,
        "worker_id": WORKER_ID,
        "chunked_master_support": True,
        "mastering_profiles": ["standard", "loud_otv"],
        "loud_profile_version": LOUD_PROFILE_VERSION,
    }


@app.get("/download/{upload_id}")
async def download_master(upload_id: str, token: str = Query(...)) -> FileResponse:
    try:
        source = await worker_api(
            {
                "action": "download_source",
                "upload_id": upload_id,
                "token": token,
            },
            timeout=30,
            retries=3,
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=404, detail="Master not found") from exc

    tmpdir = Path(tempfile.mkdtemp(prefix="zasu-download-"))
    flac_path = tmpdir / "master.flac"
    wav_path = tmpdir / "ZASU_MASTER_24bit.wav"

    try:
        part_urls = source.get("part_urls") or []
        if part_urls:
            await download_parts_to([str(x) for x in part_urls], flac_path)
        elif source.get("source_url"):
            await download_to(str(source["source_url"]), flac_path)
        else:
            raise RuntimeError("master_source_missing")

        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(flac_path),
                "-c:a",
                "pcm_s24le",
                str(wav_path),
            ],
            check=True,
        )
    except Exception:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Could not prepare WAV")

    return FileResponse(
        wav_path,
        media_type="audio/wav",
        filename="ZASU_MASTER_24bit.wav",
        background=BackgroundTask(shutil.rmtree, tmpdir, True),
    )
