# FoodAnalyzer — Architecture

AI-powered Thai-food detection and nutritional analysis. A React Native
mobile client photographs food; a FastAPI backend runs YOLO detection,
enriches results with nutrition data, scores healthiness, and tracks meals
against per-user TDEE targets.

> Diagrams are monospace ASCII — best viewed in a fixed-width renderer.

---

## 1. System overview

```
 ┌──────────────────────┐        ┌─────────┐         ┌──────────────────────────┐
 │   Mobile (Expo/RN)   │        │  Nginx  │         │   Backend (FastAPI)      │
 │                      │  HTTPS │ reverse │  HTTP   │                          │
 │  5 screens           ├───────►│ proxy   ├────────►│  main.py (lifespan)      │
 │  services/api.ts     │  JSON  │ 10MB    │  :8000  │   ├─ api/  (6 routers)   │
 │  JWT in SecureStore  │        │ upload  │         │   ├─ core/ (services)    │
 └──────────┬───────────┘        └─────────┘         │   ├─ models/ (YOLO .onnx)│
            │                                         │   ├─ data/ (food+nutrition JSON)
            │ JWT bearer / multipart image            │   └─ food_analyzer.db (SQLite)
            │                                         └────────────┬─────────────┘
            │                                                      │
            │                                          fallback ───► Open Food Facts API
            │                                          (unknown foods only)
```

- **Mobile** → **Nginx** over HTTP/HTTPS; Nginx terminates and proxies to the
  FastAPI app on port 8000. The 10MB body limit in `nginx.conf` matches
  `config.yaml: server.max_upload_size_mb`.
- The backend talks to the **Open Food Facts** API only as a *fallback* when a
  detected food has no entry in the local `nutrition_db.json`.
- `main.py` loads the YOLO model once at startup via the FastAPI `lifespan`
  and stashes it on `app.state.model_manager` for reuse across requests.

---

## 2. Primary request flow — `POST /api/v1/analyze`

The central feature: a photo in, structured nutrition out.

```
 ScanScreen          services/api.ts            FastAPI  (api/analyze.py)
 ───────────         ────────────────           ──────────────────────────
 camera/pick ──►  analyzeImage(uri)
                   XHR multipart POST ───────►  analyze_image()
                     'file' = image                 │
                     Bearer <jwt> (if logged in)    ├─ validate image/*
                                                    ├─ PIL.Image → RGB
                                                    │
                                                    ▼
                                       ┌─────────────────────────────┐
                                       │ ModelManager.predict(image) │  ◄── YOLO (ONNX Runtime)
                                       │  preprocess → infer → NMS   │      per-class IoU NMS
                                       └─────────────┬───────────────┘
                                                     │ detections
                                                     ▼
                                       per detection ──────────────────────────┐
                                       ┌──────────────────────────┐            │
                                       │ NutritionService         │  local db  │  fallback (async)
                                       │  .get_nutrition(name) ───┤ first  ────┼──► Open Food Facts
                                       │  .compute_health_score() │            │
                                       │  .estimate_serving_g()   │            │
                                       │  .get_tags() / .get_gi() │            │
                                       └─────────────┬────────────┘            │
                                                     │  DetectedFood list        │
                                                     ▼                            │
                                       _compute_totals() → meal totals           │
                                                     │                            │
                                        ┌────────────┴───────────┐                │
                                        ▼ logged in?             ▼ no            │
                                  INSERT MealLog             (skip persist)      │
                                        │                                       │
                                        ▼                                       │
                       AnalyzeResponse { foods[], scan_id, timestamp } ──────────┘
                                                     │
 ResultScreen ◄──── navigate('Result', { result }) ◄┘
   food cards · macros · health score · totals
```

**Notes**
- The image is processed **in memory only** — never written to disk (privacy by
  design; the comment in `analyze.py` calls this out explicitly).
- `analyze` uses **optional auth**: scanning works anonymously; the meal is
  auto-saved to history only when a valid token is supplied.
- NMS is **per-class IoU-based** (see `model_manager.py`), so two separate
  portions of the same dish are detected as distinct items.

---

## 3. Backend layers

`main.py` → `api/` (HTTP) → `core/` (services) → persistence. Clean layered
separation: routers hold no business logic, services hold no HTTP concerns.

```
                          ┌───────────────────────────────────────────────┐
   HTTP boundary          │                     api/                      │   core/auth.py
   (FastAPI routers)      │  analyze  foods  history  profile  summary    │   (deps: get_current_user,
                          │                                admin          │    get_admin_user)
                          └────────────────────────┬──────────────────────┘
                                                   │ depends on
                          ┌────────────────────────▼──────────────────────┐
   Services               │                    core/                       │
   (business logic)       │  model_manager  nutrition   auth(jwt+bcrypt)   │
                          │  schemas        config     database            │
                          └──────┬─────────────────┬───────────────────────┘
                                 │                 │
                      ┌──────────▼────┐    ┌───────▼──────────┐
   State / data       │ app.state      │    │ SQLAlchemy ORM    │
                      │ .config        │    │ core/models.py    │──► food_analyzer.db
                      │ .model_manager │    │ User MealLog ...  │    (SQLite)
                      │ .base_dir      │    └───────────────────┘
                      └────────────────┘
```

