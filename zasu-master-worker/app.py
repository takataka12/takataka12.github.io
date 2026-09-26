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

from supabase import create_client

ENGINE_VERSION = "0.4.1"

WORKER_API_URL = os.environ["MASTER_WORKER_API_URL"]
WORKER_SECRET = os.environ["MASTER_WORKER_SECRET"]
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "5"))
WORKER_ID = os.environ.get("WORKER_ID") or f"railway-{socket.gethostname()}"
SUPABASE_URL_PUBLIC = os.environ["SUPABASE_URL_PUBLIC"]
SUPABASE_PUBLISHABLE_KEY = os.environ["SUPABASE_PUBLISHABLE_KEY"]
storage_client = create_client(SUPABASE_URL_PUBLIC, SUPABASE_PUBLISHABLE_KEY)

app = FastAPI(title="ZASU MASTER PUNCH Worker", version=ENGINE_VERSION)
_stop = asyncio.Event()


def worker_headers() -> dict[str, str]:
    return {"x-worker-key": WORKER_SECRET, "content-type": "application/json"}


async def worker_api(payload: dict[str, Any], timeout: float = 60.0) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(WORKER_API_URL, headers=worker_headers(), json=payload)
        response.raise_for_status()
        return response.json()


async def download_to(url: str, path: Path) -> None:
    async with httpx.AsyncClient(timeout=httpx.Timeout(1800.0), follow_redirects=True) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            with path.open("wb") as f:
                async for chunk in response.aiter_bytes():
                    f.write(chunk)


def _upload_signed_sync(ticket: dict[str, Any], path: Path) -> None:
    size = path.stat().st_size
    if size > 50 * 1024 * 1024:
        raise RuntimeError(f"result_file_too_large:{path.name}:{size}")
    with path.open("rb") as f:
        storage_client.storage.from_("master-results").upload_to_signed_url(
            path=ticket["path"],
            token=ticket["token"],
            file=f,
            file_options={"content-type": "audio/flac"},
        )


async def upload_signed(ticket: dict[str, Any], path: Path) -> None:
    await asyncio.to_thread(_upload_signed_sync, ticket, path)


def to_flac(source: Path, dest: Path) -> None:
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(source),
        "-c:a", "flac",
        "-compression_level", "8",
        str(dest),
    ], check=True)


def process_sync(workdir: Path) -> tuple[dict[str, Any], dict[str, Path]]:
    input_path = workdir / "input"
    master_wav = workdir / "master.wav"
    fair_dir = workdir / "fair"
    fair_dir.mkdir(parents=True, exist_ok=True)

    # Run the frozen engine in its own child process. This leaves FastAPI/Supabase
    # client memory out of the DSP process and preserves the exact PUNCH algorithm.
    cmd = [
        sys.executable, "/app/punch_engine.py",
        str(input_path), str(master_wav),
        "--true-peak", "-0.8",
        "--fair-ab", str(fair_dir),
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

    master_flac = workdir / "master.flac"
    before_flac = workdir / "before_fair.flac"
    after_flac = workdir / "after_fair.flac"

    to_flac(master_wav, master_flac)
    to_flac(fair_dir / "before_FAIR.wav", before_flac)
    to_flac(fair_dir / "after_FAIR.wav", after_flac)

    return report, {
        "master": master_flac,
        "before": before_flac,
        "after": after_flac,
    }


async def process_job(job: dict[str, Any]) -> None:
    job_id = job["id"]
    tmp = Path(tempfile.mkdtemp(prefix="zasu-master-"))
    try:
        print(f"job_stage id={job_id} stage=download_start", flush=True)
        input_path = tmp / "input"
        await download_to(job["input_url"], input_path)
        print(f"job_stage id={job_id} stage=download_done bytes={input_path.stat().st_size}", flush=True)

        print(f"job_stage id={job_id} stage=punch_start engine={ENGINE_VERSION}", flush=True)
        report, outputs = await asyncio.to_thread(process_sync, tmp)
        print(f"job_stage id={job_id} stage=punch_done", flush=True)

        print(f"job_stage id={job_id} stage=upload_results_start", flush=True)
        await upload_signed(job["outputs"]["master"], outputs["master"])
        await upload_signed(job["outputs"]["before"], outputs["before"])
        await upload_signed(job["outputs"]["after"], outputs["after"])
        print(f"job_stage id={job_id} stage=upload_results_done", flush=True)

        await worker_api({
            "action": "complete",
            "job_id": job_id,
            "report": report,
        })
        print(f"job_stage id={job_id} stage=complete", flush=True)
    except Exception as exc:
        try:
            await worker_api({
                "action": "fail",
                "job_id": job_id,
                "error": f"{type(exc).__name__}: {exc}",
            })
        except Exception:
            pass
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def poll_loop() -> None:
    while not _stop.is_set():
        try:
            result = await worker_api({"action": "claim", "worker_id": WORKER_ID})
            job = result.get("job")
            if job:
                try:
                    await process_job(job)
                except Exception as exc:
                    print(f"job_failed id={job.get('id')} error={exc}", flush=True)
            else:
                await asyncio.sleep(POLL_INTERVAL)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"poll_error {type(exc).__name__}: {exc}", flush=True)
            await asyncio.sleep(max(POLL_INTERVAL, 10.0))


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
        "engine_version": ENGINE_VERSION,
        "worker_id": WORKER_ID,
    }


@app.get("/download/{upload_id}")
async def download_master(upload_id: str, token: str = Query(...)) -> FileResponse:
    try:
        source = await worker_api({
            "action": "download_source",
            "upload_id": upload_id,
            "token": token,
        })
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=404, detail="Master not found") from exc

    tmpdir = Path(tempfile.mkdtemp(prefix="zasu-download-"))
    flac_path = tmpdir / "master.flac"
    wav_path = tmpdir / "ZASU_MASTER_24bit.wav"

    try:
        await download_to(source["source_url"], flac_path)
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(flac_path),
            "-c:a", "pcm_s24le",
            str(wav_path),
        ], check=True)
    except Exception:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Could not prepare WAV")

    return FileResponse(
        wav_path,
        media_type="audio/wav",
        filename="ZASU_MASTER_24bit.wav",
        background=BackgroundTask(shutil.rmtree, tmpdir, True),
    )
