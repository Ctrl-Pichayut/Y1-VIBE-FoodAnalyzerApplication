<p align="center">
  <h1 align="center">🍜 Food Intelligence Analyzer</h1>
  <p align="center">
    <strong>Production-grade, AI-powered food recognition & nutritional tracking mobile application</strong>
    <br />
    Combines edge-optimized YOLOv8 object detection with Google Gemini 2.5 Flash vision fallback for accurate macro calculation and dietary governance.
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/React%20Native-0.85-61DAFB?logo=react&logoColor=white" alt="React Native" />
    <img src="https://img.shields.io/badge/Expo%20SDK-56-000020?logo=expo&logoColor=white" alt="Expo" />
    <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/FastAPI-Python%203.11+-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
    <img src="https://img.shields.io/badge/YOLOv8-ONNX%20Runtime-00599C?logo=onnx&logoColor=white" alt="ONNX" />
    <img src="https://img.shields.io/badge/Google%20Gemini-2.5%20Flash-4285F4?logo=google&logoColor=white" alt="Gemini" />
    <img src="https://img.shields.io/badge/Database-PostgreSQL%20%7C%20Supabase-3ECF8E?logo=supabase&logoColor=white" alt="Supabase" />
    <img src="https://img.shields.io/badge/Deployment-Render%20%7C%20EAS%20Build-46E3B7?logo=render&logoColor=white" alt="Render" />
  </p>
  <p align="center">
    <a href="docs/ARCHITECTURE.md"><strong>Architecture Documentation »</strong></a>
    ·
    <a href="docs/DEPLOYMENT.md"><strong>Deployment Guide »</strong></a>
    ·
    <a href="#-standalone-mobile-apk-build"><strong>Build Standalone APK »</strong></a>
  </p>
</p>

---

## 🌟 Executive Overview

**Food Intelligence Analyzer** is a mobile application and cloud backend designed to simplify nutritional logging through automated computer vision. Rather than manually typing meals or searching through sprawling databases, users capture a photo of their plate to receive real-time object detection bounding boxes, dynamic serving size scaling, and nutritional breakdowns.

The system features a **two-tiered hybrid intelligence architecture**:
1. **Edge-Optimized Local Inference (Tier 1):** A custom-trained **YOLOv8n** model exported to **ONNX Runtime** performs sub-second multi-dish detection across 157 Thai and international culinary classes with zero cloud inference cost.
2. **Cloud Multimodal Vision Fallback (Tier 2):** When detection confidence drops below configurable thresholds or unfamiliar dishes are scanned, the system routes the frame to **Google Gemini 2.5 Flash** for open-vocabulary visual reasoning.
3. **Human-in-the-Loop Governance:** AI-estimated foods are queued in an admin review console where nutritional values can be audited and promoted into the verified PostgreSQL database.

---

## 📐 System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MOBILE CLIENT (React Native)                     │
│   Expo SDK 56 • TypeScript • Gesture Handler • Offline SecureStore       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                             Multipart Upload (1024px JPEG)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY & ENGINE (FastAPI)                     │
│  Lifespan Management • JWT Auth (HS256) • Cold-Start Warmup Interceptors│
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌───────────────────────────────┐     Confidence < 0.65               │
│   │   YOLOv8n ONNX Engine         │ ────────────────────────┐           │
│   │   157 Culinary Classes        │                         │           │
│   └──────────────┬────────────────┘                         ▼           │
│                  │ Detected                         ┌───────────────┐   │
│                  ▼ Labels                           │ Gemini 2.5    │   │
│   ┌──────────────────────────────────────────────┐  │ Flash Vision  │   │
│   │         Tiered Nutrition Resolver            │  └───────┬───────┘   │
│   │                                              │          │           │
│   │  • Tier 0: Admin Verified Cache              │ ◄────────┘ Estimated │
│   │  • Tier 1: Exact Match (nutrition_db.json)   │            Nutrition │
│   │  • Tier 2: Fuzzy String Match (difflib 0.75) │                      │
│   │  • Tier 3: AI Fallback (Auto-queued)         │                      │
│   └──────────────────────┬───────────────────────┘                      │
│                          │                                              │
└──────────────────────────┼──────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      PERSISTENCE & CLOUD PLATFORM                       │
│  Supabase PostgreSQL (Hosted) • SQLite (Local Dev) • Render Web Service │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Features

### 📸 Intelligent Scan & Inference Pipeline
- **Smart Camera Viewfinder:** Real-time hardware torch toggle, focus lifecycle pausing, and gallery photo picker.
- **Client-Side Compression:** Images automatically downsampled to 1024px JPEG at 70% quality via `expo-image-manipulator` prior to transmission, saving cellular bandwidth and reducing upload latency by ~80%.
- **Bounding Box Inspection:** Visual overlay of detected food items directly mapped onto the dish image with interactive click-to-scroll navigation.
- **Server Cold-Start Indicator:** Live seconds counter and progressive status toast informing users during cloud server wake-up cycles.

