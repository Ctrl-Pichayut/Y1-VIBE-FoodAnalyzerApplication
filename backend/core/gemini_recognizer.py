"""
Gemini food recognition layer — a hybrid companion to the YOLO model.

Wraps the official `google-genai` SDK. Recognizes dishes in an image and, for
dishes not present in the curated nutrition_db.json, estimates a nutrition
breakdown. All network calls degrade gracefully: on rate limits (429), quota
errors, or any API failure the methods return an empty/None result and log a
warning rather than raising, so the analyze pipeline can fall back to YOLO.

The API key is read from the GEMINI_API_KEY environment variable only — never
hardcoded. If the key is absent, the recognizer reports `enabled=False` and the
analyze pipeline skips Gemini entirely (useful for fully-offline / YOLO-only
mode set via config.yaml: recognition.mode = "yolo").
"""

from typing import List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Structured-output schemas (sent to Gemini as response_json_schema)
# ---------------------------------------------------------------------------
class GeminiDish(BaseModel):
    """One recognized dish, as returned by Gemini's first (recognition) call."""
    dish_name: str = Field(description="Canonical English name of the dish")
    dish_name_thai: Optional[str] = Field(
        default=None, description="Thai script name of the dish, if applicable"
    )
    confidence: float = Field(
        ge=0.0, le=1.0, description="Model's confidence this dish is present, 0..1"
    )
    estimated_serving_g: int = Field(
        ge=0, description="Typical single-serving size in grams visible in the image"
    )
    is_thai_dish: bool = Field(description="True if this is a Thai/SE-Asian dish")


class GeminiNutrition(BaseModel):
    """Estimated per-100g nutrition, same keys as nutrition_db.json entries."""
    calories: float = 0
    protein: float = 0
    fat: float = 0
    carbs: float = 0
    fiber: float = 0
    sugar: float = 0
    sodium_mg: float = 0
    vitamin_c_mg: float = 0
    saturated_fat_g: float = 0


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
_RECOGNIZE_PROMPT = (
    "You are a food-recognition expert specializing in Thai and Southeast Asian cuisine. "
    "Identify EVERY distinct dish visible in this image. For each dish, give its canonical "
    "English name, the Thai script name (or null if not Thai), your confidence (0..1), an "
    "estimated typical serving size in grams, and whether it is a Thai dish. "
    "Return a JSON array of objects. If no food is visible, return an empty array []. "
    "Be specific with names (e.g. 'Pad Thai', 'Green Papaya Salad', 'Tom Yum Goong')."
)

_NUTRITION_PROMPT = (
    "You are a nutrition database. Estimate the nutritional profile per 100g for the dish "
    "named below, based on standard food composition tables. Return a single JSON object "
    "with these fields: calories, protein, fat, carbs, fiber, sugar (all in grams except "
    "calories in kcal), sodium_mg (in mg), vitamin_c_mg (in mg), saturated_fat_g (in grams). "
    "Use realistic average values for a typical preparation. Dish: "
)


