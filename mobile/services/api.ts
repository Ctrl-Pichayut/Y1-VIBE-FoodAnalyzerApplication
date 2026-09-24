/**
 * API service — handles all communication with the FastAPI backend.
 * Manages JWT tokens via SecureStore.
 */
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

// Backend URL — selected dynamically:
// • EXPO_PUBLIC_API_URL overrides everything if set.
// • Dev (expo start) dynamically infers the dev server's LAN IP.
// • Production defaults to the deployed Render URL.
let DEV_BASE_URL = 'http://localhost:8000';
if (Constants.expoConfig?.hostUri) {
  DEV_BASE_URL = `http://${Constants.expoConfig.hostUri.split(':')[0]}:8000`;
}
if (process.env.EXPO_PUBLIC_API_URL) {
  DEV_BASE_URL = process.env.EXPO_PUBLIC_API_URL;
}

const PROD_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://foodanalyzer-vbfg.onrender.com';
const BASE_URL = __DEV__ ? DEV_BASE_URL : PROD_BASE_URL;

/** P16: Expose BASE_URL for screens that need direct fetch (e.g. warmup). */
export function getBaseUrl(): string { return BASE_URL; }

let accessToken: string | null = null;
let refreshToken: string | null = null;

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------
export async function loadTokens() {
  accessToken = await SecureStore.getItemAsync('access_token');
  refreshToken = await SecureStore.getItemAsync('refresh_token');
}

export async function saveTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  await SecureStore.setItemAsync('access_token', access);
  await SecureStore.setItemAsync('refresh_token', refresh);
}

export async function clearTokens() {
  accessToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync('access_token');
  await SecureStore.deleteItemAsync('refresh_token');
}

