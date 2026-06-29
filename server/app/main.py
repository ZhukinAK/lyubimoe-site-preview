import base64
import hashlib
import hmac
import mimetypes
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response


DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data"))
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/app/uploads"))
DB_PATH = DATA_DIR / "preview.sqlite3"
ROOM_SLUG = os.getenv("ROOM_SLUG", "preview")
ACCESS_HASH = os.getenv("ACCESS_HASH", "")
SESSION_SECRET = os.getenv("SESSION_SECRET", "")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "https://zhukinak.github.io,http://127.0.0.1:4173,http://localhost:4173",
    ).split(",")
    if origin.strip()
]
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(8 * 1024 * 1024)))
TOKEN_TTL_SECONDS = int(os.getenv("TOKEN_TTL_SECONDS", str(7 * 24 * 60 * 60)))


app = FastAPI(title="Lyubimoe preview API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / "gallery").mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                room_slug TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                deleted_at TEXT
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS gallery_items (
                id TEXT PRIMARY KEY,
                room_slug TEXT NOT NULL,
                caption TEXT NOT NULL,
                filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                deleted_at TEXT
            )
            """
        )
        db.execute("CREATE INDEX IF NOT EXISTS idx_memories_room ON memories(room_slug, deleted_at, created_at)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_gallery_room ON gallery_items(room_slug, deleted_at, created_at)")


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def connect_db() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db


def json_error(message: str, status_code: int) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status_code)


def require_env() -> None:
    missing = [name for name, value in {"ACCESS_HASH": ACCESS_HASH, "SESSION_SECRET": SESSION_SECRET}.items() if not value]
    if missing:
        raise HTTPException(status_code=500, detail=f"Server is missing: {', '.join(missing)}")


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def sign(payload: str) -> str:
    digest = hmac.new(SESSION_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    return b64url_encode(digest)


def create_token(room_slug: str) -> str:
    payload = b64url_encode(f"{room_slug}:{int(time.time()) + TOKEN_TTL_SECONDS}".encode("utf-8"))
    return f"{payload}.{sign(payload)}"


def verify_token_value(token: str) -> str:
    require_env()
    try:
        payload, signature = token.split(".", 1)
        if not hmac.compare_digest(signature, sign(payload)):
            raise ValueError
        decoded = b64url_decode(payload).decode("utf-8")
        room_slug, exp_raw = decoded.rsplit(":", 1)
        if int(exp_raw) < int(time.time()):
            raise ValueError
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Вход устарел.") from exc
    if room_slug != ROOM_SLUG:
        raise HTTPException(status_code=401, detail="Вход устарел.")
    return room_slug


def require_session(request: Request, authorization: str | None = Header(default=None)) -> str:
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if not token:
        token = request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="Нет входа.")
    return verify_token_value(token)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Ошибка API."
    return json_error(detail, exc.status_code)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/join")
async def join_room(payload: dict[str, Any]) -> dict[str, str]:
    require_env()
    passphrase = str(payload.get("passphrase", "")).strip()
    room_slug = str(payload.get("roomSlug", ROOM_SLUG)).strip() or ROOM_SLUG
    passphrase_hash = hashlib.sha256(passphrase.encode("utf-8")).hexdigest()
    if room_slug != ROOM_SLUG or passphrase_hash != ACCESS_HASH:
        raise HTTPException(status_code=403, detail="Не та фраза.")
    return {"roomId": ROOM_SLUG, "token": create_token(ROOM_SLUG)}


@app.get("/memories")
def list_memories(room_slug: str = Depends(require_session)) -> dict[str, list[dict[str, str]]]:
    with connect_db() as db:
        rows = db.execute(
            """
            SELECT id, text, created_at
            FROM memories
            WHERE room_slug = ? AND deleted_at IS NULL
            ORDER BY created_at DESC
            """,
            (room_slug,),
        ).fetchall()
    return {"items": [dict(row) for row in rows]}


@app.post("/memories")
async def create_memory(payload: dict[str, Any], room_slug: str = Depends(require_session)) -> dict[str, dict[str, str]]:
    text = str(payload.get("text", "")).strip()[:600]
    if not text:
        raise HTTPException(status_code=400, detail="Пустая запись.")
    item = {"id": str(uuid.uuid4()), "room_slug": room_slug, "text": text, "created_at": now_iso()}
    with connect_db() as db:
        db.execute(
            "INSERT INTO memories (id, room_slug, text, created_at) VALUES (?, ?, ?, ?)",
            (item["id"], item["room_slug"], item["text"], item["created_at"]),
        )
    return {"item": {key: item[key] for key in ("id", "text", "created_at")}}


@app.delete("/memories/{item_id}")
def delete_memory(item_id: str, room_slug: str = Depends(require_session)) -> Response:
    with connect_db() as db:
        db.execute(
            "UPDATE memories SET deleted_at = ? WHERE id = ? AND room_slug = ? AND deleted_at IS NULL",
            (now_iso(), item_id, room_slug),
        )
    return Response(status_code=204)


@app.get("/gallery")
def list_gallery(room_slug: str = Depends(require_session)) -> dict[str, list[dict[str, str]]]:
    with connect_db() as db:
        rows = db.execute(
            """
            SELECT id, caption, created_at
            FROM gallery_items
            WHERE room_slug = ? AND deleted_at IS NULL
            ORDER BY created_at DESC
            """,
            (room_slug,),
        ).fetchall()
    return {"items": [dict(row) for row in rows]}


def upload_extension(file: UploadFile) -> str:
    content_type = file.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Можно загрузить только картинку.")
    if content_type == "image/png":
        return "png"
    if content_type == "image/webp":
        return "webp"
    if content_type == "image/gif":
        return "gif"
    return "jpg"


@app.post("/gallery")
async def create_gallery_item(
    file: UploadFile = File(...),
    caption: str = Form(default=""),
    room_slug: str = Depends(require_session),
) -> dict[str, dict[str, str]]:
    extension = upload_extension(file)
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Картинка слишком большая.")
    item_id = str(uuid.uuid4())
    filename = f"{item_id}.{extension}"
    target = UPLOAD_DIR / "gallery" / filename
    target.write_bytes(content)
    content_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    item = {
        "id": item_id,
        "room_slug": room_slug,
        "caption": caption.strip()[:80],
        "filename": filename,
        "content_type": content_type,
        "created_at": now_iso(),
    }
    with connect_db() as db:
        db.execute(
            """
            INSERT INTO gallery_items (id, room_slug, caption, filename, content_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (item["id"], item["room_slug"], item["caption"], item["filename"], item["content_type"], item["created_at"]),
        )
    return {"item": {key: item[key] for key in ("id", "caption", "created_at")}}


@app.delete("/gallery/{item_id}")
def delete_gallery_item(item_id: str, room_slug: str = Depends(require_session)) -> Response:
    with connect_db() as db:
        db.execute(
            "UPDATE gallery_items SET deleted_at = ? WHERE id = ? AND room_slug = ? AND deleted_at IS NULL",
            (now_iso(), item_id, room_slug),
        )
    return Response(status_code=204)


@app.get("/gallery/file/{item_id}")
def get_gallery_file(item_id: str, room_slug: str = Depends(require_session)) -> FileResponse:
    with connect_db() as db:
        row = db.execute(
            """
            SELECT filename, content_type
            FROM gallery_items
            WHERE id = ? AND room_slug = ? AND deleted_at IS NULL
            LIMIT 1
            """,
            (item_id, room_slug),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Картинка не найдена.")
    path = UPLOAD_DIR / "gallery" / row["filename"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Картинка не найдена.")
    return FileResponse(path, media_type=row["content_type"], headers={"Cache-Control": "private, max-age=300"})