class GeminiRecognizer:
    """
    Thin async wrapper over the google-genai SDK.

    - `enabled` reflects whether the API key was provided. The analyze
      pipeline checks this before issuing any Gemini call.
    - Every public method is total: it never raises on API errors (rate
      limits, network, malformed JSON). It logs and returns a safe empty.
    """

    def __init__(self, config: dict, api_key: Optional[str]):
        import os
        self.config = config
        self.enabled = bool(api_key)
        self._client = None
        self._model = os.getenv("GEMINI_MODEL") or config.get("recognition", {}).get("model", "gemini-3.5-flash-lite")

        if not self.enabled:
            print("[Gemini] disabled — no GEMINI_API_KEY set (YOLO-only mode)")
            return

        try:
            # Imported lazily so the module can be constructed (and the app
            # booted) even when the SDK isn't installed, e.g. in yolo mode.
            from google import genai
        except ImportError as e:
            print(f"[Gemini] disabled — google-genai not installed ({e}). "
                  f"Run: pip install google-genai")
            self.enabled = False
            return

        try:
            self._client = genai.Client(api_key=api_key)
            print(f"[Gemini] enabled — model={self._model}")
        except Exception as e:
            # Bad key shape, etc. — degrade rather than crash on startup.
            print(f"[Gemini] disabled — client init failed: {e}")
            self.enabled = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    async def recognize(self, image_bytes: bytes, mime_type: str) -> List[GeminiDish]:
        """Recognize all dishes in an image. Returns [] on any failure."""
        if not self.enabled:
            return []
        return await self._safe_call(
            self._do_recognize(image_bytes, mime_type), default=[]
        )

    async def estimate_nutrition(self, dish_name: str) -> Optional[GeminiNutrition]:
        """Estimate per-100g nutrition for a dish name. Returns None on failure."""
        if not self.enabled:
            return None
        return await self._safe_call(
            self._do_estimate(dish_name), default=None
        )

    # ------------------------------------------------------------------
    # SDK calls
    # ------------------------------------------------------------------
    async def _do_recognize(self, image_bytes: bytes, mime_type: str) -> List[GeminiDish]:
        from google import genai  # for types.Part below
        from google.genai import types

        # Build multimodal request: text prompt + image part
        contents = [
            _RECOGNIZE_PROMPT,
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        ]

        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiDish,
            ),
        )

        # The SDK parses the constrained JSON for us; the parsed object(s)
        # land on `response.parsed`. Schema=GeminiDish (single) but we asked
        # for an array in the prompt — wrap/unwrap defensively.
        return _parse_dish_array(response)

    async def _do_estimate(self, dish_name: str) -> Optional[GeminiNutrition]:
        from google.genai import types

        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=_NUTRITION_PROMPT + dish_name,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiNutrition,
            ),
        )

        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, GeminiNutrition):
            return parsed
        # Fallback: parse the raw text
        if response.text:
            try:
                return GeminiNutrition.model_validate_json(response.text)
            except Exception:
                return None
        return None

    # ------------------------------------------------------------------
    # Error isolation
    # ------------------------------------------------------------------
    async def _safe_call(self, coro, default):
        """Run a Gemini coroutine; on any API error, log and return `default`.

        Specifically handles 429 (rate limit) and 500/503 (server) by surfacing
        a clear message, but catches everything so the analyze endpoint never
        crashes because of Gemini.

        Enforces a 25-second timeout per call — if Gemini is slow, the pipeline
        falls back instead of blocking for minutes.
        """
        import asyncio
        try:
            timeout = self.config.get("recognition", {}).get("request_timeout", 25)
            return await asyncio.wait_for(coro, timeout=timeout)
        except asyncio.TimeoutError:
            print(f"[Gemini] timed out after {self.config.get('recognition', {}).get('request_timeout', 25)}s — falling back")
            return default
        except Exception as e:
            code = _error_code(e)
            if code == 429:
                print(f"[Gemini] rate limited (429) — falling back. {e}")
            elif code in (500, 503):
                print(f"[Gemini] server error ({code}) — falling back. {e}")
            else:
                print(f"[Gemini] request failed (code={code}) — falling back. {e}")
            return default


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _error_code(exc: Exception) -> Optional[int]:
    """Best-effort extraction of an HTTP-style status code from a genai error."""
    # google-genai exposes errors as google.genai.errors.APIError with a .code,
    # but third-party/transport errors may wrap it. Check common attributes.
    for attr in ("code", "status_code"):
        val = getattr(exc, attr, None)
        if isinstance(val, int):
            return val
    msg = str(exc)
    for token in ("429", "500", "503", "400", "401", "403"):
        if token in msg:
            return int(token)
    return None


def _parse_dish_array(response) -> List[GeminiDish]:
    """Normalize whatever the SDK returns into a list of GeminiDish.

    With response_schema=GeminiDish the SDK usually returns a single object,
    but our prompt asks for an array, so handle both single and list shapes
    defensively. Falls back to parsing raw text if `parsed` is absent.
    """
    parsed = getattr(response, "parsed", None)

    # Already a list of GeminiDish
    if isinstance(parsed, list):
        return [d for d in parsed if isinstance(d, GeminiDish)]
    # Single GeminiDish
    if isinstance(parsed, GeminiDish):
        return [parsed]

    # Fallback: parse raw text
    text = getattr(response, "text", None) or ""
    if not text:
        return []
    import json
    try:
        data = json.loads(text)
    except Exception:
        return []
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        return []
    out = []
    for item in data:
        try:
            out.append(GeminiDish.model_validate(item))
        except Exception:
            continue
    return out
