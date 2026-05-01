const API_BASE_URL = String(process.env.REACT_APP_API_BASE_URL || "").trim();

const buildUrl = (path) => `${API_BASE_URL}${path}`;

const apiRequest = async (path, { method = "GET", body, token } = {}) => {
  let response;

  try {
    response = await fetch(buildUrl(path), {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (error) {
    const target = buildUrl(path) || path;
    throw new Error(
      `Could not reach the admin server at ${target}. Start the backend server and try again.`
    );
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Admin security request failed.");
  }

  return payload;
};

export const fetchAdminSecurityStatus = () => apiRequest("/api/admin/security/status");

export const requestAdminSetupOtp = (body) =>
  apiRequest("/api/admin/security/setup/request-otp", {
    method: "POST",
    body
  });

export const verifyAdminSetupOtp = (body) =>
  apiRequest("/api/admin/security/setup/verify-otp", {
    method: "POST",
    body
  });

export const completeAdminSetup = (body) =>
  apiRequest("/api/admin/security/setup/complete", {
    method: "POST",
    body
  });

export const startAdminLogin = (body) =>
  apiRequest("/api/admin/auth/login", {
    method: "POST",
    body
  });

export const verifyAdminPin = (body) =>
  apiRequest("/api/admin/auth/verify-pin", {
    method: "POST",
    body
  });

export const sendAdminOtp = (body) =>
  apiRequest("/api/admin/auth/send-otp", {
    method: "POST",
    body
  });

export const verifyAdminOtp = (body) =>
  apiRequest("/api/admin/auth/verify-otp", {
    method: "POST",
    body
  });

export const fetchAdminSession = (token) =>
  apiRequest("/api/admin/session", {
    token
  });

export const logoutAdminSession = (token) =>
  apiRequest("/api/admin/session/logout", {
    method: "POST",
    token
  });

export const updateAdminPassword = (token, body) =>
  apiRequest("/api/admin/security/password", {
    method: "POST",
    token,
    body
  });

export const updateAdminPin = (token, body) =>
  apiRequest("/api/admin/security/pin", {
    method: "POST",
    token,
    body
  });

export const updateAdminTwoFactor = (token, body) =>
  apiRequest("/api/admin/security/two-factor", {
    method: "POST",
    token,
    body
  });
