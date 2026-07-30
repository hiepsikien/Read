from __future__ import annotations

import hashlib
import html
import logging
from pathlib import Path
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from google.api_core.exceptions import GoogleAPICallError
from google.auth.exceptions import DefaultCredentialsError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..tts_settings import get_active_tts, tts_settings_payload
from .. import tts

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tts", tags=["tts"])

DEFAULT_COMPARE_TEXT = (
    "Tàu chở dầu đi qua eo biển Hormuz mỗi ngày. "
    "Từ Washington đến eo biển Malacca, các tuyến đường này quyết định giá dầu toàn cầu. "
    "Shakespeare từng viết về biển, nhưng ông chưa bao giờ nhìn thấy eo biển Suez."
)


@router.get("/options")
def list_tts_options(db: Annotated[Session, Depends(get_db)]):
    return tts_settings_payload(db)


@router.get("/preview")
def preview_tts(
    engine: Annotated[str, Query()] = "neural2",
    gender: Annotated[str, Query()] = "male",
    text: Annotated[str, Query()] = DEFAULT_COMPARE_TEXT,
    chirp_persona: Annotated[str, Query()] = "",
):
    settings = get_settings()
    if not settings.google_tts_enabled:
        raise HTTPException(status_code=503, detail="Cloud narration is not configured.")

    cleaned = tts.normalize_for_speech(text)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Text is empty.")

    try:
        voice = tts.resolve_voice(engine, gender, chirp_persona=chirp_persona)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    digest = hashlib.sha256(
        f"{tts.TTS_CACHE_VERSION}\0preview\0{voice}\0{cleaned}".encode()
    ).hexdigest()
    path = Path(settings.resolved_tts_cache_dir) / "preview" / digest[:2] / f"{digest}.mp3"
    if not path.is_file():
        try:
            audio = tts.synthesize_text(voice, cleaned)
        except (DefaultCredentialsError, GoogleAPICallError, OSError) as exc:
            logger.exception("Could not synthesize TTS preview for %s", voice)
            raise HTTPException(
                status_code=503,
                detail="Cloud narration is temporarily unavailable.",
            ) from exc
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(audio)

    return FileResponse(
        path,
        media_type="audio/mpeg",
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.get("/compare", response_class=HTMLResponse)
def compare_tts_page(
    db: Annotated[Session, Depends(get_db)],
    text: Annotated[str, Query()] = DEFAULT_COMPARE_TEXT,
):
    settings = get_settings()
    active = get_active_tts(db)
    escaped_text = html.escape(text)
    quoted_text = quote(text, safe="")
    active_voice = active.voice

    cards: list[str] = []
    for option in tts.voice_options():
        engine = option["engine"]
        gender = option["gender"]
        voice = option["voice"]
        label = option["engine_label"]
        is_active = voice == active_voice
        badge = '<span class="badge">đang dùng</span>' if is_active else ""
        src = f"/api/tts/preview?engine={engine}&gender={gender}&text={quoted_text}"
        cards.append(
            f"""
            <article class="card{' active' if is_active else ''}">
              <header>
                <div>
                  <h2>{html.escape(label)}</h2>
                  <p>{html.escape(gender)} · <code>{html.escape(voice)}</code></p>
                </div>
                {badge}
              </header>
              <audio controls preload="none" src="{src}"></audio>
            </article>
            """
        )

    chirp_cards: list[str] = []
    for gender, personas in tts.CHIRP3_PERSONAS.items():
        for persona in personas:
            voice = f"vi-VN-Chirp3-HD-{persona}"
            is_active = voice == active_voice
            badge = '<span class="badge">đang dùng</span>' if is_active else ""
            src = (
                f"/api/tts/preview?engine=chirp3&gender={gender}"
                f"&chirp_persona={persona}&text={quoted_text}"
            )
            chirp_cards.append(
                f"""
                <article class="card compact{' active' if is_active else ''}">
                  <header>
                    <div>
                      <h3>{html.escape(persona)}</h3>
                      <p>{html.escape(gender)}</p>
                    </div>
                    {badge}
                  </header>
                  <audio controls preload="none" src="{src}"></audio>
                </article>
                """
            )

    return f"""<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Read · TTS compare</title>
  <style>
    :root {{
      --bg: #f3efe6;
      --ink: #1c1915;
      --muted: #6b645a;
      --line: #d9d0c1;
      --card: #fffdf8;
      --accent: #0f5c4c;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, #fff8e8, transparent 40%),
        linear-gradient(180deg, #efe7d8, var(--bg));
      min-height: 100vh;
    }}
    main {{
      width: min(980px, calc(100% - 2rem));
      margin: 0 auto;
      padding: 2.5rem 0 4rem;
    }}
    h1 {{
      font-size: clamp(2rem, 4vw, 3rem);
      margin: 0 0 0.4rem;
      letter-spacing: -0.03em;
    }}
    .lede {{
      color: var(--muted);
      max-width: 42rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }}
    .sample {{
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 1rem 1.1rem;
      margin-bottom: 1.75rem;
      line-height: 1.55;
    }}
    .meta {{
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 0.95rem;
      margin-bottom: 1.5rem;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem;
      margin-bottom: 2.5rem;
    }}
    .card {{
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 1rem;
      display: grid;
      gap: 0.85rem;
    }}
    .card.active {{
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }}
    .card header {{
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      align-items: start;
    }}
    .card h2, .card h3 {{
      margin: 0;
      font-size: 1.15rem;
    }}
    .card p {{
      margin: 0.25rem 0 0;
      color: var(--muted);
      font-size: 0.92rem;
    }}
    code {{
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
    }}
    audio {{ width: 100%; }}
    .badge {{
      background: var(--accent);
      color: white;
      border-radius: 999px;
      padding: 0.2rem 0.55rem;
      font-size: 0.75rem;
      white-space: nowrap;
    }}
    h2.section {{
      margin: 0 0 0.75rem;
      font-size: 1.35rem;
    }}
    form {{
      display: grid;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }}
    textarea {{
      width: 100%;
      min-height: 7rem;
      border-radius: 14px;
      border: 1px solid var(--line);
      padding: 0.9rem 1rem;
      font: inherit;
      background: white;
      resize: vertical;
    }}
    button {{
      justify-self: start;
      background: var(--accent);
      color: white;
      border: 0;
      border-radius: 999px;
      padding: 0.7rem 1.1rem;
      font: inherit;
      cursor: pointer;
    }}
  </style>
</head>
<body>
  <main>
    <h1>So sánh TTS</h1>
    <p class="lede">
      Nghe cùng một đoạn qua Standard, WaveNet, Neural2 và Chirp3 HD
      (nam / nữ). Đổi text bên dưới rồi reload để so phát âm từ nước ngoài.
    </p>
    <form method="get" action="/api/tts/compare">
      <textarea name="text">{escaped_text}</textarea>
      <button type="submit">Tạo bản so sánh</button>
    </form>
    <div class="meta">
      <span>Config hiện tại: <code>{html.escape(active.engine)}</code>
      / <code>{html.escape(active.gender)}</code>
      · <code>{html.escape(active.source)}</code></span>
      <span>Voice: <code>{html.escape(active_voice)}</code></span>
      <span>Enabled: <code>{str(settings.google_tts_enabled).lower()}</code></span>
    </div>
    <div class="sample">{escaped_text}</div>
    <h2 class="section">Engine × gender (mặc định)</h2>
    <div class="grid">
      {''.join(cards)}
    </div>
    <h2 class="section">Chirp3 HD · toàn bộ persona</h2>
    <div class="grid">
      {''.join(chirp_cards)}
    </div>
  </main>
</body>
</html>
"""
