<p align="center">
  <h1 align="center">🍜 Food Intelligence Analyzer</h1>
  <p align="center">
    AI-powered food detection & nutritional analysis — snap a photo, get instant nutrition data.
    <br />
    <a href="docs/ARCHITECTURE.md"><strong>Architecture »</strong></a>
    ·
    <a href="docs/DEPLOYMENT.md"><strong>Deployment »</strong></a>
    ·
    <a href="https://github.com/Ctrl-Pichayut/Y1-VIBE-FoodAnalyzerApplication/issues"><strong>Report Bug »</strong></a>
  </p>
</p>

---

## What is this?

Food Intelligence Analyzer is a mobile app that identifies food from photos and returns detailed nutritional information. Point your camera at a meal, and the app will:

1. **Detect** every dish in the frame (supports 157 Thai & international food classes)
2. **Look up** calories, protein, fat, carbs, fiber, and more per 100g
3. **Score** each dish's healthiness on a 0–100 scale
4. **Track** your daily intake against personalized TDEE goals

It uses a **hybrid AI engine** — a custom-trained YOLOv8 model runs first for speed, and Google Gemini handles anything the local model isn't confident about.

## How it works

```
┌─────────────┐     image      ┌──────────────────────────────────────────────┐
│  Mobile App  │ ────────────► │  FastAPI Backend                             │
│  (Expo)      │               │                                              │
│              │               │  ┌──────────┐   low conf   ┌─────────────┐  │
│              │               │  │ YOLOv8n  │ ───────────► │ Gemini 2.5  │  │
│              │               │  │ (ONNX)   │              │   Flash     │  │
│              │               │  └────┬─────┘              └──────┬──────┘  │
│              │               │       │ dish names                │         │
│              │               │       ▼                           ▼         │
│              │   nutrition   │  ┌────────────────────────────────────────┐  │
│              │ ◄──────────── │  │ Nutrition DB (157 dishes + fallbacks) │  │
│              │    + scores   │  └────────────────────────────────────────┘  │
└─────────────┘               └──────────────────────────────────────────────┘
```

### Recognition modes (set in `config.yaml`)

| Mode | Behavior | Best for |
|------|----------|----------|
| `yolo` | Local YOLO model only — fast, offline, deterministic | Known dishes, no API costs |
| `gemini` | Gemini Vision API only — broad coverage | Any cuisine, high accuracy |
| `hybrid` | YOLO first → Gemini fallback on low confidence | **Default** — best of both |

### Nutrition resolution tiers

| Priority | Source | Verified? |
|----------|--------|-----------|
| Tier 0 | Admin-promoted review (Postgres) | ✅ Yes |
| Tier 1 | Exact match in `nutrition_db.json` | ✅ Yes |
| Tier 2 | Fuzzy match in `nutrition_db.json` | ✅ Yes |
| Tier 3 | Gemini AI estimate (auto-queued for admin review) | ❌ Estimate |

## Features

**For users:**
- 📸 Scan food with camera or pick from gallery
- 📊 Per-dish macros: calories, protein, fat, carbs, fiber, sugar, sodium
- 🏥 Health score (0–100) with color-coded labels
- 📈 Daily tracking with TDEE-based targets (Mifflin-St Jeor equation)
- 📋 Meal history with weekly reports
- 🔐 JWT authentication (access + refresh tokens)

**For admins:**
- ✅ Review queue — promote or reject Gemini estimates into the verified database
- 🔄 Hot-swap YOLO models without server restart
- 📊 Review stats dashboard (pending / promoted / rejected counts)

## Tech stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native 0.85, Expo SDK 56, TypeScript |
| Backend | Python 3.11+, FastAPI, SQLAlchemy |
| AI/ML | YOLOv8n (ONNX Runtime), Google Gemini 2.5 Flash |
| Database | SQLite (dev) / PostgreSQL via Supabase (prod) |
| Hosting | Render (backend), EAS Build (APK) |

## Project structure

```
FoodAnalyzer/
├── backend/
│   ├── main.py              # FastAPI entry point + lifespan
│   ├── config.yaml          # All settings (model, auth, DB, recognition mode)
│   ├── .env.example         # Secret env vars (GEMINI_API_KEY, DATABASE_URL)
│   ├── api/
│   │   ├── analyze.py       # POST /api/v1/analyze — image → nutrition
│   │   ├── profile.py       # Auth (register/login) + user profile + TDEE
│   │   ├── history.py       # Meal log CRUD
│   │   ├── summary.py       # Daily/weekly nutrition summaries
│   │   ├── foods.py         # Browse food database
│   │   └── admin.py         # Model hot-swap + review queue
│   ├── core/
│   │   ├── model_manager.py # YOLO/ONNX loading + inference
│   │   ├── gemini_recognizer.py  # Gemini Vision integration
│   │   ├── nutrition.py     # Nutrition lookup + health scoring
│   │   ├── auth.py          # JWT + bcrypt password hashing
│   │   ├── models.py        # SQLAlchemy ORM (User, MealLog, NutritionReview)
│   │   ├── schemas.py       # Pydantic request/response models
│   │   ├── database.py      # DB engine + session management
│   │   └── config.py        # YAML config loader
│   ├── data/
│   │   ├── food_classes.json     # 157 YOLO class names
│   │   └── nutrition_db.json     # Curated per-100g nutrition data
│   └── models/
│       ├── best.onnx        # Trained YOLOv8n ONNX model (13.7 MB)
│       └── best.pt          # Trained YOLOv8n PyTorch weights (6.9 MB)
│
├── mobile/
│   ├── App.tsx              # Navigation (Home → Scan → History → Profile → Admin)
│   ├── screens/
│   │   ├── HomeScreen.tsx   # Dashboard with daily progress + quick scan
│   │   ├── ScanScreen.tsx   # Camera capture + gallery picker
│   │   ├── ResultScreen.tsx # Detection results + macro grid + health scores
│   │   ├── HistoryScreen.tsx    # Paginated meal journal
│   │   ├── ProfileScreen.tsx    # Auth, body stats, TDEE settings
│   │   └── AdminScreen.tsx      # Review queue (admin only, hidden for users)
│   ├── services/api.ts      # API client with JWT management + cold-start retry
│   ├── components/AppModal.tsx  # Reusable confirmation/error modal
│   └── theme/tokens.ts      # Design tokens (colors, spacing, typography)
│
├── docs/
│   ├── ARCHITECTURE.md      # System design deep-dive
│   └── DEPLOYMENT.md        # Production deployment guide
├── docker-compose.yml
└── nginx.conf
```