### ⚖️ Dynamic Portion Sizing & Macro Recalculation
- **Live Serving Weight Stepper:** Adjust serving weight continuously or select quick chips (**Small 150g**, **Regular 250g**, **Large 350g**).
- **Instant Macro Re-indexing:** Real-time recalculation of calories, protein, carbohydrates, fats, sodium, and dietary fiber based on active grams.
- **Standard 100g Reference Mode:** Toggle between total dish portion and standardized 100g nutritional facts.
- **Visual Macro Distribution Bar:** Proportional calorie breakdown (Carbs: 4 kcal/g, Protein: 4 kcal/g, Fat: 9 kcal/g).

### 🛡️ Data Provenance & Trust Badges
- **Verified vs. Estimated Badges:** Clear transparency tagging distinguishing verified database records (`✓ Verified`) from model estimates (`AI estimate`).
- **Low Confidence Alerts:** Amber visual advisories triggered when detection confidence falls below 60%.
- **"Wrong Dish?" Correction Modal:** Searchable modal enabling users to re-bind the photo to any verified database item on the fly.

### 📊 Health Tracking & Daily Analytics
- **Personalized TDEE Engine:** Mifflin-St Jeor equation factoring age, biological sex, height, weight, and activity multipliers.
- **Surplus / Deficit Budgeting:** "Calories Remaining" metric comparing current daily intake against metabolic target.
- **7-Day Calorie Trend Graph:** Interactive charting with empty state guidance.
- **Chronological Meal Journal:** Segmented into "Today", "Yesterday", and older dates with daily calorie subtotals.
- **Optimistic Deletion with 5-Second Undo:** Smooth meal removal featuring immediate UI updates and restorative toast snackbars.

### 🔐 Security & Administration
- **Token-Based Authentication:** JWT access tokens (30 min) and refresh tokens (7 days) secured on-device via `expo-secure-store`.
- **Admin Review Queue:** Web/mobile moderation queue allowing administrators to approve, edit, or reject AI-generated nutrition estimates.
- **Hot-Swappable Model Weights:** Admins can upload updated ONNX models via authenticated endpoint without service downtime.

---

## 🛠️ Technology Stack

| Domain | Technology | Description |
| :--- | :--- | :--- |
| **Mobile Client** | **React Native 0.85** | Mobile cross-platform framework |
| | **Expo SDK 56** | Native runtime, camera, splash, and secure store APIs |
| | **TypeScript 6.0** | Strict type-safety across all components and API layers |
| | **React Navigation 7** | Tab and native stack screen choreography |
| | **Gesture Handler** | High-performance touch and swipe gestures |
| **API Backend** | **FastAPI** | High-performance asynchronous Python REST framework |
| | **SQLAlchemy** | Object Relational Mapper for PostgreSQL / SQLite |
| | **Pydantic v2** | Strict request/response payload schema validation |
| | **bcrypt** | Salted cryptographic password hashing |
| **Machine Learning** | **YOLOv8n (Ultralytics)** | Custom fine-tuned lightweight convolutional model |
| | **ONNX Runtime** | Optimized CPU execution provider for embedded inference |
| | **Google Gemini 2.5 Flash** | Multimodal LLM vision fallback via Google GenAI SDK |
| **Cloud & DevOps** | **PostgreSQL (Supabase)** | Managed relational database with connection pooling |
| | **Render** | Dockerized cloud container web service |
| | **EAS Build** | Cloud compilation pipeline for production APK / AAB bundles |

---

## 📱 Standalone Mobile APK Build

To deploy and install this application directly onto an Android device **without using Expo Go QR codes**, use Expo Application Services (EAS) to compile a standalone `.apk` file:

### 1. Prerequisites
Ensure EAS CLI is installed and your Expo account is authenticated:
```bash
cd mobile
npx eas login
```

### 2. Build the Standalone APK
Execute the build command with the `preview` profile (configured in `eas.json` for APK output):
```bash
npx eas build -p android --profile preview
```

### 3. Install on Android
1. Once the EAS cloud build finishes (typically 3–5 minutes), a direct download URL and QR code will be printed to your terminal.
2. Download the `.apk` file directly to your Android device or scan the completion URL.
3. Open the file on your device and tap **Install** (enable *"Install unknown apps"* if prompted).
4. Launch **Food Intelligence** — the app connects directly to the production cloud backend without requiring computer tethering or Expo Go!

> **Local Build Alternative:**  
> If you have the Android SDK and build tools installed locally, you can also run:
> ```bash
> npx eas build -p android --profile preview --local
> ```

---

## 💻 Local Development Setup

### 1. Backend Setup

