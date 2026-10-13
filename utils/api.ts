import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export const BACKEND_URL = "https://j74mf38wgua3d4qd5mqbjjvza88n2qcp.app.specular.dev";
export const AUTH_TOKEN_KEY = "cozinhafast_token";

// In-memory token cache — set immediately on login/restore so every
// apiRequest has the token without waiting for async storage reads.
let _memoryToken: string | null = null;

export const setMemoryToken = (token: string | null): void => {
  _memoryToken = token;
  console.log("[API] Memory token", token ? "set" : "cleared");
};

export const getBearerToken = async (): Promise<string | null> => {
  // Return in-memory token first — fastest and most reliable path.
  if (_memoryToken) return _memoryToken;

  try {
    let stored: string | null = null;
    if (Platform.OS === "web") {
      stored = localStorage.getItem(AUTH_TOKEN_KEY);
    } else {
      stored = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
    }
    if (stored) {
      // Warm the cache so subsequent calls skip storage.
      _memoryToken = stored;
    }
    return stored;
  } catch (error) {
    console.error("[API] Error retrieving bearer token:", error);
    return null;
  }
};

export const saveBearerToken = async (token: string): Promise<void> => {
  // Always update memory cache first so the token is available immediately.
  _memoryToken = token;
  try {
    if (Platform.OS === "web") {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
    }
    console.log("[API] Token saved to storage");
  } catch (error) {
    console.error("[API] Error saving bearer token:", error);
  }
};

export const deleteBearerToken = async (): Promise<void> => {
  _memoryToken = null;
  try {
    if (Platform.OS === "web") {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    } else {
      await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
    }
    console.log("[API] Token deleted from storage");
  } catch (error) {
    console.error("[API] Error deleting bearer token:", error);
  }
};

export const apiRequest = async <T = any>(
  path: string,
  options?: RequestInit
): Promise<T> => {
  const url = `${BACKEND_URL}${path}`;
  const token = await getBearerToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    console.warn(`[API] No token available for ${options?.method ?? "GET"} ${path}`);
  }

  console.log(`[API] ${options?.method ?? "GET"} ${path}${token ? "" : " (unauthenticated)"}`);

  const response = await fetch(url, { ...options, headers });
if (!response.ok) {
    const text = await response.text();
    let message = text;
    let body: any = null;
    try {
      const json = JSON.parse(text);
      body = json;
      message = json.message || json.error || text;
    } catch {
      // use raw text
    }
    console.error(`[API] Error ${response.status} on ${path}:`, message);
    const err: any = new Error(message || `HTTP ${response.status}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  // 204 No Content or explicitly empty body — skip JSON parsing to avoid
  // "Unexpected end of JSON input" on DELETE endpoints that return no body.
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return null as any;
  }

  return response.json();
};

export const apiGet = <T = any>(path: string): Promise<T> =>
  apiRequest<T>(path, { method: "GET" });

export const apiPost = <T = any>(path: string, data: any): Promise<T> =>
  apiRequest<T>(path, { method: "POST", body: JSON.stringify(data) });

export const apiPut = <T = any>(path: string, data: any): Promise<T> =>
  apiRequest<T>(path, { method: "PUT", body: JSON.stringify(data) });

export const apiPatch = <T = any>(path: string, data: any): Promise<T> =>
  apiRequest<T>(path, { method: "PATCH", body: JSON.stringify(data) });

export const apiDelete = <T = any>(path: string, data: any = {}): Promise<T> =>
  apiRequest<T>(path, { method: "DELETE", body: JSON.stringify(data) });

// Aliases kept for backward compat with existing screens
export const apiCall = apiRequest;
export const authenticatedApiCall = apiRequest;
export const authenticatedGet = apiGet;
export const authenticatedPost = apiPost;
export const authenticatedPut = apiPut;
export const authenticatedPatch = apiPatch;
export const authenticatedDelete = apiDelete;

export const isBackendConfigured = (): boolean => !!BACKEND_URL;
export const BEARER_TOKEN_KEY = AUTH_TOKEN_KEY;