## Getting started

### Prerequisites

- **Python 3.11+** (3.14 works too)
- **Node.js 18+**
- **Expo Go** app on your phone ([Android](https://play.google.com/store/apps/details?id=host.exp.exponent) / [iOS](https://apps.apple.com/app/expo-go/id982107779))

### 1. Backend

```bash
cd backend

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# (Optional) Set up Gemini for hybrid mode
# Copy .env.example → .env and add your GEMINI_API_KEY
# Without it, the app runs in YOLO-only mode automatically

# Start the server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The server starts at `http://localhost:8000`. API docs are at `/docs`.

### 2. Mobile

```bash
cd mobile

# Install dependencies
npm install

# Update API URL for your network
# Edit services/api.ts → set DEV_BASE_URL to your computer's local IP
# Example: const DEV_BASE_URL = 'http://192.168.1.45:8000';

# Start Expo
npx expo start

# If your phone and computer are on different networks:
npx expo start --tunnel
```

Scan the QR code with Expo Go to run on your phone.

### 3. First run checklist

- [ ] Backend shows `[OK] Model loaded: ... (157 classes)`
- [ ] Open `http://<YOUR_IP>:8000/docs` to verify API is running
- [ ] Mobile app connects and the Home screen loads
- [ ] Camera permission granted → scan a food item
- [ ] Create an account on the Profile tab

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/analyze` | Optional | Upload image → food detection + nutrition |
| `POST` | `/api/v1/auth/register` | No | Create account |
| `POST` | `/api/v1/auth/login` | No | Get JWT tokens |
| `POST` | `/api/v1/auth/refresh` | No | Refresh access token |
| `GET` | `/api/v1/profile` | Yes | User profile + TDEE targets |
| `PUT` | `/api/v1/profile` | Yes | Update body stats / goals |
| `GET` | `/api/v1/history` | Yes | Paginated meal history |
| `POST` | `/api/v1/history` | Yes | Log a meal manually |
| `DELETE` | `/api/v1/history/{id}` | Yes | Delete a meal log |
| `GET` | `/api/v1/daily-summary` | Yes | Today's intake vs targets |
| `GET` | `/api/v1/weekly-report` | Yes | 7-day nutrition report |
| `GET` | `/api/v1/foods` | Yes | Browse food database |
| `GET` | `/api/admin/review-queue` | Admin | Pending Gemini estimates |
| `POST` | `/api/admin/review/{id}` | Admin | Promote or reject an estimate |
| `GET` | `/api/admin/review-queue/stats` | Admin | Review counts by status |
| `GET` | `/api/admin/model-info` | Admin | Current model version |
| `POST` | `/api/admin/update-model` | Admin | Upload new YOLO model |

## Configuration

All settings live in `backend/config.yaml` — no code changes needed to switch modes:

```yaml
# Switch recognition mode
recognition:
  mode: "hybrid"               # "yolo" | "gemini" | "hybrid"
  confidence_threshold: 0.65   # hybrid: YOLO → Gemini below this

# Add yourself as admin (then re-login)
auth:
  admin_emails:
    - "your-email@example.com"

# Switch to PostgreSQL for production
database:
  url: "postgresql://user:pass@host:5432/dbname"
```

Secrets go in `backend/.env` (copied from `backend/.env.example`, never committed):
```bash
GEMINI_API_KEY=your_key_here
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SECRET_KEY=your-random-secret-key
```

## Admin workflow

1. Add your email to `config.yaml` → `auth.admin_emails`
2. Register or log in → the **Admin** tab appears
3. Users scan food → Gemini estimates auto-queue as "pending"
4. Review each dish → edit nutrition if needed → **Promote** or **Reject**
5. Promoted dishes are used for all future scans (no more Gemini calls)

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production setup with Render + Supabase.

Quick summary:
- **Backend** → Deploy to [Render](https://render.com) (free tier works)
- **Database** → [Supabase](https://supabase.com) PostgreSQL (free tier)
- **Mobile APK** → `eas build --platform android --profile preview`

## Built with

- [FastAPI](https://fastapi.tiangolo.com/) — async Python web framework
- [Ultralytics YOLOv8](https://docs.ultralytics.com/) — object detection model
- [ONNX Runtime](https://onnxruntime.ai/) — optimized model inference
- [Google Gemini](https://ai.google.dev/) — vision AI fallback
- [React Native](https://reactnative.dev/) + [Expo](https://expo.dev/) — cross-platform mobile
- [SQLAlchemy](https://www.sqlalchemy.org/) — Python ORM
- [Supabase](https://supabase.com/) — managed PostgreSQL

## License

This project was built as a first-year university project. See [mobile/LICENSE](mobile/LICENSE) for details.