| Router (prefix) | Endpoints | Auth |
|---|---|---|
| `analyze` `/api/v1` | `POST /analyze` | optional |
| `foods` `/api/v1` | `GET /foods`, `GET /foods/{id}` | none |
| `history` `/api/v1` | `GET / POST / DELETE /history` | required |
| `profile` `/api/v1` | `POST /auth/{register,login,refresh}`, `GET/PUT /profile` | mixed |
| `summary` `/api/v1` | `GET /daily-summary`, `GET /weekly-report` | required |
| `admin` `/api/admin` | `GET /model-info`, `POST /update-model` | admin |

`app.state` (populated in `lifespan`) carries the singletons each request needs
without re-loading the model or re-reading config per call.

---

## 4. Data model

Four tables in `core/models.py`. **Relationships are logical, not enforced** —
the ORM uses `Integer` FK columns with `index=True` but no `ForeignKey(...)`
constraint, so referential integrity is the application's responsibility.

```
 ┌─────────────────────────┐         ┌──────────────────────────────┐
 │         User            │         │          MealLog             │
 ├─────────────────────────┤         ├──────────────────────────────┤
 │ id          PK          │ 1     N │ id            PK             │
 │ email       UNIQUE      │◄────────┤ user_id       IDX ──► User.id│
 │ hashed_password         │ logical │ timestamp                    │
 │ weight_kg, height_cm,   │   (no   │ scan_id       IDX            │
 │ age, activity_level,    │  FK in  │ foods_json    (detected +    │
 │ goal, dietary_mode      │   ORM)  │                nutrition)    │
 │ allergens   JSON        │         │ totals_json   (aggregated)   │
 │ is_admin    bool        │         └──────────────────────────────┘
 │ created_at, updated_at  │
 └─────────────────────────┘

 ┌─────────────────────────┐         ┌──────────────────────────────┐
 │       FoodItem          │         │        ModelVersion          │
 ├─────────────────────────┤         ├──────────────────────────────┤
 │ id            PK        │         │ id            PK             │
 │ yolo_class_id UNIQUE    │         │ version_tag                  │
 │ name                    │         │ pt_path                      │
 │ nutrition_json  per-100g│         │ class_count                  │
 │ health_score            │         │ uploaded_at                  │
 │ tags, allergens  JSON   │         │ is_active      bool          │
 └─────────────────────────┘         └──────────────────────────────┘
```

- `MealLog.foods_json` stores a **snapshot** of each detected food with its
  nutrition, so historical meals remain accurate even if the nutrition DB or
  model changes later.
- `FoodItem` mirrors the static `nutrition_db.json`; the app currently reads
  nutrition straight from the JSON via `NutritionService`, so `FoodItem` rows
  are largely a forward-looking schema.
- `ModelVersion` is the audit trail written by the admin hot-swap endpoint.

---

## 5. Auth flow (JWT access + refresh)

```
 register / login ──► server issues BOTH tokens
        │
        ▼
 ┌─────────────┐  30 min ──┐
 │ access_token│  expiry    │  sent as:  Authorization: Bearer <token>
 └─────────────┘            │
        │                   │  on 401 (expired):
        │                   └─► api.ts auto-calls /auth/refresh ──┐
        │                                                          │
 ┌──────────────┐  7 day                                          │
 │refresh_token │  expiry ────────────────────────────────────────┘
 └──────────────┘
```

- `core/auth.py` signs with `HS256` using the secret from `config.yaml`
  (`auth.secret_key`); tokens carry `sub` (user id) + `type` (access/refresh).
- The mobile client stores both tokens in `expo-secure-store` and transparently
  refreshes on a 401, retrying the original request once (`api.ts: request()`).
- Two dependency guards: `get_current_user` (any user) and `get_admin_user`
  (requires `User.is_admin`).

---

## 6. Model hot-swap flow (admin only)

Allows deploying a new YOLO model without restarting the server.

```
 admin POST /api/admin/update-model   (file + version)
        │
        ▼
 ModelManager.hot_swap(new_model_path, version):
   1. validate   ── load new model into a throwaway ModelManager; fail fast if bad
   2. backup     ── copy current model → models/backup/best_<ver>_<ts>.onnx
   3. rotate     ── delete oldest beyond backup.max_versions (config.yaml)
   4. replace    ── copy new model into models/best.onnx
   5. reload     ── under self.lock, reload into the live ONNX session
        │
        ▼
 update config.yaml version  +  INSERT ModelVersion(is_active=true),
                               mark all others inactive
```

`ModelManager.lock` serializes inference against reload, so an in-flight
`predict()` is never interrupted mid-swap.

---

## 7. Nutrition health score

For reference, the formula in `core/nutrition.py:compute_health_score()`
(all values per 100 g):

```
 score = 50
        + fiber_g        × 3
        + protein_g       × 2
        + vitamin_score   × 2     (C + A, each normalized 0–5, capped at 5)
        − saturated_fat_g × 3
        − sugar_g         × 2
        − (sodium_mg / 100) × 1.5

 clamp 0–100   →   ≤40 "Limit"   ·   ≤70 "Moderate"   ·   else "Excellent"
```

Daily TDEE targets use the Mifflin–St Jeor equation with an activity
multiplier and a goal-based ±adjustment (`api/profile.py` /
`api/summary.py`).
