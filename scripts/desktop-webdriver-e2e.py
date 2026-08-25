#!/usr/bin/env python3
"""Real-process SiloNR Desktop E2E.

Runs the actual Tauri binary through tauri-driver, invokes the same commands used by
its packaged UI, persists work in SQLite while the server is unavailable, restarts
the desktop process, reconnects, uploads evidence, finalizes, and proves an explicit
revision conflict does not overwrite newer server state.

Linux CI uses the compile-time `ci-insecure-store` debug feature only because Windows
DPAPI is exercised by its own Windows security gate. Release builds cannot enable the
shim.
"""

from __future__ import annotations

import atexit
import base64
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
SERVER_URL = "http://127.0.0.1:3000"
DRIVER_URL = "http://127.0.0.1:4444"
SILO_ID = "50000000-0000-4000-8000-000000000001"
PAIRING_CODE = "CI2026-ACTIVE-OFFLINE"
PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

server_process: subprocess.Popen | None = None
driver_process: subprocess.Popen | None = None
session_id: str | None = None
completed_inspection_id: str | None = None
conflict_inspection_id: str | None = None


def log(message: str) -> None:
    print(f"[desktop-e2e] {message}", flush=True)


def http_json(method: str, url: str, payload: object | None = None, timeout: int = 60):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"content-type": "application/json"} if body is not None else {},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} {method} {url}: {raw}") from error


def wait_tcp(host: str, port: int, timeout_seconds: int = 60) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                return
        except OSError:
            time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for {host}:{port}")


def wait_health(timeout_seconds: int = 60) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{SERVER_URL}/api/health/live", timeout=2) as response:
                if 200 <= response.status < 300:
                    return
        except Exception:
            pass
        time.sleep(0.75)
    raise RuntimeError("SiloNR server did not become healthy")


def start_server() -> None:
    global server_process
    if server_process and server_process.poll() is None:
        return
    log("starting real SiloNR server")
    log_file = open("/tmp/silonr-desktop-e2e-server.log", "ab", buffering=0)
    server_process = subprocess.Popen(
        ["bun", "run", "dev", "--", "--host", "127.0.0.1"],
        cwd=ROOT,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        env=os.environ.copy(),
        start_new_session=True,
    )
    wait_health()


def stop_server() -> None:
    global server_process
    if not server_process or server_process.poll() is not None:
        server_process = None
        return
    log("stopping server to simulate connectivity loss")
    try:
        os.killpg(server_process.pid, signal.SIGTERM)
        server_process.wait(timeout=12)
    except Exception:
        try:
            os.killpg(server_process.pid, signal.SIGKILL)
        except Exception:
            pass
    server_process = None
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", 3000), timeout=0.5):
                time.sleep(0.4)
        except OSError:
            return
    raise RuntimeError("server port remained open after shutdown")


def start_driver() -> None:
    global driver_process
    if driver_process and driver_process.poll() is None:
        return
    driver = shutil.which("tauri-driver")
    if not driver:
        raise RuntimeError("tauri-driver is not available in PATH")
    log(f"starting tauri-driver from {driver}")
    log_file = open("/tmp/silonr-tauri-driver.log", "ab", buffering=0)
    driver_process = subprocess.Popen(
        [driver],
        cwd=ROOT,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        env=os.environ.copy(),
        start_new_session=True,
    )
    wait_tcp("127.0.0.1", 4444, 30)


def stop_driver() -> None:
    global driver_process
    close_session()
    if driver_process and driver_process.poll() is None:
        try:
            os.killpg(driver_process.pid, signal.SIGTERM)
            driver_process.wait(timeout=8)
        except Exception:
            try:
                os.killpg(driver_process.pid, signal.SIGKILL)
                driver_process.wait(timeout=5)
            except Exception:
                pass
    driver_process = None

    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", 4444), timeout=0.5):
                time.sleep(0.25)
        except OSError:
            return
    raise RuntimeError("tauri-driver port remained open after shutdown")


def restart_driver() -> None:
    log("restarting tauri-driver to guarantee a clean WebDriver session boundary")
    stop_driver()
    start_driver()


def create_session() -> None:
    global session_id
    binary = Path(os.environ.get("SILONR_DESKTOP_BINARY", ROOT / "src-tauri/target/debug/silonr-desktop")).resolve()
    if not binary.exists():
        raise RuntimeError(f"desktop binary does not exist: {binary}")
    payload = {
        "capabilities": {
            "alwaysMatch": {
                "browserName": "wry",
                "tauri:options": {"application": str(binary)},
            }
        }
    }
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            log(f"opening Tauri WebDriver session (attempt {attempt}/3)")
            response = http_json("POST", f"{DRIVER_URL}/session", payload, timeout=20)
            value = response.get("value", response) if isinstance(response, dict) else {}
            session_id = value.get("sessionId") or (response.get("sessionId") if isinstance(response, dict) else None)
            if not session_id:
                raise RuntimeError(f"WebDriver did not return a session id: {response!r}")
            http_json("POST", f"{DRIVER_URL}/session/{session_id}/timeouts", {"script": 60000})
            log(f"Tauri WebDriver session opened: {session_id}")
            wait_tauri_ready()
            return
        except Exception as error:
            last_error = error
            log(f"session attempt {attempt}/3 failed: {error}")
            # A failed POST /session may still launch Tauri while losing the
            # response (for example hyper::Error(IncompleteMessage)). Retrying
            # against that driver leaks its single slot and produces
            # "Maximum number of active sessions". Reset the whole process
            # group before every retry, even when no session id was returned.
            stop_driver()
            if attempt < 3:
                start_driver()
    raise RuntimeError(f"could not open Tauri WebDriver session after 3 clean attempts: {last_error}")


