import base64
import io

from fastapi import HTTPException
from PIL import Image, ImageOps

AVATAR_SIZE = 256
MAX_UPLOAD_BYTES = 4 * 1024 * 1024

Image.MAX_IMAGE_PIXELS = 40_000_000


def decode_data_url(value: str) -> bytes:
    payload = value.split(",", 1)[1] if value.startswith("data:") and "," in value else value
    try:
        data = base64.b64decode(payload, validate=False)
    except ValueError:
        raise HTTPException(status_code=400, detail="image could not be decoded")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="image is too large (max 4 MB)")
    return data


def process_avatar(data: bytes) -> bytes:
    try:
        image = Image.open(io.BytesIO(data))
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="that file isn't a supported image")
    image = ImageOps.fit(image, (AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS, centering=(0.5, 0.4))
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=86, optimize=True)
    return out.getvalue()


def save_avatar(conn, user_id: int, jpeg: bytes) -> int:
    conn.execute(
        "UPDATE users SET avatar = ?, avatar_version = avatar_version + 1 WHERE user_id = ?",
        (jpeg, user_id),
    )
    return conn.execute("SELECT avatar_version FROM users WHERE user_id = ?", (user_id,)).fetchone()["avatar_version"]