export function isLoggedIn(): boolean {
  return accessToken !== null;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Thrown when the backend is waking from sleep (Render free tier). Callers
 * can catch this specifically to show a "waking up..." UI instead of an error.
 */
export class ServerWarmingUp extends Error {
  constructor() {
    super('Server is waking up — please wait a moment.');
    this.name = 'ServerWarmingUp';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Probe the backend until it reports ready. Used on app open to trigger a
 * Render cold-start wake-up explicitly and confirm the model is loaded.
 *
 * Returns true once the server is ready, false if it doesn't come up after
 * several attempts (~90s total). Never throws — callers just check the bool.
 */
export async function warmup(attempts = 6): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health/warmup`, {
        // Short timeout per attempt — a sleeping Render often accepts the
        // connection then takes a while to respond; we'd rather retry.
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.ready) return true;
      }
    } catch {
      // Network error / timeout — server still starting. Retry.
    }
    // Backoff: 5s, 10s, 15s, 20s, 25s ... gives Render time to boot.
    await sleep(5000 * (i + 1));
  }
  return false;
}

/**
 * Fetch wrapper with retry-on-cold-start. On a network failure or a 503
 * (service unavailable), it retries up to 3 times with backoff before
 * giving up — this smooths over Render's wake-up period. A 404 or other
 * 4xx is returned immediately (those are real errors, not cold starts).
 */
async function request(
  path: string,
  options: RequestInit = {},
  retry = true,
  coldStartAttempts = 0
): Promise<any> {
  const headers: any = {
    ...(options.headers || {}),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  // Don't set Content-Type for FormData (browser sets boundary automatically)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch (networkErr) {
    // Network failure — most likely a cold start. Retry with backoff.
    if (coldStartAttempts < 3) {
      await sleep(4000 * (coldStartAttempts + 1));
      return request(path, options, retry, coldStartAttempts + 1);
    }
    throw new ServerWarmingUp();
  }

  // 503 = service explicitly unavailable (Render still booting)
  if (res.status === 503 && coldStartAttempts < 3) {
    await sleep(4000 * (coldStartAttempts + 1));
    return request(path, options, retry, coldStartAttempts + 1);
  }

  if (res.status === 401 && retry && refreshToken) {
    // Try refresh
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request(path, options, false);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    let errMsg = body.detail || body.error || `Request failed: ${res.status}`;
    // FastAPI 422 Validation Errors return an array of error objects in `detail`.
    if (Array.isArray(errMsg)) {
      errMsg = errMsg.map((e: any) => e.msg || JSON.stringify(e)).join(', ');
    } else if (typeof errMsg === 'object') {
      errMsg = JSON.stringify(errMsg);
    }
    throw new Error(errMsg);
  }

  return res.json();
}

async function refreshAccessToken(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    await saveTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------
export async function register(
  email: string,
  password: string,
  profile?: {
    weight_kg?: number;
    height_cm?: number;
    age?: number;
    gender?: string;
    activity_level?: string;
    goal?: string;
  }
) {
  const data = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(profile || {}) }),
  });
  await saveTokens(data.access_token, data.refresh_token);
  return data;
}

export async function login(email: string, password: string) {
  const data = await request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await saveTokens(data.access_token, data.refresh_token);
  return data;
}

export async function logout() {
  // P8 fix: Call server-side logout to revoke the token before clearing
  // local storage. If the server call fails (offline, etc.), we still
  // clear tokens locally so the user isn't stuck.
  try {
    await request('/api/v1/auth/logout', { method: 'POST' }, false);
  } catch {
    // Server unreachable — token will expire naturally.
  }
  await clearTokens();
}

// ---------------------------------------------------------------------------
// Analyze API — uses XMLHttpRequest because React Native's fetch does not
// support the object-style FormData file part (throws "Unsupported FormDataPart")
//
// Timeout: 90s — hybrid mode can run two sequential Gemini API calls
// (recognition + nutrition estimation) that each take 10-20s.
// Auto-retry: 1 retry on timeout/network error before surfacing the error.
// ---------------------------------------------------------------------------
function _doAnalyzeXHR(imageUri: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const filename = imageUri.split('/').pop() || 'photo.jpg';
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

    const formData = new FormData();
    formData.append('file', {
      uri: imageUri,
      name: filename,
      type: mimeType,
    } as any);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/api/v1/analyze`);

    if (accessToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Invalid response from server'));
        }
      } else if (xhr.status === 503 || xhr.status === 502) {
        // Server waking up or overloaded — retryable
        reject(new RetryableError(`Server busy (${xhr.status}) — retrying`));
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body.detail || `Request failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Request failed: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new RetryableError('Network error — retrying'));
    xhr.ontimeout = () => reject(new RetryableError('Analysis taking longer than expected — retrying'));
    xhr.timeout = timeoutMs;

    xhr.send(formData);
  });
}

class RetryableError extends Error {
  constructor(msg: string) { super(msg); this.name = 'RetryableError'; }
}

export async function analyzeImage(imageUri: string): Promise<any> {
  // First attempt: 90s timeout
  try {
    return await _doAnalyzeXHR(imageUri, 90000);
  } catch (e: any) {
    if (e.name !== 'RetryableError') throw e;
    console.log(`[analyze] ${e.message}`);
  }

  // Retry once after a short pause (handles cold starts + transient errors)
  await new Promise(r => setTimeout(r, 2000));
  try {
    return await _doAnalyzeXHR(imageUri, 90000);
  } catch (e: any) {
    if (e.name === 'RetryableError') {
      throw new Error('Analysis timed out — the server may be busy. Please try again.');
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// History API
// ---------------------------------------------------------------------------
export async function getHistory(page = 1, perPage = 20) {
  return request(`/api/v1/history?page=${page}&per_page=${perPage}`);
}

export async function logMeal(foodsJson: any[], totalsJson?: any) {
  return request('/api/v1/history', {
    method: 'POST',
    body: JSON.stringify({ foods_json: foodsJson, totals_json: totalsJson }),
  });
}

export async function deleteMeal(mealId: number) {
  return request(`/api/v1/history/${mealId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Profile API
// ---------------------------------------------------------------------------
export async function getProfile() {
  return request('/api/v1/profile');
}

export async function updateProfile(updates: any) {
  return request('/api/v1/profile', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

// ---------------------------------------------------------------------------
// Summary API
// ---------------------------------------------------------------------------
export async function getDailySummary() {
  return request('/api/v1/daily-summary');
}

export async function getWeeklyReport() {
  return request('/api/v1/weekly-report');
}

// ---------------------------------------------------------------------------
// Foods API
// ---------------------------------------------------------------------------
export async function getFoods() {
  return request('/api/v1/foods');
}

export async function getFoodDetail(foodId: number) {
  return request(`/api/v1/foods/${foodId}`);
}

// ---------------------------------------------------------------------------
// Admin API — review Gemini-estimated dishes and promote them to verified
// ---------------------------------------------------------------------------
export async function getReviewQueue(page = 1, perPage = 20, status = 'pending') {
  return request(`/api/admin/review-queue?status=${status}&page=${page}&per_page=${perPage}`);
}

export async function getReviewStats() {
  return request('/api/admin/review-queue/stats');
}

export async function submitReview(
  reviewId: number,
  payload: {
    action: 'promote' | 'reject';
    per_100g?: any;
    allergens?: string[];
  }
) {
  return request(`/api/admin/review/${reviewId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
