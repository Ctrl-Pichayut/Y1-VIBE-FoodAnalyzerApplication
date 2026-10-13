-- ==============================================================================
-- Food Intelligence Analyzer — Supabase PostgreSQL Schema
-- ==============================================================================
-- Run this script in your Supabase Dashboard:
-- 1. Open Supabase Dashboard: https://supabase.com/dashboard
-- 2. Select your project -> Click "SQL Editor" in the left sidebar
-- 3. Click "New Query", paste this entire file, and click "Run"
-- ==============================================================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS public.users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    weight_kg FLOAT,
    height_cm FLOAT,
    age INTEGER,
    gender VARCHAR(20) DEFAULT NULL,
    activity_level VARCHAR(50) DEFAULT 'moderate',
    goal VARCHAR(50) DEFAULT 'maintain',
    dietary_mode VARCHAR(50) DEFAULT 'standard',
    allergens JSON DEFAULT '[]'::json,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_users_id ON public.users (id);
CREATE INDEX IF NOT EXISTS ix_users_email ON public.users (email);

-- 2. Food Items Table
CREATE TABLE IF NOT EXISTS public.food_items (
    id SERIAL PRIMARY KEY,
    yolo_class_id INTEGER UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    nutrition_json JSON NOT NULL,
    health_score INTEGER DEFAULT 50,
    tags JSON DEFAULT '[]'::json,
    allergens JSON DEFAULT '[]'::json
);

CREATE INDEX IF NOT EXISTS ix_food_items_id ON public.food_items (id);
CREATE INDEX IF NOT EXISTS ix_food_items_yolo_class_id ON public.food_items (yolo_class_id);

-- 3. Meal Logs Table
CREATE TABLE IF NOT EXISTS public.meal_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    scan_id VARCHAR(36),
    foods_json JSON NOT NULL,
    totals_json JSON
);

CREATE INDEX IF NOT EXISTS ix_meal_logs_id ON public.meal_logs (id);
CREATE INDEX IF NOT EXISTS ix_meal_logs_user_id ON public.meal_logs (user_id);
CREATE INDEX IF NOT EXISTS ix_meal_logs_scan_id ON public.meal_logs (scan_id);

-- 4. Model Versions Table
CREATE TABLE IF NOT EXISTS public.model_versions (
    id SERIAL PRIMARY KEY,
    version_tag VARCHAR(50) NOT NULL,
    pt_path VARCHAR(500) NOT NULL,
    class_count INTEGER NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS ix_model_versions_id ON public.model_versions (id);

-- 5. Nutrition Reviews Table (Gemini-estimated dishes curated by admins)
CREATE TABLE IF NOT EXISTS public.nutrition_reviews (
    id SERIAL PRIMARY KEY,
    dish_name VARCHAR(255) UNIQUE NOT NULL,
    per_100g JSON NOT NULL,
    allergens JSON DEFAULT '[]'::json,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    promoted_by INTEGER
);

CREATE INDEX IF NOT EXISTS ix_nutrition_reviews_id ON public.nutrition_reviews (id);
CREATE INDEX IF NOT EXISTS ix_nutrition_reviews_dish_name ON public.nutrition_reviews (dish_name);

-- 6. Revoked Tokens Table (For secure JWT token logout)
CREATE TABLE IF NOT EXISTS public.revoked_tokens (
    id SERIAL PRIMARY KEY,
    jti VARCHAR(36) UNIQUE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_revoked_tokens_id ON public.revoked_tokens (id);
CREATE INDEX IF NOT EXISTS ix_revoked_tokens_jti ON public.revoked_tokens (jti);
