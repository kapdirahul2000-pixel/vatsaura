const normalizeApiBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

export const API_BASE_URL = normalizeApiBaseUrl(process.env.REACT_APP_API_BASE_URL);

export const buildApiUrl = (path) => {
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path || "")
    : `/${String(path || "")}`;

  return `${API_BASE_URL}${normalizedPath}`;
};