def close_session() -> None:
    global session_id
    if not session_id:
        return
    current = session_id
    session_id = None
    try:
        http_json("DELETE", f"{DRIVER_URL}/session/{current}", timeout=15)
    except Exception as error:
        log(f"session cleanup warning: {error}")


def execute_async(script: str, args: list[object]):
    if not session_id:
        raise RuntimeError("WebDriver session is not open")
    response = http_json(
        "POST",
        f"{DRIVER_URL}/session/{session_id}/execute/async",
        {"script": script, "args": args},
        timeout=70,
    )
    if not isinstance(response, dict):
        raise RuntimeError(f"invalid WebDriver response: {response!r}")
    return response.get("value")


def wait_tauri_ready() -> None:
    deadline = time.time() + 30
    script = "const done=arguments[arguments.length-1]; done(Boolean(window.__TAURI__?.core?.invoke));"
    while time.time() < deadline:
        try:
            if execute_async(script, []):
                return
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("Tauri IPC did not become ready")


def invoke_raw(command: str, arguments: dict | None = None):
    script = """
const command = arguments[0];
const payload = arguments[1];
const done = arguments[arguments.length - 1];
window.__TAURI__.core.invoke(command, payload)
  .then((value) => done({ ok: true, value }))
  .catch((error) => done({ ok: false, error: String(error) }));
"""
    return execute_async(script, [command, arguments or {}])


def invoke(command: str, arguments: dict | None = None):
    result = invoke_raw(command, arguments)
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Tauri command {command} failed: {result}")
    return result.get("value")


def invoke_expected_error(command: str, expected_fragment: str, arguments: dict | None = None) -> None:
    result = invoke_raw(command, arguments)
    if not isinstance(result, dict) or result.get("ok"):
        raise RuntimeError(f"expected {command} to fail with {expected_fragment}, got {result}")
    error = str(result.get("error", ""))
    if expected_fragment not in error:
        raise RuntimeError(f"expected {expected_fragment} from {command}, got {error}")
    log(f"expected failure observed from {command}: {expected_fragment}")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def prepare_offline_work() -> str:
    status = invoke("desktop_status")
    require(status.get("paired") is False, f"fresh desktop unexpectedly paired: {status}")

    paired = invoke(
        "pair_device",
        {
            "serverUrl": SERVER_URL,
            "pairingCode": PAIRING_CODE,
            "deviceName": "SiloNR Tauri WebDriver E2E",
        },
    )
    require(paired.get("paired") is True, f"pairing failed: {paired}")
    require(paired.get("organizationName"), f"bootstrap did not persist organization: {paired}")

    silos = invoke("list_offline_silos")
    require(any(item.get("id") == SILO_ID for item in silos), f"expected seeded silo not found: {silos}")

    # From this point onward all field work must remain usable without the server.
    stop_server()

    detail = invoke(
        "start_offline_inspection",
        {
            "siloId": SILO_ID,
            "inspectionType": "Inspeção Tauri sem rede",
            "notes": "Criada pelo processo desktop real enquanto o servidor estava indisponível.",
        },
    )
    inspection_id = detail["id"]
    checklist = detail.get("checklist") or []
    require(len(checklist) >= 1, "offline checklist was empty")
    requirement_id = checklist[0]["requirementId"]

    detail = invoke(
        "save_offline_answer",
        {
            "inspectionId": inspection_id,
            "requirementId": requirement_id,
            "result": "critico",
            "notes": "Pendência fictícia criada offline pelo E2E do desktop.",
        },
    )
    require(len(detail.get("answers") or []) == 1, "offline answer was not persisted")

    detail = invoke(
        "add_offline_evidence",
        {
            "inspectionId": inspection_id,
            "requirementId": requirement_id,
            "fileName": "evidencia-tauri-e2e.png",
            "mimeType": "image/png",
            "dataBase64": PNG_BASE64,
            "description": "Evidência criada no processo Tauri real sem conectividade.",
        },
    )
    evidence = detail.get("evidence") or []
    require(len(evidence) == 1 and evidence[0].get("status") == "pending", f"offline evidence was not queued: {evidence}")

    detail = invoke("request_offline_finalize", {"inspectionId": inspection_id})
    require(detail.get("finalizeRequested") is True, f"finalization was not requested: {detail}")

    status = invoke("desktop_status")
    require(int(status.get("pendingEvents", 0)) >= 2, f"expected pending offline work: {status}")
    invoke_expected_error("sync_now", "NETWORK:")

    log(f"offline work persisted with server down: {inspection_id}")
    return inspection_id


