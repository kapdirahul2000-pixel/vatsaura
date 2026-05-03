const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const nodemailer = require("nodemailer");
const Razorpay = require("razorpay");
const shortid = require("shortid");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");

dotenv.config();
// Also try loading from the parent directory if running from the server folder
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const cloudinaryCloudName = String(
  process.env.CLOUDINARY_CLOUD_NAME || "dcm5dhh8e"
).trim();

cloudinary.config({
  cloud_name: cloudinaryCloudName,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const productsMemoryStore = [];

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

const app = express();

// Razorpay Instance (Replace with your actual keys from Razorpay dashboard)
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const DEFAULT_ADMIN_EMAILS = [
  "kapdirahul2000@gmail.com",
  "vatsaurateam@gmail.com"
];

const parseEmailList = (value, fallback = DEFAULT_ADMIN_EMAILS) => {
  const configuredValues = String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return [...configuredValues, ...fallback].filter(
    (entry, index, array) => entry && array.indexOf(entry) === index
  );
};

const configuredAdminEmails = parseEmailList(
  process.env.ADMIN_OWNER_EMAIL || process.env.REACT_APP_ADMIN_OWNER_EMAIL
);

const config = {
  port: Number(process.env.PORT || process.env.SERVER_PORT || 4000),
  clientOrigin: String(process.env.CLIENT_ORIGIN || "").trim(),
  appName: String(process.env.APP_NAME || "Vatsaura").trim(),
  ownerEmails: configuredAdminEmails,
  ownerEmail: configuredAdminEmails[0] || DEFAULT_ADMIN_EMAILS[0],
  ownerPhone: String(process.env.ADMIN_OWNER_PHONE || "").trim(),
  otpLength: Math.max(4, Math.min(8, Number(process.env.ADMIN_OTP_LENGTH || 6))),
  otpTtlMs: Math.max(1, Number(process.env.ADMIN_OTP_TTL_MINUTES || 10)) * 60 * 1000,
  sessionTtlMs: Math.max(5, Number(process.env.ADMIN_SESSION_TTL_MINUTES || 120)) * 60 * 1000,
  userSessionTtlMs: Math.max(30, Number(process.env.USER_SESSION_TTL_MINUTES || 1440)) * 60 * 1000,
  dataFile: path.resolve(
    process.cwd(),
    String(process.env.ADMIN_SECURITY_DATA_FILE || "data/admin-security.json")
  ),
  otpLogFile: path.resolve(
    __dirname,
    String(process.env.ADMIN_OTP_LOG_FILE || "admin-otp.log")
  ),
  userDataFile: path.resolve(
    process.cwd(),
    String(process.env.USER_AUTH_DATA_FILE || "data/user-auth.json")
  ),
  smtp: {
    host: String(process.env.SMTP_HOST || "").trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").trim().toLowerCase() === "true",
    user: String(process.env.SMTP_USER || "").trim(),
    pass: String(process.env.SMTP_PASS || "").trim(),
    from: String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim()
  },
  twilio: {
    accountSid: String(process.env.TWILIO_ACCOUNT_SID || "").trim(),
    authToken: String(process.env.TWILIO_AUTH_TOKEN || "").trim(),
    from: String(process.env.TWILIO_FROM || "").trim()
  }
};

const defaultSecurityStore = () => ({
  password: "",
  pin: "",
  otpPreferences: {
    email: true,
    sms: false
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

const sessions = new Map();
const challenges = new Map();
const userSessions = new Map();

const allowedOrigins = [
  "http://localhost:3000",
  "https://vatsaura-edko-git-final-v1-kapdirahul2000-2999s-projects.vercel.app"
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  credentials: true,
  optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
}));

// Handle preflight requests for all routes
app.options("*", cors()); 

app.use(
  express.json({
    limit: "1mb"
  })
);

const ensureDataFile = () => {
  const folder = path.dirname(config.dataFile);

  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  if (!fs.existsSync(config.dataFile)) {
    fs.writeFileSync(config.dataFile, JSON.stringify(defaultSecurityStore(), null, 2));
  }
};

const defaultUserAuthStore = () => ({
  users: [],
  activityLogs: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

const ensureUserDataFile = () => {
  const folder = path.dirname(config.userDataFile);

  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  if (!fs.existsSync(config.userDataFile)) {
    fs.writeFileSync(config.userDataFile, JSON.stringify(defaultUserAuthStore(), null, 2));
  }
};

const readUserAuthStore = () => {
  ensureUserDataFile();

  try {
    const raw = fs.readFileSync(config.userDataFile, "utf8");
    const data = JSON.parse(raw);

    return {
      ...defaultUserAuthStore(),
      ...data,
      users: Array.isArray(data?.users) ? data.users : [],
      activityLogs: Array.isArray(data?.activityLogs) ? data.activityLogs : []
    };
  } catch (error) {
    return defaultUserAuthStore();
  }
};

const writeUserAuthStore = (nextStore) => {
  ensureUserDataFile();

  const store = {
    ...defaultUserAuthStore(),
    ...nextStore,
    users: Array.isArray(nextStore?.users) ? nextStore.users : [],
    activityLogs: Array.isArray(nextStore?.activityLogs) ? nextStore.activityLogs : [],
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(config.userDataFile, JSON.stringify(store, null, 2));
  return store;
};

const readSecurityStore = () => {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(config.dataFile, "utf8");
    const data = JSON.parse(raw);

    return {
      ...defaultSecurityStore(),
      ...data,
      otpPreferences: {
        ...defaultSecurityStore().otpPreferences,
        ...(data?.otpPreferences || {})
      }
    };
  } catch (error) {
    return defaultSecurityStore();
  }
};

const writeSecurityStore = (nextStore) => {
  ensureDataFile();

  const store = {
    ...defaultSecurityStore(),
    ...nextStore,
    otpPreferences: {
      ...defaultSecurityStore().otpPreferences,
      ...(nextStore?.otpPreferences || {})
    },
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(config.dataFile, JSON.stringify(store, null, 2));
  return store;
};

const appendOtpLog = (message) => {
  try {
    const folder = path.dirname(config.otpLogFile);

    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }

    fs.appendFileSync(config.otpLogFile, `${new Date().toISOString()} ${message}\n`);
  } catch (error) {
    console.error(error);
  }
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const isAuthorizedAdminEmail = (email) =>
  config.ownerEmails.includes(normalizeEmail(email));

const maskEmail = (email) => {
  const normalized = normalizeEmail(email);

  if (!normalized.includes("@")) {
    return "";
  }

  const [local, domain] = normalized.split("@");
  const visibleLocal = local.slice(0, 2);
  const hiddenLocal = "*".repeat(Math.max(1, local.length - visibleLocal.length));

  return `${visibleLocal}${hiddenLocal}@${domain}`;
};

const maskPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
};

const getAvailableContactMethods = () => ({
  email: Boolean(config.ownerEmail),
  sms: Boolean(config.ownerPhone)
});

const getEnabledOtpMethods = (store) => {
  const available = getAvailableContactMethods();

  return ["email", "sms"].filter(
    (method) => Boolean(store?.otpPreferences?.[method]) && available[method]
  );
};

const buildSecurityStatus = (store) => {
  const availableContactMethods = getAvailableContactMethods();

  return {
    needsSetup: !String(store.password || "").trim() && !String(store.pin || "").trim(),
    passwordConfigured: Boolean(String(store.password || "").trim()),
    pinConfigured: Boolean(String(store.pin || "").trim()),
    otpPreferences: {
      email: store?.otpPreferences?.email !== false,
      sms: Boolean(store?.otpPreferences?.sms)
    },
    availableContactMethods,
    deliveryReady: availableContactMethods,
    contact: {
      emailMasked: maskEmail(config.ownerEmail),
      phoneMasked: maskPhone(config.ownerPhone)
    }
  };
};

const createId = (prefix) =>
  `${prefix}-${crypto.randomBytes(6).toString("hex")}-${Date.now().toString(36)}`;

const createOtp = () => {
  const max = 10 ** config.otpLength;
  const min = 10 ** (config.otpLength - 1);
  return String(Math.floor(min + Math.random() * (max - min)));
};

const cleanupMemory = () => {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }

  for (const [challengeId, challenge] of challenges.entries()) {
    if (challenge.expiresAt <= now) {
      challenges.delete(challengeId);
    }
  }

  for (const [token, session] of userSessions.entries()) {
    if (session.expiresAt <= now) {
      userSessions.delete(token);
    }
  }
};

const getBearerToken = (req) => {
  const header = String(req.headers.authorization || "").trim();

  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return header.slice(7).trim();
};

const requireAdminSession = (req, res) => {
  cleanupMemory();

  const token = getBearerToken(req);
  const session = sessions.get(token);

  if (!token || !session || session.expiresAt <= Date.now()) {
    if (token) {
      sessions.delete(token);
    }

    res.status(401).json({ error: "Admin session expired. Log in again." });
    return null;
  }

  return {
    token,
    session
  };
};

const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => {
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return { salt, hash };
};

const verifyPassword = (password, salt, expectedHash) => {
  if (!salt || !expectedHash) {
    return false;
  }

  const computed = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  const expectedBuffer = Buffer.from(String(expectedHash), "hex");
  const computedBuffer = Buffer.from(computed, "hex");

  if (expectedBuffer.length !== computedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, computedBuffer);
};

const createUserSession = (email) => {
  const token = createId("user-session");

  userSessions.set(token, {
    email: normalizeEmail(email),
    createdAt: Date.now(),
    expiresAt: Date.now() + config.userSessionTtlMs
  });

  return token;
};

const requireUserSession = (req, res) => {
  cleanupMemory();

  const token = getBearerToken(req);
  const session = userSessions.get(token);

  if (!token || !session || session.expiresAt <= Date.now()) {
    if (token) {
      userSessions.delete(token);
    }

    res.status(401).json({ error: "User session expired. Log in again." });
    return null;
  }

  return {
    token,
    session
  };
};

const sanitizeUserForClient = (user) => ({
  id: user.id,
  name: user.name,
  email: normalizeEmail(user.email),
  role: user.role || (isAuthorizedAdminEmail(user.email) ? "admin" : "customer"),
  status: user.status || "active",
  photo: "",
  joinedAt: Number(user.joinedAt || Date.now()),
  lastLoginAt: Number(user.lastLoginAt || Date.now()),
  auraPoints: Number(user.auraPoints || 0)
});

const addActivityLog = (store, { email, action, ip }) => {
  const nextLogs = [
    {
      id: createId("log"),
      email: normalizeEmail(email),
      action: String(action || "").trim() || "unknown",
      ip: String(ip || "").trim(),
      createdAt: Date.now(),
      createdAtLabel: new Date().toLocaleString("en-IN")
    },
    ...(Array.isArray(store.activityLogs) ? store.activityLogs : [])
  ].slice(0, 5000);

  return {
    ...store,
    activityLogs: nextLogs
  };
};

const sendSmsViaTwilio = (message) =>
  new Promise((resolve, reject) => {
    const { accountSid, authToken, from } = config.twilio;

    if (!accountSid || !authToken || !from || !config.ownerPhone) {
      resolve(false);
      return;
    }

    const body = new URLSearchParams({
      To: config.ownerPhone,
      From: from,
      Body: message
    }).toString();

    const request = https.request(
      {
        hostname: "api.twilio.com",
        path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
        method: "POST",
        auth: `${accountSid}:${authToken}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(true);
            return;
          }

          reject(new Error(`Unable to send SMS OTP. ${data || "Twilio request failed."}`));
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });

const isLikelyGoogleSmtpHost = (host) => /(^|\.)googlemail\.com$|(^|\.)gmail\.com$/i.test(String(host || "").trim());

const gmailSmtpHint =
  'Gmail/Google Workspace often rejects normal account passwords here. Enable 2-Step Verification on the Google account used for SMTP_USER, create an App password at https://myaccount.google.com/apppasswords and set SMTP_PASS to that 16-character value (spaces optional). SMTP_USER must match that Google account exactly; SMTP_FROM should normally be that same email. Use SMTP_HOST=smtp.gmail.com with SMTP_PORT=587 and SMTP_SECURE=false unless you intentionally use TLS on port 465.';

const formatSmtpFailureHint = (err) => {
  const blob = `${err.code || ""} ${err.responseCode || ""} ${err.response || ""} ${err.message || ""}`.trim();

  if (/535|\bBADCREDENTIALS\b|INVALID LOGIN|authentication failed|Username and Password not accepted/i.test(blob)) {
    return gmailSmtpHint;
  }

  if (/socket|timed out|ECONNREFUSED|EAI_|certificate|SELF_SIGNED/i.test(blob)) {
    return "Check SMTP_HOST and SMTP_PORT, firewall/network access, and that SMTP_SECURE matches your provider (typically false on port 587, true only on port 465).";
  }

  return "Verify SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and SMTP_FROM in the server .env file, restart the backend, and try again.";
};

const sendEmailViaSmtp = async (subject, text) => {
  const raw = config.smtp;
  let host = String(raw.host || "").trim();
  const port = Number(raw.port || 587);
  const secure = port === 465 ? true : raw.secure;
  const user = String(raw.user || "").trim();
  const pass = String(raw.pass || "").trim();
  const fromConfigured = String(raw.from || "").trim();
  const from = fromConfigured || user;
  const userLower = normalizeEmail(user);
  const ownerLower = normalizeEmail(config.ownerEmail);

  if ((user && !pass) || (!user && pass)) {
    return {
      success: false,
      hint:
        "SMTP authentication is incomplete: set both SMTP_USER and SMTP_PASS together (both empty only for relays that allow unauthenticated SMTP), then restart the server."
    };
  }

  const ownerLooksGmail = ownerLower.includes("@gmail.com") || ownerLower.includes("@googlemail.com");
  const userLooksGmail = userLower.includes("@gmail.com") || userLower.includes("@googlemail.com");

  if (!host && (userLooksGmail || ownerLooksGmail)) {
    host = "smtp.gmail.com";
  }

  if (!host || !from || !config.ownerEmail) {
    return {
      success: false,
      hint: `Set SMTP_HOST (for Gmail use smtp.gmail.com), SMTP_USER, SMTP_PASS, SMTP_FROM or matching SMTP_USER, and ADMIN_OWNER_EMAIL in the server .env. ${gmailSmtpHint}`
    };
  }

  try {
    const transportConfig = {
      host,
      port,
      secure,
      connectionTimeout: 25_000,
      socketTimeout: 25_000,
      ...(user && pass ? { auth: { user, pass } } : {}),
      ...(isLikelyGoogleSmtpHost(host) && port === 587 && !secure
        ? { requireTLS: true, tls: { minVersion: "TLSv1.2" } }
        : {})
    };

    const transport = nodemailer.createTransport(transportConfig);

    const gmailHost = isLikelyGoogleSmtpHost(host);

    await transport.sendMail({
      // Gmail rejects many From addresses that don't match the authenticated account.
      from: gmailHost && user && normalizeEmail(from) !== userLower ? user : from,
      to: config.ownerEmail,
      replyTo: user || undefined,
      subject,
      text
    });

    return { success: true };
  } catch (error) {
    const hint = formatSmtpFailureHint(error);

    appendOtpLog(`[SMTP][FAILED] ${error.message || error}`);

    return {
      success: false,
      error: error.message || String(error),
      hint
    };
  }
};

const deliverOtp = async (method, otp) => {
  const message = `${config.appName} admin OTP: ${otp}`;

  if (method === "email") {
    const smtpResult = await sendEmailViaSmtp("Admin OTP", message);
    const delivered = smtpResult.success;

    let smtpDeliveryNote;

    if (!delivered) {
      const fallbackMessage = `[Admin OTP][EMAIL][${config.ownerEmail}] ${otp}`;
      console.info(fallbackMessage);
      appendOtpLog(fallbackMessage);

      smtpDeliveryNote = smtpResult.hint
        ? `${smtpResult.hint} The OTP was written to the server console and ${path.basename(config.otpLogFile)}.`
        : `Email sending failed.${smtpResult.error ? ` (${smtpResult.error})` : ""} The OTP was written to the server console and ${path.basename(config.otpLogFile)}.`;
    }

    return {
      contact: maskEmail(config.ownerEmail),
      ...(smtpDeliveryNote ? { smtpDeliveryNote } : {})
    };
  }

  if (method === "sms") {
    const delivered = await sendSmsViaTwilio(message);

    if (!delivered) {
      const fallbackMessage = `[Admin OTP][SMS][${config.ownerPhone}] ${otp}`;
      console.info(fallbackMessage);
      appendOtpLog(fallbackMessage);
    }

    return {
      contact: maskPhone(config.ownerPhone)
    };
  }

  throw new Error("Unsupported OTP method.");
};

const createSession = (email = config.ownerEmail) => {
  const token = createId("admin-session");

  sessions.set(token, {
    email: normalizeEmail(email) || config.ownerEmail,
    createdAt: Date.now(),
    expiresAt: Date.now() + config.sessionTtlMs
  });

  return token;
};

const ensureEnabledOtpMethod = (store, requestedPreferences) => {
  const available = getAvailableContactMethods();
  const preferences = {
    email: requestedPreferences?.email !== false,
    sms: Boolean(requestedPreferences?.sms)
  };

  const enabledMethods = ["email", "sms"].filter(
    (method) => preferences[method] && available[method]
  );

  if (enabledMethods.length === 0) {
    throw new Error("Configure at least one OTP delivery method.");
  }

  return preferences;
};

app.get("/api/admin/security/status", (_req, res) => {
  cleanupMemory();
  const store = readSecurityStore();
  res.json(buildSecurityStatus(store));
});

app.post("/api/admin/security/setup/request-otp", async (req, res) => {
  cleanupMemory();
  const store = readSecurityStore();
  const email = normalizeEmail(req.body?.email);
  const method = String(req.body?.method || "email").trim().toLowerCase();

  if (!buildSecurityStatus(store).needsSetup) {
    res.status(400).json({ error: "Admin security is already configured." });
    return;
  }

  if (!isAuthorizedAdminEmail(email)) {
    res.status(403).json({ error: "Only configured admin accounts can initialize admin security." });
    return;
  }

  if (!getAvailableContactMethods()[method]) {
    res.status(400).json({ error: "Selected OTP method is not available." });
    return;
  }

  const challengeId = createId("setup");
  const otp = createOtp();

  challenges.set(challengeId, {
    id: challengeId,
    type: "setup",
    email,
    otp,
    otpVerified: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + config.otpTtlMs
  });

  try {
    const delivery = await deliverOtp(method, otp);
    res.json({
      challengeId,
      contact: delivery.contact,
      ...(delivery.smtpDeliveryNote ? { smtpDeliveryNote: delivery.smtpDeliveryNote } : {})
    });
  } catch (error) {
    challenges.delete(challengeId);
    res.status(500).json({ error: error.message || "Unable to send setup OTP." });
  }
});

app.post("/api/admin/security/setup/verify-otp", (req, res) => {
  cleanupMemory();
  const challengeId = String(req.body?.challengeId || "").trim();
  const otp = String(req.body?.otp || "").trim();
  const challenge = challenges.get(challengeId);

  if (!challenge || challenge.type !== "setup") {
    res.status(400).json({ error: "Setup challenge is invalid or expired." });
    return;
  }

  if (!otp || otp !== challenge.otp) {
    res.status(400).json({ error: "Incorrect OTP." });
    return;
  }

  challenge.otpVerified = true;
  challenge.otp = "";
  challenges.set(challengeId, challenge);
  res.json({ verified: true });
});

app.post("/api/admin/security/setup/complete", (req, res) => {
  cleanupMemory();
  const challengeId = String(req.body?.challengeId || "").trim();
  const password = String(req.body?.password || "").trim();
  const pin = String(req.body?.pin || "").trim();
  const challenge = challenges.get(challengeId);

  if (!challenge || challenge.type !== "setup" || !challenge.otpVerified) {
    res.status(400).json({ error: "Verify the setup OTP before saving admin security." });
    return;
  }

  if (!password && !pin) {
    res.status(400).json({ error: "Set at least one admin sign-in method." });
    return;
  }

  try {
    const store = writeSecurityStore({
      ...readSecurityStore(),
      password,
      pin,
      otpPreferences: ensureEnabledOtpMethod(readSecurityStore(), {
        email: req.body?.enableEmailOtp,
        sms: req.body?.enableSmsOtp
      })
    });
    const token = createSession(challenge.email);

    challenges.delete(challengeId);

    res.json({
      token,
      securityStatus: buildSecurityStatus(store)
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to finish admin setup." });
  }
});

app.post("/api/admin/auth/login", (req, res) => {
  cleanupMemory();
  const store = readSecurityStore();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const status = buildSecurityStatus(store);

  if (status.needsSetup) {
    res.status(400).json({ error: "Admin security has not been initialized yet." });
    return;
  }

  if (!isAuthorizedAdminEmail(email)) {
    res.status(403).json({ error: "Only configured admin accounts can access admin security." });
    return;
  }

  if (!String(store.password || "").trim()) {
    res.status(400).json({ error: "Admin password is not configured." });
    return;
  }

  if (password !== store.password) {
    res.status(401).json({ error: "Incorrect admin password." });
    return;
  }

  const availableOtpMethods = getEnabledOtpMethods(store);

  if (availableOtpMethods.length === 0) {
    res.status(400).json({ error: "No OTP delivery method is configured." });
    return;
  }

  const challengeId = createId("login");

  challenges.set(challengeId, {
    id: challengeId,
    type: "login",
    email,
    pinVerified: !String(store.pin || "").trim(),
    availableOtpMethods,
    otp: "",
    createdAt: Date.now(),
    expiresAt: Date.now() + config.otpTtlMs
  });

  res.json({
    challengeId,
    requiresPin: Boolean(String(store.pin || "").trim()),
    availableOtpMethods
  });
});

app.post("/api/admin/auth/verify-pin", (req, res) => {
  cleanupMemory();
  const challengeId = String(req.body?.challengeId || "").trim();
  const pin = String(req.body?.pin || "").trim();
  const challenge = challenges.get(challengeId);
  const store = readSecurityStore();

  if (!challenge || challenge.type !== "login") {
    res.status(400).json({ error: "Login challenge is invalid or expired." });
    return;
  }

  if (!String(store.pin || "").trim()) {
    res.status(400).json({ error: "Admin PIN is not configured." });
    return;
  }

  if (pin !== store.pin) {
    res.status(401).json({ error: "Incorrect admin PIN." });
    return;
  }

  challenge.pinVerified = true;
  challenges.set(challengeId, challenge);

  res.json({
    availableOtpMethods: challenge.availableOtpMethods
  });
});

app.post("/api/admin/auth/send-otp", async (req, res) => {
  cleanupMemory();
  const challengeId = String(req.body?.challengeId || "").trim();
  const method = String(req.body?.method || "email").trim().toLowerCase();
  const challenge = challenges.get(challengeId);

  if (!challenge || challenge.type !== "login") {
    res.status(400).json({ error: "Login challenge is invalid or expired." });
    return;
  }

  if (!challenge.pinVerified) {
    res.status(400).json({ error: "Verify the admin PIN before requesting OTP." });
    return;
  }

  if (!challenge.availableOtpMethods.includes(method)) {
    res.status(400).json({ error: "Selected OTP method is not enabled." });
    return;
  }

  const otp = createOtp();
  challenge.otp = otp;
  challenge.expiresAt = Date.now() + config.otpTtlMs;
  challenges.set(challengeId, challenge);

  try {
    const delivery = await deliverOtp(method, otp);

    res.json({
      contact: delivery.contact,
      ...(delivery.smtpDeliveryNote ? { smtpDeliveryNote: delivery.smtpDeliveryNote } : {})
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unable to send admin OTP." });
  }
});

app.post("/api/admin/auth/verify-otp", (req, res) => {
  cleanupMemory();
  const challengeId = String(req.body?.challengeId || "").trim();
  const otp = String(req.body?.otp || "").trim();
  const challenge = challenges.get(challengeId);
  const store = readSecurityStore();

  if (!challenge || challenge.type !== "login") {
    res.status(400).json({ error: "Login challenge is invalid or expired." });
    return;
  }

  if (!challenge.pinVerified) {
    res.status(400).json({ error: "Verify the admin PIN before entering OTP." });
    return;
  }

  if (!challenge.otp || otp !== challenge.otp) {
    res.status(401).json({ error: "Incorrect OTP." });
    return;
  }

  const token = createSession(challenge.email);
  challenges.delete(challengeId);

  res.json({
    token,
    securityStatus: buildSecurityStatus(store)
  });
});

app.get("/api/admin/session", (req, res) => {
  const auth = requireAdminSession(req, res);

  if (!auth) {
    return;
  }

  const store = readSecurityStore();

  res.json({
    email: auth.session.email,
    securityStatus: buildSecurityStatus(store)
  });
});

app.post("/api/admin/session/logout", (req, res) => {
  const auth = requireAdminSession(req, res);

  if (!auth) {
    return;
  }

  sessions.delete(auth.token);
  res.json({ ok: true });
});

app.post("/api/admin/security/password", (req, res) => {
  const auth = requireAdminSession(req, res);

  if (!auth) {
    return;
  }

  const currentPassword = String(req.body?.currentPassword || "");
  const nextPassword = String(req.body?.nextPassword || "").trim();
  const store = readSecurityStore();

  if (String(store.password || "").trim() && currentPassword !== store.password) {
    res.status(401).json({ error: "Current admin password is incorrect." });
    return;
  }

  if (!nextPassword && !String(store.pin || "").trim()) {
    res.status(400).json({ error: "At least one admin sign-in method must stay configured." });
    return;
  }

  const nextStore = writeSecurityStore({
    ...store,
    password: nextPassword
  });

  res.json({
    securityStatus: buildSecurityStatus(nextStore)
  });
});

app.post("/api/admin/security/pin", (req, res) => {
  const auth = requireAdminSession(req, res);

  if (!auth) {
    return;
  }

  const currentPin = String(req.body?.currentPin || "");
  const nextPin = String(req.body?.nextPin || "").trim();
  const store = readSecurityStore();

  if (String(store.pin || "").trim() && currentPin !== store.pin) {
    res.status(401).json({ error: "Current admin PIN is incorrect." });
    return;
  }

  if (!nextPin && !String(store.password || "").trim()) {
    res.status(400).json({ error: "At least one admin sign-in method must stay configured." });
    return;
  }

  const nextStore = writeSecurityStore({
    ...store,
    pin: nextPin
  });

  res.json({
    securityStatus: buildSecurityStatus(nextStore)
  });
});

app.post("/api/admin/security/two-factor", (req, res) => {
  const auth = requireAdminSession(req, res);

  if (!auth) {
    return;
  }

  try {
    const store = readSecurityStore();
    const nextStore = writeSecurityStore({
      ...store,
      otpPreferences: ensureEnabledOtpMethod(store, {
        email: req.body?.enableEmailOtp,
        sms: req.body?.enableSmsOtp
      })
    });

    res.json({
      securityStatus: buildSecurityStatus(nextStore)
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to update OTP preferences." });
  }
});

// Razorpay Order Creation Endpoint
app.post("/create-order", async (req, res) => {
  const { amount, currency = "INR" } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount." });
  }

  const options = {
    amount: Math.round(Number(amount) * 100), // Amount in paise
    currency,
    receipt: `receipt_${shortid.generate()}`,
    payment_capture: 1
  };

  try {
    const response = await razorpay.orders.create(options);
    res.json(response);
  } catch (error) {
    console.error("Razorpay Order Error:", error);
    res.status(500).json({ error: "Unable to create Razorpay order." });
  }
});

app.post("/api/payment/create-order", async (req, res) => {
  const { amount, currency = "INR" } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount." });
  }

  // Check if keys are still placeholders
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.error("Razorpay Error: API keys are missing or still set to placeholders in .env");
    return res.status(401).json({ 
      error: "Razorpay authentication failed. Please update RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env file with real keys from the Razorpay dashboard." 
    });
  }

  const options = {
    amount: Math.round(amount * 100), // Amount in paise (e.g., 1000 paise = 10.00 INR)
    currency,
    receipt: `receipt_${shortid.generate()}`,
    payment_capture: 1 // Auto-capture payment
  };

  try {
    const response = await razorpay.orders.create(options);
    res.json({
      id: response.id,
      currency: response.currency,
      amount: response.amount,
      key_id: razorpay.key_id
    });
  } catch (error) {
    console.error("Razorpay Order Error:", error);
    res.status(500).json({ error: "Unable to create Razorpay order." });
  }
});

app.post("/api/auth/signup", (req, res) => {
  cleanupMemory();
  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!name || !email || !password) {
    res.status(400).json({ error: "Name, email, and password are required." });
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters long." });
    return;
  }

  const store = readUserAuthStore();
  const exists = store.users.some((entry) => normalizeEmail(entry.email) === email);

  if (exists) {
    res.status(409).json({ error: "An account already exists for this email." });
    return;
  }

  const { salt, hash } = hashPassword(password);
  const now = Date.now();
  const role = isAuthorizedAdminEmail(email) ? "admin" : "customer";

  const nextUser = {
    id: createId("usr"),
    name,
    email,
    passwordHash: hash,
    passwordSalt: salt,
    role,
    status: "active",
    joinedAt: now,
    lastLoginAt: now,
    auraPoints: role === "admin" ? 0 : 100
  };

  const token = createUserSession(email);
  const nextStore = addActivityLog(
    {
      ...store,
      users: [nextUser, ...store.users]
    },
    {
      email,
      action: "signup",
      ip: req.ip
    }
  );
  writeUserAuthStore(nextStore);

  res.json({
    token,
    user: sanitizeUserForClient(nextUser)
  });
});

app.post("/api/auth/login", (req, res) => {
  cleanupMemory();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const store = readUserAuthStore();
  const existingUser = store.users.find((entry) => normalizeEmail(entry.email) === email);

  if (!existingUser) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  if (!verifyPassword(password, existingUser.passwordSalt, existingUser.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  if (existingUser.status === "blocked") {
    res.status(403).json({ error: "This account is blocked. Contact support." });
    return;
  }

  existingUser.lastLoginAt = Date.now();
  const token = createUserSession(email);
  const nextStore = addActivityLog(store, {
    email,
    action: "login",
    ip: req.ip
  });
  writeUserAuthStore(nextStore);

  res.json({
    token,
    user: sanitizeUserForClient(existingUser)
  });
});

app.get("/api/auth/session", (req, res) => {
  const auth = requireUserSession(req, res);

  if (!auth) {
    return;
  }

  const store = readUserAuthStore();
  const existingUser = store.users.find(
    (entry) => normalizeEmail(entry.email) === normalizeEmail(auth.session.email)
  );

  if (!existingUser) {
    userSessions.delete(auth.token);
    res.status(401).json({ error: "User session is no longer valid." });
    return;
  }

  res.json({
    user: sanitizeUserForClient(existingUser)
  });
});

app.post("/api/auth/logout", (req, res) => {
  const auth = requireUserSession(req, res);

  if (!auth) {
    return;
  }

  const store = readUserAuthStore();
  const nextStore = addActivityLog(store, {
    email: auth.session.email,
    action: "logout",
    ip: req.ip
  });
  writeUserAuthStore(nextStore);
  userSessions.delete(auth.token);

  res.json({ ok: true });
});

app.get("/api/admin/users", (req, res) => {
  const auth = requireAdminSession(req, res);

  if (!auth) {
    return;
  }

  const store = readUserAuthStore();

  res.json({
    users: store.users.map((entry) => sanitizeUserForClient(entry))
  });
});

app.get("/api/admin/users/activity", (req, res) => {
  const auth = requireAdminSession(req, res);

  if (!auth) {
    return;
  }

  const store = readUserAuthStore();

  res.json({
    logs: (Array.isArray(store.activityLogs) ? store.activityLogs : []).slice(0, 500)
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: config.appName,
    time: new Date().toISOString()
  });
});

app.post("/upload", imageUpload.single("file"), async (req, res) => {
  if (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    res.status(500).json({ error: "Cloudinary API credentials are not configured." });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded. Use multipart field name "file".' });
    return;
  }

  try {
    const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    const uploadOptions = {
      folder: "products"
    };
    const uploadPreset = String(process.env.CLOUDINARY_UPLOAD_PRESET || "").trim();

    if (uploadPreset) {
      uploadOptions.upload_preset = uploadPreset;
    }

    const result = await cloudinary.uploader.upload(dataUri, uploadOptions);

    res.json({
      url: result.secure_url,
      image: result.secure_url
    });
  } catch (error) {
    console.error("Cloudinary upload error:", error);
    res.status(500).json({ error: error.message || "Upload failed." });
  }
});

app.post("/products", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const image = String(req.body?.image || "").trim();

  if (!name || !image) {
    res.status(400).json({ error: "name and image are required." });
    return;
  }

  productsMemoryStore.push({ name, image });
  res.status(201).json({ name, image });
});

app.get("/products", (_req, res) => {
  res.json(
    productsMemoryStore.map((entry) => ({
      name: entry.name,
      image: entry.image
    }))
  );
});

app.listen(config.port, () => {
  console.info(`Backend server listening on port ${config.port}`);
});

