import { buildApiUrl } from "./apiConfig";

const apiRequest = async (path, { method = "GET", body, token } = {}) => {
  let response;

  try {
    response = await fetch(buildApiUrl(path), {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (error) {
    const target = buildApiUrl(path) || path;
    throw new Error(`Could not reach the auth server at ${target}.`);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Authentication request failed.");
  }

  return payload;
};

export const signupUser = (body) =>
  apiRequest("/api/auth/signup", {
    method: "POST",
    body
  });

export const loginUser = (body) =>
  apiRequest("/api/auth/login", {
    method: "POST",
    body
  });

export const fetchUserSession = (token) =>
  apiRequest("/api/auth/session", {
    token
  });

export const logoutUserSession = (token) =>
  apiRequest("/api/auth/logout", {
    method: "POST",
    token
  });

export const fetchAdminUsers = (token) =>
  apiRequest("/api/admin/users", {
    token
  });

export const fetchAdminUserActivity = (token) =>
  apiRequest("/api/admin/users/activity", {
    token
  });