def reconnect_and_finish(inspection_id: str) -> None:
    # Close the real application and open it again before reconnecting. SQLite,
    # evidence files and the device credential must survive the process restart.
    close_session()
    # WebKitWebDriver can acknowledge DELETE /session before releasing its
    # single active-session slot. A driver restart makes the process restart
    # deterministic and also proves the application can reopen from SQLite.
    restart_driver()
    start_server()
    create_session()

    status = invoke("desktop_status")
    require(status.get("paired") is True, f"pairing did not survive desktop restart: {status}")
    require(int(status.get("pendingEvents", 0)) >= 2, f"offline queue did not survive restart: {status}")

    synced = invoke("sync_now")
    require(int(synced.get("pendingEvents", -1)) == 0, f"sync did not drain queue: {synced}")
    require(int(synced.get("conflicts", -1)) == 0, f"unexpected conflict in happy path: {synced}")

    detail = invoke("get_offline_inspection", {"inspectionId": inspection_id})
    require(detail.get("status") == "concluida", f"inspection did not conclude: {detail}")
    require(detail.get("syncState") == "synced", f"inspection did not become synced: {detail}")
    require(detail.get("finalizeRequested") is False, f"finalize flag did not clear: {detail}")
    evidence = detail.get("evidence") or []
    require(evidence and all(item.get("status") == "uploaded" for item in evidence), f"evidence not confirmed: {evidence}")
    log(f"offline work synchronized after restart and reconnection: {inspection_id}")


def prove_conflict() -> str:
    detail = invoke(
        "start_offline_inspection",
        {
            "siloId": SILO_ID,
            "inspectionType": "Inspeção Tauri com concorrência",
            "notes": "Primeira versão do rascunho local.",
        },
    )
    inspection_id = detail["id"]
    requirement_id = detail["checklist"][0]["requirementId"]
    invoke(
        "save_offline_answer",
        {
            "inspectionId": inspection_id,
            "requirementId": requirement_id,
            "result": "atendido",
            "notes": "Primeira versão aceita pelo servidor.",
        },
    )
    first_sync = invoke("sync_now")
    require(int(first_sync.get("conflicts", 0)) == 0, f"unexpected first-sync conflict: {first_sync}")
    server_detail = invoke("get_offline_inspection", {"inspectionId": inspection_id})
    require(int(server_detail.get("baseServerRevision", 0)) == 1, f"expected server revision 1: {server_detail}")

    # Queue a local event based on revision 1.
    invoke(
        "save_offline_answer",
        {
            "inspectionId": inspection_id,
            "requirementId": requirement_id,
            "result": "pendente",
            "notes": "Esta alteração obsoleta não pode sobrescrever revisão concorrente.",
        },
    )

    env = os.environ.copy()
    env["SILONR_E2E_CONFLICT_INSPECTION_ID"] = inspection_id
    subprocess.run(
        ["bun", "run", "scripts/ci-desktop-conflict.ts"],
        cwd=ROOT,
        env=env,
        check=True,
    )

    conflict_status = invoke("sync_now")
    require(int(conflict_status.get("conflicts", 0)) >= 1, f"desktop did not surface revision conflict: {conflict_status}")
    conflicted = invoke("get_offline_inspection", {"inspectionId": inspection_id})
    require(conflicted.get("syncState") == "conflict", f"inspection did not enter conflict state: {conflicted}")
    require("INSPECTION_CONFLICT" in str(conflicted.get("lastError", "")), f"wrong conflict reason: {conflicted}")
    log(f"stale desktop event correctly rejected: {inspection_id}")
    return inspection_id


def assert_database(completed_id: str, conflict_id: str) -> None:
    env = os.environ.copy()
    env["SILONR_E2E_COMPLETED_INSPECTION_ID"] = completed_id
    env["SILONR_E2E_CONFLICT_INSPECTION_ID"] = conflict_id
    subprocess.run(
        ["bun", "run", "scripts/ci-desktop-e2e-assert.ts"],
        cwd=ROOT,
        env=env,
        check=True,
    )


def cleanup() -> None:
    try:
        stop_driver()
    finally:
        stop_server()


def main() -> int:
    global completed_inspection_id, conflict_inspection_id
    atexit.register(cleanup)
    start_server()
    start_driver()
    create_session()

    completed_inspection_id = prepare_offline_work()
    reconnect_and_finish(completed_inspection_id)
    conflict_inspection_id = prove_conflict()
    assert_database(completed_inspection_id, conflict_inspection_id)

    log("PASS: real Tauri process + SQLite + outage + restart + evidence + reconnect + conflict")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"[desktop-e2e] FAIL: {error}", file=sys.stderr, flush=True)
        for path in ("/tmp/silonr-desktop-e2e-server.log", "/tmp/silonr-tauri-driver.log"):
            try:
                print(f"\n--- {path} ---", file=sys.stderr)
                print(Path(path).read_text(errors="replace")[-12000:], file=sys.stderr)
            except Exception:
                pass
        raise
