"""Shared Gemini generateContent helper."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import Settings

logger = logging.getLogger(__name__)


def gemini_available(settings: Settings) -> bool:
    return bool(settings.ai_explain_enabled and settings.gemini_api_key.strip())


def extract_gemini_text(data: dict) -> str:
    """Join answer parts, skipping the thought parts that 3.x models may emit."""
    candidates = data.get("candidates") or []
    if not candidates:
        return ""
    parts = (candidates[0].get("content") or {}).get("parts") or []
    chunks = [
        part["text"]
        for part in parts
        if isinstance(part, dict) and part.get("text") and not part.get("thought")
    ]
    return "\n".join(chunks).strip()


async def generate_gemini_text(
    *,
    settings: Settings,
    system: str,
    user: str,
    temperature: float = 0.2,
    max_output_tokens: int = 300,
    timeout: float = 20.0,
    response_mime_type: str | None = None,
) -> str:
    """Call Gemini generateContent. Raises on HTTP/network failure; returns '' on empty."""
    if not gemini_available(settings):
        raise RuntimeError("Gemini is not configured.")

    url = (
        f"{settings.gemini_base_url.rstrip('/')}"
        f"/models/{settings.gemini_model}:generateContent"
    )
    headers = {
        "x-goog-api-key": settings.gemini_api_key.strip(),
        "Content-Type": "application/json",
    }
    generation_config: dict[str, Any] = {
        "temperature": temperature,
        "maxOutputTokens": max_output_tokens,
    }
    if response_mime_type:
        generation_config["responseMimeType"] = response_mime_type

    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": generation_config,
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, headers=headers, json=body)
        response.raise_for_status()
        return extract_gemini_text(response.json())