```bash
cd backend

# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate       # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables (copy from template)
cp .env.example .env

# Edit .env with your credentials:
# - GEMINI_API_KEY (optional, fallback operates in YOLO-only mode if omitted)
# - DATABASE_URL (optional, defaults to local SQLite if omitted)
# - SECRET_KEY (generate via: openssl rand -hex 32)

# Start the development server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
- API Documentation (Swagger UI): `http://localhost:8000/docs`
- Health check: `http://localhost:8000/api/health`

### 2. Mobile Setup

```bash
cd mobile

# Install dependencies
npm install

# (Optional) Connect to your local backend rather than the live cloud server:
cp .env.example .env
# Set EXPO_PUBLIC_USE_LOCAL=1 or specify your workstation's LAN IP:
# EXPO_PUBLIC_API_URL=http://192.168.1.XX:8000

# Start Expo development server
npx expo start
```

---

## 🔒 Security & Environment Configuration

This repository enforces strict credential separation. Secrets, database passwords, and API tokens are **never** committed to version control.

### Environment Variable Templates
- **Backend:** Refer to [`backend/.env.example`](backend/.env.example)
  - `GEMINI_API_KEY`: API key obtained from [Google AI Studio](https://aistudio.google.com/apikey).
  - `DATABASE_URL`: Standard PostgreSQL connection string (Supabase / Render).
  - `SECRET_KEY`: Cryptographic signing secret for JWT token creation.
- **Mobile:** Refer to [`mobile/.env.example`](mobile/.env.example)
  - `EXPO_PUBLIC_API_URL`: Custom API base endpoint (defaults to live Render cloud service).
  - `EXPO_PUBLIC_USE_LOCAL`: Set to `1` to route to `localhost:8000`.

---

## 📂 Project Directory Structure

```
├── backend/
│   ├── main.py                     # FastAPI application lifecycle & CORS middleware
│   ├── config.yaml                 # System configurations (thresholds, cache size, auth)
│   ├── .env.example                # Template for server-side secret variables
│   ├── api/                        # REST API routing modules
│   │   ├── analyze.py              # POST /api/v1/analyze (multipart image processing)
│   │   ├── profile.py              # Auth (register/login/refresh) & TDEE endpoints
│   │   ├── history.py              # Meal log CRUD endpoints
│   │   ├── summary.py              # Daily & weekly aggregated analytics
│   │   ├── foods.py                # Food taxonomy & search queries
│   │   └── admin.py                # Model weights update & review queue management
│   ├── core/                       # Core service and domain logic
│   │   ├── model_manager.py        # ONNX inference execution & class index mapping
│   │   ├── gemini_recognizer.py    # Google Gemini multimodal vision client
│   │   ├── nutrition.py            # Tiered nutrition resolution & health scoring
│   │   ├── auth.py                 # JWT token creation & bcrypt password hashing
│   │   ├── models.py               # SQLAlchemy ORM database models
│   │   ├── schemas.py              # Pydantic v2 data transfer schemas
│   │   └── database.py             # Database engine & session dependency injection
│   ├── data/
│   │   ├── food_classes.json       # 157 YOLO class definitions
│   │   └── nutrition_db.json       # Curated nutritional database per 100g
│   └── models/
│       ├── best.onnx               # Quantized ONNX detection model (13.7 MB)
│       └── best.pt                 # PyTorch weight checkpoint (6.9 MB)
│
├── mobile/
│   ├── App.tsx                     # Root navigation, gesture root & auth context provider
│   ├── app.json                    # Expo project configuration & build plugins
│   ├── eas.json                    # EAS Build profiles (preview APK & production AAB)
│   ├── .env.example                # Mobile environment variable template
│   ├── context/
│   │   └── AuthContext.ts          # Decoupled React authentication context
│   ├── screens/
│   │   ├── HomeScreen.tsx          # Dynamic calories remaining, macro bars, 7-day chart
│   │   ├── ScanScreen.tsx          # Camera capture, gallery picker, live upload stages
│   │   ├── ResultScreen.tsx        # Bounding boxes, serving weight stepper, trust badges
│   │   ├── HistoryScreen.tsx       # Date-sectioned meal journal with optimistic undo
│   │   ├── ProfileScreen.tsx       # Body stats, TDEE calculator & credential forms
│   │   └── AdminScreen.tsx         # Human-in-the-loop review queue for pending foods
│   ├── services/
│   │   └── api.ts                  # Axios/fetch client, token storage & server warmup logic
│   ├── components/
│   │   └── AppModal.tsx            # Accessible dialog modal
│   └── theme/
│       └── tokens.ts               # Space Grotesk / Inter typography & color palette
│
├── docs/
│   ├── ARCHITECTURE.md             # In-depth architectural decision records (ADRs)
│   └── DEPLOYMENT.md               # Step-by-step production hosting walkthrough
├── docker-compose.yml              # Local container orchestration
└── supabase_schema.sql             # Idempotent PostgreSQL DDL schema definition
```

---

## 📄 License & Attribution

Developed as a Year 1 computer science engineering project. Released under the [MIT License](mobile/LICENSE).
