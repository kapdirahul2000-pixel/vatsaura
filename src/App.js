import React, { startTransition, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { auth, db } from "./firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  where
} from "firebase/firestore";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "firebase/auth";
import brandHeaderVideo from "./brand-header-video.mp4";
import kalawaImage from "./assets/images/kalawa.png";
import { buildApiUrl } from "./apiConfig";

const ADMIN_EMAILS = [
  "kapdirahul2000@gmail.com",
  "vatsaurateam@gmail.com"
];

const ADMIN_PANEL_PASSWORD = "Radheradhe@13";

const STORAGE_KEYS = {
  cart: "vatsauraCart",
  wishlist: "vatsauraWishlist",
  orders: "vatsauraOrders",
  users: "vatsauraUsers",
  products: "vatsauraProducts",
  settings: "vatsauraSettings",
  adminSession: "vatsauraAdminSession"
};
const FIRESTORE_PATHS = {
  publicStoreCollection: "appState",
  publicStoreDocument: "primary",
  ordersCollection: "orders",
  usersCollection: "users"
};

const CLOUDINARY_CLOUD_NAME = "dcm5dhh8e";
const CLOUDINARY_UPLOAD_PRESET = "ml_default";
const CLOUDINARY_UPLOAD_BASE = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}`;
const CLOUDINARY_BASE = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}`;
const RAZORPAY_CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";
const COD_CHARGE = 100;
let razorpayCheckoutPromise;

const loadRazorpayCheckout = () => {
  if (window.Razorpay) {
    return Promise.resolve(true);
  }

  if (razorpayCheckoutPromise) {
    return razorpayCheckoutPromise;
  }

  razorpayCheckoutPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${RAZORPAY_CHECKOUT_URL}"]`);

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(true), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Unable to load Razorpay checkout.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_URL;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("Unable to load Razorpay checkout."));
    document.body.appendChild(script);
  });

  return razorpayCheckoutPromise;
};

const checkBackendAdminAccess = async (firebaseUser) => {
  if (!firebaseUser) {
    return { admin: false, denied: false, token: "", status: 0 };
  }

  const token = await firebaseUser.getIdToken(true);
  const response = await fetch(buildApiUrl("/api/admin-check"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json().catch(() => ({}));

  return {
    admin: response.ok && payload.admin === true,
    denied:
      response.status === 403 ||
      (response.ok && payload.admin === false),
    status: response.status,
    token
  };
};

/** Turn Cloudinary public_id, partial paths, or bare upload paths into a full secure URL. */
const resolveCloudinaryMediaUrl = (raw) => {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "";
  }

  if (value.startsWith("//")) {
    return `https:${value}`;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (value.startsWith("data:") || value.startsWith("blob:")) {
    return value;
  }

  if (value.startsWith("/static/") || value.startsWith("/assets/")) {
    return value;
  }

  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
    return value;
  }

  const pathSafe = value.replace(/^\/+/, "");
  if (!pathSafe) {
    return value;
  }

  if (pathSafe.startsWith(`${CLOUDINARY_CLOUD_NAME}/`)) {
    return `https://res.cloudinary.com/${pathSafe}`;
  }

  if (/^(image|video)\/upload\//.test(pathSafe)) {
    return `${CLOUDINARY_BASE}/${pathSafe}`;
  }

  const isVideo = /\.(?:mp4|webm|mov|m4v)(?:\?|$)/i.test(pathSafe);
  const resource = isVideo ? "video" : "image";

  return `${CLOUDINARY_BASE}/${resource}/upload/${pathSafe}`;
};

const PERSISTENT_STORE_CONFIG = {
  dbName: "vatsauraStorefrontDb",
  storeName: "appState",
  key: "primary"
};

const paymentCatalog = [
  {
    value: "upi",
    title: "UPI QR",
    description: "Scan and pay using our configured UPI QR"
  },
  {
    value: "razorpay",
    title: "Razorpay",
    description: "Pay securely via Card, NetBanking, UPI, or Wallets"
  },
  {
    value: "cod",
    title: "Cash on Delivery",
    description: "Collect payment at the time of delivery"
  },
  {
    value: "aura",
    title: "Aura Points",
    description: "Pay using the wallet balance stored on the account"
  }
];

const publicAssetBase = process.env.PUBLIC_URL || "";
const paymentAssetPath = (fileName) => `${publicAssetBase}/payment-icons/${fileName}`;
const razorpayLogoSrc = paymentAssetPath("razorpay-icon.webp");
const acceptedPaymentLogos = [
  { name: "UPI", src: paymentAssetPath("upi.svg") },
  { name: "Visa", src: paymentAssetPath("visa.svg") },
  { name: "Mastercard", src: paymentAssetPath("mastercard.svg") },
  { name: "RuPay", src: paymentAssetPath("rupay.svg") },
  { name: "Paytm", src: paymentAssetPath("paytm.svg") },
  { name: "PhonePe", src: paymentAssetPath("phonepe.svg") }
];

const sortOptions = [
  { value: "featured", label: "Featured" },
  { value: "priceLow", label: "Price: Low to High" },
  { value: "priceHigh", label: "Price: High to Low" },
  { value: "newest", label: "Newest" }
];

const DEFAULT_TSHIRT_CATEGORIES = [
  "Krishna",
  "Mahadev",
  "Hanuman",
  "Narsimha",
  "Shree Ram"
];

const MAX_HOME_BANNERS = 3;
const MAX_LATEST_DROPS = 8;
const MAX_HOME_HIGHLIGHTS = 8;
const HOME_BANNER_AUTOPLAY_MS = 5200;
const DEFAULT_BANNER_ASPECT_RATIO = 16 / 9;
const DEFAULT_BANNER_COPY = {
  title: "Spiritual Streetwear",
  subtitle: "Premium",
  description: "Wear your beliefs. Live your aura."
};

const initialCheckoutForm = {
  name: "",
  phone: "",
  address: "",
  city: "",
  pincode: "",
  landmark: "",
  transactionId: "",
  customerName: "",
  paymentScreenshot: "",
  useAuraPoints: true
};

const PRODUCT_AVAILABILITY = {
  IN_STOCK: "in-stock",
  OUT_OF_STOCK: "out-of-stock",
  COMING_SOON: "coming-soon"
};

const normalizeProductAvailability = (value, stock = 0) => {
  const normalizedValue = String(value || "").trim().toLowerCase();

  if (normalizedValue === PRODUCT_AVAILABILITY.OUT_OF_STOCK) {
    return PRODUCT_AVAILABILITY.OUT_OF_STOCK;
  }

  if (normalizedValue === PRODUCT_AVAILABILITY.COMING_SOON) {
    return PRODUCT_AVAILABILITY.COMING_SOON;
  }

  return Number(stock) > 0
    ? PRODUCT_AVAILABILITY.IN_STOCK
    : PRODUCT_AVAILABILITY.OUT_OF_STOCK;
};

const emptyProductForm = {
  id: "",
  name: "",
  department: "tshirts",
  category: "Krishna",
  price: "1699",
  discount: "0",
  stock: "10",
  availability: PRODUCT_AVAILABILITY.IN_STOCK,
  description: "",
  colors: "Black, White",
  sizes: "S, M, L, XL",
  badge: "Signature",
  imageData: "",
  mediaImages: [],
  videoData: ""
};

const DEFAULT_PRODUCT_DEPARTMENTS = ["tshirts"];

const emptyUserForm = {
  name: "",
  email: "",
  auraPoints: "0"
};

const emptyBannerForm = {
  id: "",
  title: "",
  subtitle: "",
  description: "",
  mediaType: "video",
  mediaData: "",
  linkedProductId: "",
  aspectRatio: DEFAULT_BANNER_ASPECT_RATIO
};

const emptyHighlightForm = {
  id: "",
  title: "",
  description: "",
  badge: "",
  iconKey: "quality"
};

const emptyOfferForm = {
  id: "",
  text: ""
};

const DEFAULT_TERMS_AND_CONDITIONS = `Terms & Conditions
1. Acceptance of Terms
By accessing, browsing, or using this website, and/or placing an order, you acknowledge that you have read, understood, and agree to be bound by these Terms & Conditions. If you do not agree, please do not use this website.

2. General Use
You agree to use this website only for lawful purposes and in compliance with all applicable laws. Any misuse, fraudulent activity, or unauthorized access attempt may result in suspension or termination of access.

3. Products & Pricing
All products listed on the website are subject to availability.
We reserve the right to modify product prices, descriptions, or discontinue products at any time without prior notice.
In case of pricing errors, we reserve the right to cancel or refuse any order.

4. Orders & Payments
All orders are subject to acceptance and availability.
Once an order is placed and confirmed, it cannot be cancelled.
We support prepaid and/or Cash on Delivery (COD) orders (if available).
Payments are processed securely through third-party payment gateways.

5. Aura Points (Store Credits)
1 Aura Point = 1 INR
Aura Points can be used only on this website for purchases
They are non-transferable and cannot be exchanged for cash
The company reserves the right to modify or withdraw Aura Points at any time

6. Return & Replacement Policy
Return Window:
Customers can request a return within 3 days of delivery.
Eligible Cases:
Returns are only accepted if:
Wrong product is delivered
Product is damaged or defective
Conditions:
Product must be unused, unwashed, and in original condition
All tags and packaging must be intact
Proof (images/videos) must be provided
Non-Returnable Cases:
Size issues
Change of mind
Used or washed items
Return Shipping:
Shipping cost may be borne by the customer unless the product is defective

7. Refunds & Resolution
In case of approved returns, the Company may, at its discretion:
Provide a replacement product, or
Issue store credits (Aura Points) equivalent to the product value
No direct cash refunds will be provided.

8. Cancellation Policy
Orders once placed cannot be cancelled. Customers are advised to review all details carefully before placing an order.

9. Shipping & Delivery
We aim to deliver products within the estimated time; however, delays may occur due to courier or external factors.
We are not liable for delays beyond our control.

10. Limitation of Liability
We shall not be liable for any indirect, incidental, or consequential damages arising from the use of our website or products.

11. Intellectual Property
All content on this website (images, logos, text, designs) is the property of the Company and cannot be used without permission.

12. Modifications to Terms
We reserve the right to update or modify these Terms & Conditions at any time without prior notice.`;

const DEFAULT_PRIVACY_POLICY = `Privacy Policy
We collect only the basic details needed to process orders, deliveries, customer support, and account-related services on this website.

Your personal information is not sold to third parties. Payment and shipping information may be shared only with trusted service partners when required to complete your order safely and smoothly.

By using this website, you agree that we may use your information for order management, service updates, and store operations.`;

const DEFAULT_CONTACT_EMAIL = "vatsaurateam@gmail.com";

const DEFAULT_ABOUT_US =
  "Vatsaura is built for premium spiritual streetwear, made for people who want their beliefs and everyday style to feel connected.";

const defaultAdminSecurityStatus = {
  needsSetup: false,
  passwordConfigured: true,
  pinConfigured: false,
  otpPreferences: {
    email: false,
    sms: false
  },
  availableContactMethods: {
    email: false,
    sms: false
  },
  deliveryReady: {
    email: false,
    sms: false
  },
  contact: {
    emailMasked: "",
    phoneMasked: "Not configured"
  }
};

const adminTabs = [
  { key: "dashboard", label: "Dashboard" },
  { key: "users", label: "Users" },
  { key: "products", label: "Products" },
  { key: "orders", label: "Orders" },
  { key: "returns", label: "Returns" },
  { key: "content", label: "Content" },
  { key: "settings", label: "Settings" }
];

const COLLECTION_COPY = {
  Krishna: {
    eyebrow: "Grace Collection",
    description: "Fluid monochrome artwork with refined linework inspired by divine calm."
  },
  Mahadev: {
    eyebrow: "Ascend Collection",
    description: "Shadow-heavy graphics and meditative balance with a bold black canvas."
  },
  Hanuman: {
    eyebrow: "Strength Collection",
    description: "Athletic silhouettes with fearless energy and premium heavyweight cotton."
  },
  Narsimha: {
    eyebrow: "Valor Collection",
    description: "Fierce contrast, deep detailing, and statement-led devotional iconography."
  },
  "Shree Ram": {
    eyebrow: "Legacy Collection",
    description: "Minimal sacred motifs elevated with royal spacing and disciplined structure."
  }
};

const defaultProducts = [
  {
    id: "prd-tee-1",
    name: "Krishna Vatsaura Oversized Tee",
    department: "tshirts",
    category: "Krishna",
    price: 1699,
    discount: 0,
    stock: 18,
    badge: "Signature",
    description:
      "Large-format Krishna artwork on heavyweight cotton with a sharp black and white finish.",
    colors: ["Black", "White"],
    sizes: ["S", "M", "L", "XL"],
    imageData: "",
    createdAt: Date.now() - 86400000 * 5
  },
  {
    id: "prd-tee-2",
    name: "Mahadev Eclipse Tee",
    department: "tshirts",
    category: "Mahadev",
    price: 1799,
    discount: 0,
    stock: 14,
    badge: "Dark Edit",
    description:
      "A dramatic monochrome drop with bold Mahadev detailing and an elevated drape.",
    colors: ["Black", "White"],
    sizes: ["S", "M", "L", "XL"],
    imageData: "",
    createdAt: Date.now() - 86400000 * 4
  },
  {
    id: "prd-tee-3",
    name: "Hanuman Force Tee",
    department: "tshirts",
    category: "Hanuman",
    price: 1599,
    discount: 0,
    stock: 21,
    badge: "Power Fit",
    description:
      "Built for strong everyday wear with assertive Hanuman iconography and large visuals.",
    colors: ["Black", "White"],
    sizes: ["S", "M", "L", "XL"],
    imageData: "",
    createdAt: Date.now() - 86400000 * 3
  },
  {
    id: "prd-tee-4",
    name: "Narsimha Edge Tee",
    department: "tshirts",
    category: "Narsimha",
    price: 1899,
    discount: 0,
    stock: 12,
    badge: "Rare Drop",
    description:
      "High-contrast Narsimha artwork with a premium hand feel and gallery-scale print area.",
    colors: ["Black", "White"],
    sizes: ["S", "M", "L", "XL"],
    imageData: "",
    createdAt: Date.now() - 86400000 * 2
  },
  {
    id: "prd-tee-5",
    name: "Shree Ram Crest Tee",
    department: "tshirts",
    category: "Shree Ram",
    price: 1749,
    discount: 0,
    stock: 16,
    badge: "Royal Line",
    description:
      "A clean luxury tee with Shree Ram insignia, strong spacing, and refined monochrome energy.",
    colors: ["Black", "White"],
    sizes: ["S", "M", "L", "XL"],
    imageData: "",
    createdAt: Date.now()
  }
];

const DEFAULT_HOME_HIGHLIGHTS = [
  {
    id: "quality",
    title: "Premium Quality",
    description: "Built with sharp detailing and premium finishing.",
    iconKey: "quality"
  },
  {
    id: "fabric",
    title: "Skin-Friendly Fabric",
    description: "Soft-touch cotton crafted for everyday comfort.",
    iconKey: "fabric"
  },
  {
    id: "limited",
    title: "Limited Edition",
    description: "Small batch devotional drops with exclusive runs.",
    badge: "New",
    iconKey: "limited"
  },
  {
    id: "cod",
    title: "COD Available",
    description: "Fast doorstep delivery with trusted COD support.",
    iconKey: "delivery"
  }
];

const defaultSettings = {
  websiteName: "VATSAURA",
  logoData: "",
  productDepartments: DEFAULT_PRODUCT_DEPARTMENTS,
  tshirtCategories: DEFAULT_TSHIRT_CATEGORIES,
  latestDropProductIds: defaultProducts.slice(0, 4).map((product) => product.id),
  homeHighlights: DEFAULT_HOME_HIGHLIGHTS,
  paymentMethods: {
    upi: true,
    cod: false,
    aura: false
  },
  upiQrData: "",
  upiId: "",
  banners: [
    {
      id: "banner-1",
      title: DEFAULT_BANNER_COPY.title,
      subtitle: DEFAULT_BANNER_COPY.subtitle,
      description: DEFAULT_BANNER_COPY.description,
      mediaType: "video",
      mediaData: "",
      linkedProductId: defaultProducts[0].id,
      aspectRatio: DEFAULT_BANNER_ASPECT_RATIO
    }
  ],
  offers: [],
  termsAndConditions: DEFAULT_TERMS_AND_CONDITIONS,
  privacyPolicy: DEFAULT_PRIVACY_POLICY,
  contactEmail: DEFAULT_CONTACT_EMAIL,
  aboutUs: DEFAULT_ABOUT_US
};

const tone = {
  black: "#050505",
  body: "#101010",
  white: "#ffffff",
  panel: "#ffffff",
  soft: "#ffffff",
  muted: "#6b6b6b",
  border: "#d8d8d8",
  line: "#ebebeb",
  darkLine: "#2a2a2a"
};

const readStorage = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
};

const writeStorage = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(error);
  }
};

const readSessionValue = (key, fallback = "") => {
  try {
    return window.sessionStorage.getItem(key) || fallback;
  } catch (error) {
    return fallback;
  }
};

const writeSessionValue = (key, value) => {
  try {
    if (!value) {
      window.sessionStorage.removeItem(key);
      return;
    }

    window.sessionStorage.setItem(key, value);
  } catch (error) {
    console.error(error);
  }
};

const canUsePersistentStore = () =>
  typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

const openPersistentStore = () =>
  new Promise((resolve, reject) => {
    if (!canUsePersistentStore()) {
      resolve(null);
      return;
    }

    const request = window.indexedDB.open(PERSISTENT_STORE_CONFIG.dbName, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(PERSISTENT_STORE_CONFIG.storeName)) {
        database.createObjectStore(PERSISTENT_STORE_CONFIG.storeName);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Unable to open browser storage."));
  });

const readPersistentStore = async () => {
  const database = await openPersistentStore();

  if (!database) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      PERSISTENT_STORE_CONFIG.storeName,
      "readonly"
    );
    const request = transaction
      .objectStore(PERSISTENT_STORE_CONFIG.storeName)
      .get(PERSISTENT_STORE_CONFIG.key);
    let settled = false;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      database.close();
      callback(value);
    };

    transaction.onabort = () =>
      finish(
        reject,
        transaction.error || new Error("Browser storage read was cancelled.")
      );
    transaction.onerror = () =>
      finish(
        reject,
        transaction.error || new Error("Browser storage read failed.")
      );
    request.onsuccess = () => finish(resolve, request.result || null);
    request.onerror = () =>
      finish(reject, request.error || new Error("Unable to read browser storage."));
  });
};

const writePersistentStore = async (value) => {
  const database = await openPersistentStore();

  if (!database) {
    return false;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      PERSISTENT_STORE_CONFIG.storeName,
      "readwrite"
    );
    const request = transaction
      .objectStore(PERSISTENT_STORE_CONFIG.storeName)
      .put(value, PERSISTENT_STORE_CONFIG.key);
    let settled = false;

    const finish = (callback, nextValue) => {
      if (settled) {
        return;
      }

      settled = true;
      database.close();
      callback(nextValue);
    };

    transaction.onabort = () =>
      finish(
        reject,
        transaction.error || new Error("Browser storage save was cancelled.")
      );
    transaction.onerror = () =>
      finish(
        reject,
        transaction.error || new Error("Browser storage save failed.")
      );
    request.onsuccess = () => finish(resolve, true);
    request.onerror = () =>
      finish(reject, request.error || new Error("Unable to save browser storage."));
  });
};

const writeLegacyStoreSnapshot = ({ products, settings }) => {
  writeStorage(STORAGE_KEYS.products, products);
  writeStorage(STORAGE_KEYS.settings, settings);
};

const clearLegacyStoreSnapshot = () => {
  try {
    window.localStorage.removeItem(STORAGE_KEYS.orders);
    window.localStorage.removeItem(STORAGE_KEYS.products);
    window.localStorage.removeItem(STORAGE_KEYS.users);
    window.localStorage.removeItem(STORAGE_KEYS.settings);
  } catch (error) {
    console.error(error);
  }
};

/** Pick highest `updatedAt` so local IndexedDB edits win over stale cloud reads. Tie-break favors richer payloads. */
const snapshotFreshness = (snapshot) =>
  snapshot && typeof snapshot === "object" ? Number(snapshot.updatedAt) || 0 : -1;

const snapshotRichness = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") {
    return 0;
  }

  let score = 0;

  if (snapshot.settings && typeof snapshot.settings === "object") {
    score += 10;
  }

  score += Number(Array.isArray(snapshot.products) ? snapshot.products.length : 0);
  score += Number(Array.isArray(snapshot.users) ? snapshot.users.length : 0);
  score += Number(Array.isArray(snapshot.orders) ? snapshot.orders.length : 0);

  return score;
};

const pickFreshAppSnapshot = (...candidates) => {
  let best = null;
  let bestTime = -Infinity;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const time = snapshotFreshness(candidate);
    const score = snapshotRichness(candidate);

    if (time > bestTime || (time === bestTime && score > bestScore)) {
      best = candidate;
      bestTime = time;
      bestScore = score;
    }
  }

  return best;
};

const buildLegacyBrowserSnapshot = () => {
  try {
    const ordersRaw = window.localStorage.getItem(STORAGE_KEYS.orders);
    const productsRaw = window.localStorage.getItem(STORAGE_KEYS.products);
    const usersRaw = window.localStorage.getItem(STORAGE_KEYS.users);
    const settingsRaw = window.localStorage.getItem(STORAGE_KEYS.settings);

    if (!ordersRaw && !productsRaw && !usersRaw && !settingsRaw) {
      return null;
    }

    const parse = (raw) => {
      if (!raw) {
        return undefined;
      }

      try {
        return JSON.parse(raw);
      } catch (_error) {
        return undefined;
      }
    };

    const orders = parse(ordersRaw);
    const products = parse(productsRaw);
    const users = parse(usersRaw);
    const settings = parse(settingsRaw);

    return {
      version: 1,
      updatedAt: 0,
      orders: Array.isArray(orders) ? orders : [],
      products: Array.isArray(products) ? products : [],
      users: Array.isArray(users) ? users : [],
      settings: settings && typeof settings === "object" ? settings : undefined
    };
  } catch (error) {
    console.warn(error);
    return null;
  }
};

const normalizeCategoryName = (value) =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const sanitizeStoredProductIds = (ids, limit = MAX_LATEST_DROPS) => {
  if (!Array.isArray(ids)) {
    return [];
  }

  return ids
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, limit);
};

const normalizeAspectRatio = (
  value,
  fallback = DEFAULT_BANNER_ASPECT_RATIO
) => {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) && numericValue > 0.35 && numericValue < 5
    ? numericValue
    : fallback;
};

const sanitizeTshirtCategories = (categories) => {
  const fallback =
    Array.isArray(categories) && categories.length > 0
      ? categories
      : DEFAULT_TSHIRT_CATEGORIES;

  const normalized = fallback
    .map(normalizeCategoryName)
    .filter(Boolean)
    .filter((category, index, array) => array.indexOf(category) === index);

  return normalized.length > 0 ? normalized : DEFAULT_TSHIRT_CATEGORIES;
};

const normalizeDepartmentName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const sanitizeProductDepartments = (departments) => {
  const fallback =
    Array.isArray(departments) && departments.length > 0
      ? departments
      : DEFAULT_PRODUCT_DEPARTMENTS;

  const normalized = fallback
    .map(normalizeDepartmentName)
    .filter(Boolean)
    .filter((department, index, array) => array.indexOf(department) === index);

  return normalized.length > 0 ? normalized : DEFAULT_PRODUCT_DEPARTMENTS;
};

const formatDepartmentLabel = (department) => {
  const normalizedDepartment = normalizeDepartmentName(department);

  if (normalizedDepartment === "tshirts") {
    return "T-Shirts";
  }

  return normalizedDepartment
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const normalizeBanner = (banner, index = 0) => {
  const rawTitle = String(banner?.title || "").trim();
  const rawSubtitle = String(banner?.subtitle || "").trim();
  const rawDescription = String(banner?.description || "").trim();
  const mediaData = String(banner?.mediaData || "").trim();
  const mediaType =
    banner?.mediaType ||
    (mediaData ? (isVideoSource(mediaData) ? "video" : "image") : "video");
  const useDefaultCopy =
    rawTitle.toLowerCase() === "homepage banner" ||
    /^banner \d+$/i.test(rawTitle);

  return {
    id: banner?.id || `banner-${index + 1}`,
    title: useDefaultCopy ? DEFAULT_BANNER_COPY.title : rawTitle,
    subtitle: rawSubtitle || (useDefaultCopy ? DEFAULT_BANNER_COPY.subtitle : ""),
    description:
      rawDescription || (useDefaultCopy ? DEFAULT_BANNER_COPY.description : ""),
    mediaType,
    mediaData,
    aspectRatio: normalizeAspectRatio(
      banner?.aspectRatio,
      DEFAULT_BANNER_ASPECT_RATIO
    ),
    linkedProductId: String(
      banner?.linkedProductId ||
        (useDefaultCopy ? defaultProducts[0]?.id || "" : "")
    ).trim()
  };
};

const normalizeHomeHighlight = (highlight, index = 0) => ({
  id: highlight?.id || `highlight-${index + 1}`,
  title: String(highlight?.title || "").trim() || `Feature ${index + 1}`,
  description: String(highlight?.description || "").trim(),
  badge: String(highlight?.badge || "").trim(),
  iconKey: HOME_HIGHLIGHT_ICON_COMPONENTS[highlight?.iconKey]
    ? highlight.iconKey
    : HOME_HIGHLIGHT_ICON_OPTIONS[0].value
});

const normalizeStoredHomeHighlights = (
  highlights,
  fallbackHighlights = []
) => {
  if (!Array.isArray(highlights)) {
    return fallbackHighlights.map((highlight, index) =>
      normalizeHomeHighlight(highlight, index)
    );
  }

  return highlights
    .map((highlight, index) => normalizeHomeHighlight(highlight, index))
    .slice(0, MAX_HOME_HIGHLIGHTS);
};

const normalizeStoredBanners = (banners) => {
  if (!Array.isArray(banners)) {
    return [];
  }

  return banners
    .map((banner, index) => normalizeBanner(banner, index))
    .slice(0, MAX_HOME_BANNERS);
};

const getBannerMediaSource = (banner) => {
  const custom = String(banner?.mediaData || "").trim();

  return custom ? resolveCloudinaryMediaUrl(custom) : brandHeaderVideo;
};

const getBannerMediaType = (banner) => {
  const source = getBannerMediaSource(banner);
  const hasCustomMedia = Boolean(String(banner?.mediaData || "").trim());

  return hasCustomMedia
    ? banner?.mediaType || (isVideoSource(source) ? "video" : "image")
    : isVideoSource(source)
      ? "video"
      : "image";
};

const normalizeSettingsState = (storedSettings) => {
  const safeSettings =
    storedSettings && typeof storedSettings === "object"
      ? storedSettings
      : defaultSettings;
  const normalizedStoredBanners = normalizeStoredBanners(safeSettings.banners);

  return {
    ...defaultSettings,
    ...safeSettings,
    websiteName:
      String(safeSettings.websiteName || "").trim() || defaultSettings.websiteName,
    logoData: safeSettings.logoData || defaultSettings.logoData,
    productDepartments: sanitizeProductDepartments(safeSettings.productDepartments),
    tshirtCategories: sanitizeTshirtCategories(safeSettings.tshirtCategories),
    banners: normalizedStoredBanners,
    homeHighlights: normalizeStoredHomeHighlights(
      safeSettings.homeHighlights || defaultSettings.homeHighlights
    ),
    latestDropProductIds: sanitizeStoredProductIds(
      safeSettings.latestDropProductIds || defaultSettings.latestDropProductIds,
      MAX_LATEST_DROPS
    ),
    termsAndConditions:
      typeof safeSettings.termsAndConditions === "string" &&
      safeSettings.termsAndConditions.trim()
        ? safeSettings.termsAndConditions
        : defaultSettings.termsAndConditions,
    privacyPolicy:
      typeof safeSettings.privacyPolicy === "string" &&
      safeSettings.privacyPolicy.trim()
        ? safeSettings.privacyPolicy
        : defaultSettings.privacyPolicy,
    contactEmail:
      typeof safeSettings.contactEmail === "string" && safeSettings.contactEmail.trim()
        ? safeSettings.contactEmail
        : defaultSettings.contactEmail,
    aboutUs:
      typeof safeSettings.aboutUs === "string" && safeSettings.aboutUs.trim()
        ? safeSettings.aboutUs
        : defaultSettings.aboutUs,
    paymentMethods: {
      ...defaultSettings.paymentMethods,
      ...(safeSettings.paymentMethods || {})
    }
  };
};

const createInitialSettings = () =>
  normalizeSettingsState(readStorage(STORAGE_KEYS.settings, defaultSettings));

const normalizeProductsState = (
  storedProducts,
  initialSettings = defaultSettings
) => {
  const categories = sanitizeTshirtCategories(initialSettings.tshirtCategories);
  const departments = sanitizeProductDepartments(initialSettings.productDepartments);
  const safeProducts =
    Array.isArray(storedProducts) && storedProducts.length > 0
      ? storedProducts
      : defaultProducts;

  const normalizedProducts = safeProducts
    .map(normalizeProduct)
    .map((product, index) => {
      const normalizedCategory = normalizeCategoryName(product.category);
      const normalizedDepartment = normalizeDepartmentName(product.department);
      const safeDepartment = departments.includes(normalizedDepartment)
        ? normalizedDepartment
        : DEFAULT_PRODUCT_DEPARTMENTS[0];

      return {
        ...product,
        department: safeDepartment,
        category:
          safeDepartment === "tshirts" && categories.includes(normalizedCategory)
            ? normalizedCategory
            : safeDepartment === "tshirts"
              ? categories[index % categories.length] || DEFAULT_TSHIRT_CATEGORIES[0]
              : normalizedCategory || "General"
      };
    });

  return normalizedProducts.length > 0
    ? normalizedProducts
    : defaultProducts.map((product, index) => {
        const normalizedProduct = normalizeProduct(product);
        const normalizedCategory = normalizeCategoryName(normalizedProduct.category);
        const normalizedDepartment = normalizeDepartmentName(normalizedProduct.department);
        const safeDepartment = departments.includes(normalizedDepartment)
          ? normalizedDepartment
          : DEFAULT_PRODUCT_DEPARTMENTS[0];

        return {
          ...normalizedProduct,
          department: safeDepartment,
          category:
            safeDepartment === "tshirts" && categories.includes(normalizedCategory)
              ? normalizedCategory
              : safeDepartment === "tshirts"
                ? categories[index % categories.length] || DEFAULT_TSHIRT_CATEGORIES[0]
                : normalizedCategory || "General"
        };
      });
};

const createInitialProducts = () => {
  const initialSettings = createInitialSettings();
  const storedProducts = readStorage(STORAGE_KEYS.products, defaultProducts);

  return normalizeProductsState(storedProducts, initialSettings);
};

const isVideoSource = (source) => {
  const value = String(source || "");
  return (
    value.startsWith("data:video") ||
    /\/video\/upload\//i.test(value) ||
    /\.(?:mp4|webm|mov|m4v)($|\?)/i.test(value)
  );
};

const createId = (prefix) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const normalizePhone = (value) => String(value || "").replace(/\D/g, "");

const formatDateTimeLabel = (value) =>
  new Date(Number(value) || Date.now()).toLocaleString("en-IN");

const buildUserDocId = (email) => normalizeEmail(email);
const RETURN_REQUEST_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const createOrderId = () => {
  const datePrefix = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  try {
    const bytes = new Uint32Array(2);
    window.crypto.getRandomValues(bytes);
    return `VA-${datePrefix}-${bytes[0].toString(36)}${bytes[1].toString(36)}`.toUpperCase();
  } catch (_error) {
    return `VA-${datePrefix}-${createId("ord").replace(/^ord-/, "").toUpperCase()}`;
  }
};

const buildPublicStoreSnapshot = ({ products, settings, updatedAt = Date.now() }) => ({
  version: 2,
  updatedAt,
  products,
  settings
});

const normalizeUserRecord = (record = {}) => {
  const email = normalizeEmail(record.email);
  const fallbackName = email ? email.split("@")[0] : "Customer";
  const role = ADMIN_EMAILS.includes(email) ? "admin" : (record.role || "customer");

  return {
    id: record.id || createId("usr"),
    uid: String(record.uid || ""),
    name: String(record.name || fallbackName).trim() || fallbackName,
    email,
    phone: String(record.phone || "").trim(),
    gender: String(record.gender || "").trim(),
    birthdate: String(record.birthdate || "").trim(),
    photo: String(record.photo || "").trim(),
    role,
    status: record.status === "blocked" ? "blocked" : "active",
    joinedAt: Number(record.joinedAt) || Date.now(),
    lastLoginAt: record.lastLoginAt ? Number(record.lastLoginAt) : null,
    auraPoints: Number(record.auraPoints || 0),
    totalSpent: Number(record.totalSpent || 0),
    totalOrders: Number(record.totalOrders || 0),
    auraHistory: Array.isArray(record.auraHistory) ? record.auraHistory : []
  };
};

const normalizeOrderRecord = (record = {}) => {
  const customer = {
    ...initialCheckoutForm,
    ...(record.customer && typeof record.customer === "object" ? record.customer : {})
  };
  const userEmail = normalizeEmail(record.userEmail || customer.email);
  const userPhone = normalizePhone(record.userPhone || customer.phone);
  const returnRequest =
    record.returnRequest && typeof record.returnRequest === "object"
      ? {
          name: String(record.returnRequest.name || "").trim(),
          phone: String(record.returnRequest.phone || "").trim(),
          reason: String(record.returnRequest.reason || "").trim(),
          requestedAt: Number(record.returnRequest.requestedAt) || 0,
          requestedAtLabel:
            String(record.returnRequest.requestedAtLabel || "").trim() ||
            (record.returnRequest.requestedAt
              ? formatDateTimeLabel(record.returnRequest.requestedAt)
              : "")
        }
      : null;

  return {
    ...record,
    id: String(record.id || createOrderId()),
    createdAt: Number(record.createdAt) || Date.now(),
    dateLabel:
      String(record.dateLabel || "").trim() ||
      new Date(Number(record.createdAt) || Date.now()).toLocaleString("en-IN"),
    userUid: String(record.userUid || ""),
    userEmail,
    userPhone,
    status: String(record.status || "Pending Payment").trim(),
    items: Array.isArray(record.items) ? record.items : [],
    total: Number(record.total || 0),
    codCharge: Number(record.codCharge || 0),
    auraPointsUsed: Number(record.auraPointsUsed || 0),
    remainingPayable: Number(record.remainingPayable ?? record.total ?? 0),
    deliveredAt: Number(record.deliveredAt) || 0,
    deliveredAtLabel:
      String(record.deliveredAtLabel || "").trim() ||
      (record.deliveredAt ? formatDateTimeLabel(record.deliveredAt) : ""),
    refundRequested: Boolean(record.refundRequested),
    returnRequested: Boolean(record.returnRequested),
    returnRequestStatus:
      String(record.returnRequestStatus || "").trim() ||
      (record.returnRequested ? "Pending" : ""),
    returnRequest,
    customer: {
      ...customer,
      email: userEmail || String(customer.email || "").trim(),
      phone: String(customer.phone || "").trim()
    }
  };
};

const sortOrdersNewestFirst = (records) =>
  [...(Array.isArray(records) ? records : [])]
    .map((entry) => normalizeOrderRecord(entry))
    .filter(
      (entry, index, array) => array.findIndex((candidate) => candidate.id === entry.id) === index
    )
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));

const doesOrderBelongToUser = (order, userRecord) => {
  const orderUid = String(order?.userUid || "").trim();
  const orderEmail = normalizeEmail(order?.userEmail || order?.customer?.email);
  const orderPhone = normalizePhone(order?.userPhone || order?.customer?.phone);
  const userUid = String(userRecord?.uid || "").trim();
  const email = normalizeEmail(userRecord?.email);
  const phone = normalizePhone(userRecord?.phone);

  return Boolean(
    (userUid && orderUid && userUid === orderUid) ||
      (email && orderEmail && email === orderEmail) ||
      (phone && orderPhone && phone === orderPhone)
  );
};

const getReturnWindowDeadline = (order) => {
  const deliveredAt = Number(order?.deliveredAt || 0);
  return deliveredAt > 0 ? deliveredAt + RETURN_REQUEST_WINDOW_MS : 0;
};

const canRequestReturnForOrder = (order) => {
  const deliveredAt = Number(order?.deliveredAt || 0);

  return Boolean(
    order?.status === "Delivered" &&
      deliveredAt > 0 &&
      Date.now() <= getReturnWindowDeadline(order) &&
      !order?.returnRequested
  );
};

const matchesOrderSearch = (order, term) => {
  const normalizedTerm = String(term || "").trim().toLowerCase();

  if (!normalizedTerm) {
    return true;
  }

  return [
    String(order?.id || ""),
    String(order?.customer?.name || ""),
    String(order?.customer?.phone || ""),
    String(order?.userPhone || "")
  ].some((value) => value.toLowerCase().includes(normalizedTerm));
};

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(amount);

const formatProductSubtitle = (product) => {
  const department = String(product?.department || "").trim().toLowerCase();

  if (department === "tshirts") {
    return `${product?.category || "Premium"} T-Shirts`;
  }

  return `${product?.category || "Signature"} Collection`;
};

const discountPrice = (product) =>
  Math.max(0, product.price - Math.round((product.price * product.discount) / 100));

const createDefaultConfig = (product) => ({
  color: product.colors?.[0] || "Black",
  size: product.sizes?.[0] || "M",
  quantity: 1
});

const getProductImages = (product) => {
  const arrayImages = Array.isArray(product?.mediaImages)
    ? product.mediaImages.filter(Boolean)
    : [];
  const baseImages = arrayImages.length > 0
    ? arrayImages
    : product?.imageData
      ? [product.imageData]
      : [];

  return baseImages
    .filter(Boolean)
    .slice(0, 6)
    .map((src) => resolveCloudinaryMediaUrl(src));
};

const getProductVideo = (product) =>
  resolveCloudinaryMediaUrl(String(product?.videoData || "").trim());

const getProductMediaItems = (product) => {
  const images = getProductImages(product).map((src, index) => ({
    id: `image-${index}`,
    type: "image",
    src,
    title: `Image ${index + 1}`,
    note: product?.badge || "Product Detail"
  }));

  const video = getProductVideo(product);

  return video
    ? [
        ...images,
        {
          id: "video",
          type: "video",
          src: video,
          title: "Product Video",
          note: "Tap or hover for closer view"
        }
      ]
    : images;
};

const normalizeProduct = (product) => ({
  ...product,
  colors: Array.isArray(product.colors)
    ? product.colors
    : String(product.colors || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
  sizes: Array.isArray(product.sizes)
    ? product.sizes
    : String(product.sizes || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
  price: Number(product.price) || 0,
  discount: Number(product.discount) || 0,
  stock: Number(product.stock) || 0,
  availability: normalizeProductAvailability(product.availability, product.stock),
  createdAt: product.createdAt || Date.now(),
  mediaImages: getProductImages(product),
  videoData: getProductVideo(product),
  imageData: getProductImages(product)[0] || product.imageData || ""
});

const buildProductSearchHaystack = (product) =>
  [
    product?.name,
    product?.department,
    product?.category,
    product?.description,
    product?.badge,
    ...(Array.isArray(product?.colors) ? product.colors : []),
    ...(Array.isArray(product?.sizes) ? product.sizes : [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const getProductSearchRank = (product, searchValue) => {
  const term = String(searchValue || "").trim().toLowerCase();

  if (!term) {
    return 99;
  }

  const name = String(product?.name || "").toLowerCase();
  const category = String(product?.category || "").toLowerCase();
  const badge = String(product?.badge || "").toLowerCase();
  const description = String(product?.description || "").toLowerCase();

  if (name.startsWith(term)) {
    return 0;
  }

  if (name.includes(term)) {
    return 1;
  }

  if (category.startsWith(term)) {
    return 2;
  }

  if (category.includes(term)) {
    return 3;
  }

  if (badge.includes(term)) {
    return 4;
  }

  if (description.includes(term)) {
    return 5;
  }

  return 6;
};

const mergeAdminUsers = (storedUsers) => {
  const safeUsers = (Array.isArray(storedUsers) ? storedUsers : []).map((entry) =>
    normalizeUserRecord(entry)
  );
  const adminEntries = ADMIN_EMAILS.map((email) => {
    const existing = safeUsers.find(
      (item) => item.email?.toLowerCase() === email.toLowerCase()
    );

    return normalizeUserRecord({
      ...existing,
      email,
      role: "admin"
    });
  });

  const nonAdmins = safeUsers.filter(
    (item) =>
      !ADMIN_EMAILS.includes(String(item.email || "").toLowerCase())
  );

  return [...adminEntries, ...nonAdmins];
};

const normalizeWishlist = (storedWishlist) => {
  if (!Array.isArray(storedWishlist)) {
    return [];
  }

  return storedWishlist
    .map((item) => (typeof item === "string" ? item : item?.id))
    .filter(Boolean);
};

const sumSales = (orders) =>
  orders.reduce((total, order) => {
    const unconfirmedStatuses = ["Rejected", "Unpaid", "Refunded", "Pending Payment", "Payment Submitted"];
    if (unconfirmedStatuses.includes(order.status)) {
      return total;
    }

    return total + Number(order.total || 0);
  }, 0);

const getRangeTotal = (orders, startTime) =>
  orders.reduce((total, order) => {
    const unconfirmedStatuses = ["Rejected", "Unpaid", "Refunded", "Pending Payment", "Payment Submitted"];
    if (unconfirmedStatuses.includes(order.status) || Number(order.createdAt) < startTime) {
      return total;
    }

    return total + Number(order.total || 0);
  }, 0);

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

const startOfWeek = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.getFullYear(), now.getMonth(), diff).getTime();
};

const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
};

const uploadFileToCloudinary = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const resourceType = getFileMediaType(file) === "video" ? "video" : "image";
  const response = await fetch(`${CLOUDINARY_UPLOAD_BASE}/${resourceType}/upload`, {
    method: "POST",
    body: formData
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.secure_url) {
    const message =
      (data && data.error && data.error.message) ||
      (typeof data === "string" ? data : "") ||
      "Cloudinary upload failed.";
    throw new Error(message);
  }

  return data.secure_url;
};

const getFileMediaType = (file) => {
  const mimeType = String(file?.type || "").toLowerCase();

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  return "";
};

const getFirebaseProfilePhotoUrl = (firebaseUser) => {
  if (!firebaseUser) {
    return "";
  }

  const direct = String(firebaseUser.photoURL || "").trim();
  if (direct) {
    return direct;
  }

  const fromProvider = firebaseUser.providerData?.find((p) =>
    String(p?.photoURL || "").trim()
  );
  return String(fromProvider?.photoURL || "").trim();
};

const getMediaAspectRatio = (mediaSrc, mediaType = "image") =>
  new Promise((resolve) => {
    const fallback = DEFAULT_BANNER_ASPECT_RATIO;

    if (!mediaSrc) {
      resolve(fallback);
      return;
    }

    if (mediaType === "video") {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () =>
        resolve(normalizeAspectRatio(video.videoWidth / video.videoHeight, fallback));
      video.onerror = () => resolve(fallback);
      video.src = mediaSrc;
      return;
    }

    const image = new Image();
    image.onload = () =>
      resolve(normalizeAspectRatio(image.naturalWidth / image.naturalHeight, fallback));
    image.onerror = () => resolve(fallback);
    image.src = mediaSrc;
  });

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};

const MenuIcon = () => (
  <svg {...iconProps}>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </svg>
);

const CloseIcon = () => (
  <svg {...iconProps}>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
);

const LockIcon = (props) => (
  <svg {...iconProps} {...props}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const SearchIcon = () => (
  <svg {...iconProps}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

const WalletIcon = () => (
  <svg {...iconProps}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z" />
    <path d="M16 12h4" />
    <circle cx="16" cy="12" r="1" />
  </svg>
);

const HeartIcon = (props) => (
  <svg {...iconProps} {...props}>
    <path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.65-7 10-7 10Z" />
  </svg>
);

const CartIcon = () => (
  <svg {...iconProps}>
    <path d="M3 5h2l2.5 9h9L19 8H7.5" />
    <circle cx="10" cy="19" r="1.2" />
    <circle cx="17" cy="19" r="1.2" />
  </svg>
);

const UserIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="8" r="3.2" />
    <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
  </svg>
);

const QualitySealIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="8.5" r="4" />
    <path d="m9.3 13.3-1 6.2 3.7-2.2 3.7 2.2-1-6.2" />
    <path d="m10.5 8.4 1 1 2-2" />
  </svg>
);

const LeafAccentIcon = () => (
  <svg {...iconProps}>
    <path d="M19 5c-5.6 0-9.3 2.7-10.8 7.8" />
    <path d="M5 19c4.8 0 8.1-1.7 10-5.1" />
    <path d="M6 14c2.6-2.6 6.4-4.2 11-4.6" />
  </svg>
);

const LimitedDropIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="8.4" r="3.8" />
    <path d="m9.4 13.3-1.1 5.6 3.7-2.2 3.7 2.2-1.1-5.6" />
    <path d="m12 5.9.8 1.5 1.7.2-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.2Z" />
  </svg>
);

const DeliveryTruckIcon = () => (
  <svg {...iconProps}>
    <path d="M3.5 7.5h10v7h-10z" />
    <path d="M13.5 10h3l2 2.5V14h-5Z" />
    <circle cx="7.5" cy="17.5" r="1.2" />
    <circle cx="16.5" cy="17.5" r="1.2" />
    <path d="M5.5 10H3" />
    <path d="M6.5 12H2.5" />
  </svg>
);

const ArrowRightIcon = ({ width = 18, height = 18 } = {}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

const HOME_HIGHLIGHT_ICON_OPTIONS = [
  { value: "quality", label: "Quality Seal" },
  { value: "fabric", label: "Leaf Fabric" },
  { value: "limited", label: "Limited Badge" },
  { value: "delivery", label: "Delivery Truck" }
];

const HOME_HIGHLIGHT_ICON_COMPONENTS = {
  quality: QualitySealIcon,
  fabric: LeafAccentIcon,
  limited: LimitedDropIcon,
  delivery: DeliveryTruckIcon
};

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "14px",
  border: `1px solid ${tone.border}`,
  background: tone.white,
  color: tone.body,
  outline: "none",
  fontSize: "14px",
  boxSizing: "border-box"
};

const textareaStyle = {
  ...inputStyle,
  minHeight: "104px",
  resize: "vertical"
};

const selectStyle = {
  ...inputStyle,
  appearance: "none"
};

const primaryButtonStyle = {
  border: `1px solid ${tone.black}`,
  background: tone.black,
  color: tone.white,
  padding: "12px 16px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: 700
};

const secondaryButtonStyle = {
  border: `1px solid ${tone.border}`,
  background: tone.white,
  color: tone.body,
  padding: "12px 16px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: 700
};

const buyNowButtonStyle = {
  border: "none",
  background: tone.black,
  color: tone.white,
  padding: "16px 32px",
  borderRadius: "999px",
  cursor: "pointer",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.18em",
  fontSize: "13px",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
  width: "100%",
  display: "flex",
  justifyContent: "center",
  alignItems: "center"
};

const shellStyle = {
  maxWidth: "1240px",
  margin: "0 auto",
  padding: "28px 20px 56px"
};

const cardStyle = {
  background: tone.panel,
  borderRadius: "24px",
  border: `1px solid ${tone.line}`,
  padding: "24px",
  boxSizing: "border-box"
};

export default function App() {
  const frontendAdminEmail = ADMIN_EMAILS[0] || "";
  const [user, setUser] = useState(null);
  const [activePage, setActivePage] = useState("home");
  const [history, setHistory] = useState([]);
  const activePageRef = useRef(activePage);
  const pageHistoryRef = useRef(history);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTshirtMenu, setShowTshirtMenu] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("featured");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productConfig, setProductConfig] = useState(null);
  const [checkoutForm, setCheckoutForm] = useState(initialCheckoutForm);
  const [paymentMethod, setPaymentMethod] = useState("upi");
  const [adminTab, setAdminTab] = useState("dashboard");
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [bannerForm, setBannerForm] = useState(emptyBannerForm);
  const [highlightForm, setHighlightForm] = useState(emptyHighlightForm);
  const [offerForm, setOfferForm] = useState(emptyOfferForm);
  const [policyForm, setPolicyForm] = useState({
    termsAndConditions: defaultSettings.termsAndConditions,
    privacyPolicy: defaultSettings.privacyPolicy,
    contactEmail: defaultSettings.contactEmail,
    aboutUs: defaultSettings.aboutUs
  });
  const [selectedAdminOrderId, setSelectedAdminOrderId] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [departmentDraft, setDepartmentDraft] = useState("");
  const [navHidden, setNavHidden] = useState(false);
  const [zoomedMedia, setZoomedMedia] = useState(null);
  const [toast, setToast] = useState("");
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);
  const [bannerTransitionEnabled, setBannerTransitionEnabled] = useState(true);
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const adminSecurityStatus = defaultAdminSecurityStatus;
  const [adminSecurityError, setAdminSecurityError] = useState("");
  const [adminAuthStep, setAdminAuthStep] = useState("loginPassword");
  const [adminSessionToken, setAdminSessionToken] = useState(() =>
    readSessionValue(STORAGE_KEYS.adminSession, "")
  );
  const [hasAdminAccess, setHasAdminAccess] = useState(false);
  const [adminBackendAccess, setAdminBackendAccess] = useState(null);
  const [adminLoginForm, setAdminLoginForm] = useState({
    email: frontendAdminEmail,
    password: "",
    pin: "",
    otpMethod: "email",
    otpCode: ""
  });
  const [adminSecurityForm, setAdminSecurityForm] = useState({
    currentPassword: "",
    nextPassword: "",
    confirmNextPassword: "",
    currentPin: "",
    nextPin: "",
    confirmNextPin: "",
    enableEmailOtp: true,
    enableSmsOtp: false
  });
  const [auraActionForm, setAuraActionForm] = useState({
    amount: "",
    reason: "",
    targetUserEmail: ""
  });
  const [, setRazorpayLoading] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: "",
    phone: "",
    gender: "",
    birthdate: ""
  });
  const [returnRequestForm, setReturnRequestForm] = useState({
    orderId: "",
    name: "",
    phone: "",
    reason: ""
  });
  const [adminOrdersSearch, setAdminOrdersSearch] = useState("");
  const [adminReturnsSearch, setAdminReturnsSearch] = useState("");

  const [cart, setCart] = useState(() => readStorage(STORAGE_KEYS.cart, []));
  const [wishlist, setWishlist] = useState(() =>
    normalizeWishlist(readStorage(STORAGE_KEYS.wishlist, []))
  );
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState(createInitialProducts);
  const [users, setUsers] = useState(() => mergeAdminUsers([]));
  const [settings, setSettings] = useState(createInitialSettings);
  const [storeHydrated, setStoreHydrated] = useState(false);

  const usersRef = useRef(users);
  const legacyOrdersRef = useRef([]);
  const legacyUsersRef = useRef([]);
  const drawerRef = useRef(null);
  const tshirtRef = useRef(null);
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);
  const productMediaTouchRef = useRef(null);
  const bannerResetTimerRef = useRef(null);
  const activeBannerIndexRef = useRef(0);
  const persistentSaveTimerRef = useRef(null);
  const lastAuthenticatedEmailRef = useRef("");

  const userEmail = String(user?.email || "").toLowerCase();
  const isAdminOwner = Boolean(userEmail) && ADMIN_EMAILS.includes(userEmail);
  const isAdmin = isAdminOwner && hasAdminAccess;
  const activeAdminEmail = isAdminOwner ? userEmail : frontendAdminEmail;
  const currentUserRecord = useMemo(() => 
    users.find((entry) => entry.email?.toLowerCase() === userEmail),
    [users, userEmail]
  );
  const uniqueOrders = useMemo(() => sortOrdersNewestFirst(orders), [orders]);
  const auraPoints = useMemo(() => Number(currentUserRecord?.auraPoints || 0), [currentUserRecord]);
  const siteName = settings.websiteName || defaultSettings.websiteName;
  const storeTermsAndConditions =
    settings.termsAndConditions || defaultSettings.termsAndConditions;
  const storePrivacyPolicy = settings.privacyPolicy || defaultSettings.privacyPolicy;
  const storeContactEmail = settings.contactEmail || defaultSettings.contactEmail;
  const storeAboutUs = settings.aboutUs || defaultSettings.aboutUs;
  const managedTshirtCategories = useMemo(() => sanitizeTshirtCategories(settings.tshirtCategories), [settings.tshirtCategories]);
  const managedProductDepartments = useMemo(
    () => sanitizeProductDepartments(settings.productDepartments),
    [settings.productDepartments]
  );
  const selectedProduct = useMemo(() => products.find((item) => item.id === selectedProductId) || null, [products, selectedProductId]);
  const enabledPaymentOptions = useMemo(() => paymentCatalog.filter(
    (option) => settings.paymentMethods?.[option.value]
  ), [settings.paymentMethods]);
  const cartCount = useMemo(() => cart.reduce((count, item) => count + Number(item.quantity || 0), 0), [cart]);
  const cartTotal = useMemo(() => cart.reduce(
    (total, item) => total + Number(item.unitPrice || 0) * Number(item.quantity || 0),
    0
  ), [cart]);
  const dailySales = useMemo(() => getRangeTotal(uniqueOrders, startOfToday()), [uniqueOrders]);
  const weeklySales = useMemo(() => getRangeTotal(uniqueOrders, startOfWeek()), [uniqueOrders]);
  const monthlySales = useMemo(() => getRangeTotal(uniqueOrders, startOfMonth()), [uniqueOrders]);
  const totalSales = useMemo(() => sumSales(uniqueOrders), [uniqueOrders]);
  const brandMediaSource = settings.logoData
    ? resolveCloudinaryMediaUrl(settings.logoData)
    : brandHeaderVideo;
  const brandMediaIsVideo = isVideoSource(brandMediaSource);
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const hasActiveSearch = Boolean(normalizedSearchTerm);
  const searchSuggestions = useMemo(() => hasActiveSearch
    ? products
        .filter(
          (product) => buildProductSearchHaystack(product).includes(normalizedSearchTerm)
        )
        .sort((left, right) => {
          const rankDifference =
            getProductSearchRank(left, normalizedSearchTerm) -
            getProductSearchRank(right, normalizedSearchTerm);

          if (rankDifference !== 0) {
            return rankDifference;
          }

          return Number(right.createdAt || 0) - Number(left.createdAt || 0);
        })
        .slice(0, 6)
    : [], [hasActiveSearch, products, normalizedSearchTerm]);

  const tshirtCategories = useMemo(() => [
    { value: "all", label: "All Collections" },
    ...managedTshirtCategories.map((category) => ({
        value: category,
        label: category
      }))
  ], [managedTshirtCategories]);
  const departmentOptions = useMemo(
    () =>
      managedProductDepartments.map((department) => ({
        value: department,
        label: formatDepartmentLabel(department)
      })),
    [managedProductDepartments]
  );

  const filteredProducts = useMemo(() => products
    .filter((product) => {
      if (!hasActiveSearch && selectedDepartment !== "all" && product.department !== selectedDepartment) {
        return false;
      }

      if (
        !hasActiveSearch &&
        selectedDepartment === "tshirts" &&
        selectedCategory !== "all" &&
        product.category !== selectedCategory
      ) {
        return false;
      }

      return buildProductSearchHaystack(product).includes(normalizedSearchTerm);
    })
    .sort((left, right) => {
      if (sortBy === "priceLow") {
        return discountPrice(left) - discountPrice(right);
      }

      if (sortBy === "priceHigh") {
        return discountPrice(right) - discountPrice(left);
      }

      if (sortBy === "newest") {
        return Number(right.createdAt || 0) - Number(left.createdAt || 0);
      }

      return 0;
    }), [products, hasActiveSearch, selectedDepartment, selectedCategory, normalizedSearchTerm, sortBy]);

  const tshirtProducts = filteredProducts;
  const availableProductCategories = useMemo(() => productForm.category
    ? [...new Set([productForm.category, ...managedTshirtCategories])]
    : managedTshirtCategories, [productForm.category, managedTshirtCategories]);
  const productFormImages = getProductImages(productForm);
  const productFormVideo = getProductVideo(productForm);
  const filteredAdminOrders = useMemo(
    () => uniqueOrders.filter((order) => matchesOrderSearch(order, adminOrdersSearch)),
    [uniqueOrders, adminOrdersSearch]
  );
  const returnOrders = useMemo(
    () => uniqueOrders.filter((order) => order.returnRequested || order.returnRequestStatus),
    [uniqueOrders]
  );
  const filteredReturnOrders = useMemo(
    () => returnOrders.filter((order) => matchesOrderSearch(order, adminReturnsSearch)),
    [returnOrders, adminReturnsSearch]
  );
  const selectedAdminOrder = useMemo(() => 
    filteredAdminOrders.find((order) => order.id === selectedAdminOrderId) ||
      filteredAdminOrders[0] ||
      null,
    [filteredAdminOrders, selectedAdminOrderId]
  );
  const managedHomepageBanners = useMemo(() => normalizeStoredBanners(settings.banners), [settings.banners]);
  const homepageBanners = useMemo(() => 
    managedHomepageBanners.length > 0
      ? managedHomepageBanners
      : defaultSettings.banners
          .map((banner, index) => normalizeBanner(banner, index))
          .slice(0, MAX_HOME_BANNERS),
    [managedHomepageBanners]
  );
  const heroCarouselBanners = useMemo(() => 
    homepageBanners.length > 1 ? [...homepageBanners, homepageBanners[0]] : homepageBanners,
    [homepageBanners]
  );
  const activeHomepageBannerIndex =
    homepageBanners.length > 0 ? activeBannerIndex % homepageBanners.length : 0;
  const activeHomepageBanner =
    homepageBanners[activeHomepageBannerIndex] || homepageBanners[0] || null;
  const activeHomepageBannerAspectRatio = useMemo(() => normalizeAspectRatio(
    activeHomepageBanner?.aspectRatio,
    DEFAULT_BANNER_ASPECT_RATIO
  ), [activeHomepageBanner]);
  activeBannerIndexRef.current = activeBannerIndex;
  const managedHomeHighlights = useMemo(() => normalizeStoredHomeHighlights(settings.homeHighlights), [settings.homeHighlights]);
  const latestDropProductIds = useMemo(() => sanitizeStoredProductIds(
    settings.latestDropProductIds,
    MAX_LATEST_DROPS
  ), [settings.latestDropProductIds]);
  const pinnedLatestDropProducts = useMemo(() => latestDropProductIds
    .map((productId) => products.find((item) => item.id === productId) || null)
    .filter(Boolean), [latestDropProductIds, products]);
  const latestDropProducts = useMemo(() => 
    pinnedLatestDropProducts.length > 0
      ? pinnedLatestDropProducts
      : [...products]
          .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
          .slice(0, 4),
    [pinnedLatestDropProducts, products]
  );
  const availableLatestDropProducts = useMemo(() => products.filter(
    (product) => !latestDropProductIds.includes(product.id)
  ), [products, latestDropProductIds]);

  useEffect(() => {
    loadRazorpayCheckout().catch((error) => {
      console.error(error);
    });
  }, []);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    if (!storeHydrated) {
      return undefined;
    }

    const migrateUserRecord = async (record) => {
      const nextUser = normalizeUserRecord(record);

      if (!nextUser.email) {
        return;
      }

      await setDoc(
        doc(db, FIRESTORE_PATHS.usersCollection, buildUserDocId(nextUser.email)),
        nextUser
      );
    };

    const migrateOrderRecords = async (records) => {
      const uniqueOrders = sortOrdersNewestFirst(records).filter(
        (entry, index, array) => array.findIndex((candidate) => candidate.id === entry.id) === index
      );

      await Promise.all(
        uniqueOrders.map((entry) =>
          setDoc(
            doc(db, FIRESTORE_PATHS.ordersCollection, entry.id),
            normalizeOrderRecord(entry)
          )
        )
      );
    };

    if (!user || !userEmail) {
      setUsers([]);
      setOrders([]);
      return undefined;
    }

    const fallbackUserRecord = normalizeUserRecord(
      legacyUsersRef.current.find((entry) => normalizeEmail(entry.email) === userEmail) || {
        id: createId("usr"),
        uid: user.uid,
        name: user.displayName || userEmail.split("@")[0],
        email: userEmail,
        phone: "",
        gender: "",
        birthdate: "",
        photo: getFirebaseProfilePhotoUrl(user) || "",
        role: ADMIN_EMAILS.includes(userEmail) ? "admin" : "customer",
        status: "active",
        joinedAt: Date.now(),
        lastLoginAt: Date.now(),
        auraPoints: 0
      }
    );
    const scopedLegacyOrders = sortOrdersNewestFirst(
      legacyOrdersRef.current.filter((entry) => doesOrderBelongToUser(entry, fallbackUserRecord))
    );

    let cancelled = false;

    const usersTarget = isAdmin
      ? collection(db, FIRESTORE_PATHS.usersCollection)
      : doc(db, FIRESTORE_PATHS.usersCollection, buildUserDocId(userEmail));
    const ordersTarget = isAdmin
      ? collection(db, FIRESTORE_PATHS.ordersCollection)
      : query(
          collection(db, FIRESTORE_PATHS.ordersCollection),
          where("userEmail", "==", userEmail)
        );

    const unsubscribeUsers = onSnapshot(
      usersTarget,
      (snapshot) => {
        if (cancelled) {
          return;
        }

        if (isAdmin) {
          const remoteUsers = snapshot.docs.map((entry) =>
            normalizeUserRecord(entry.data())
          );

          if (snapshot.empty && legacyUsersRef.current.length > 0) {
            setUsers(mergeAdminUsers(legacyUsersRef.current));
            migrateUserRecord(fallbackUserRecord).catch((error) =>
              console.warn("User migration skipped:", error?.message || error)
            );
            Promise.all(legacyUsersRef.current.map((entry) => migrateUserRecord(entry))).catch(
              (error) => console.warn("Legacy user migration skipped:", error?.message || error)
            );
            return;
          }

          setUsers(mergeAdminUsers(remoteUsers));
          return;
        }

        if (snapshot.exists()) {
          const remoteUser = normalizeUserRecord(snapshot.data());
          setUsers([remoteUser]);
          return;
        }

        setUsers([fallbackUserRecord]);
        migrateUserRecord(fallbackUserRecord).catch((error) =>
          console.warn("User bootstrap skipped:", error?.message || error)
        );
      },
      (error) => {
        console.warn("User sync skipped:", error?.message || error);
        setUsers(isAdmin ? mergeAdminUsers(legacyUsersRef.current) : [fallbackUserRecord]);
      }
    );

    const unsubscribeOrders = onSnapshot(
      ordersTarget,
      (snapshot) => {
        if (cancelled) {
          return;
        }

        const remoteOrders = sortOrdersNewestFirst(snapshot.docs.map((entry) => entry.data()));

        if (!isAdmin) {
          const ownedOrders = remoteOrders.filter((entry) =>
            doesOrderBelongToUser(entry, fallbackUserRecord)
          );

          if (snapshot.empty && scopedLegacyOrders.length > 0) {
            setOrders(scopedLegacyOrders);
            migrateOrderRecords(scopedLegacyOrders).catch((error) =>
              console.warn("Legacy order migration skipped:", error?.message || error)
            );
            return;
          }

          setOrders(ownedOrders);
          return;
        }

        if (snapshot.empty && legacyOrdersRef.current.length > 0) {
          setOrders(sortOrdersNewestFirst(legacyOrdersRef.current));
          migrateOrderRecords(legacyOrdersRef.current).catch((error) =>
            console.warn("Admin order migration skipped:", error?.message || error)
          );
          return;
        }

        setOrders(remoteOrders);
      },
      (error) => {
        console.warn("Order sync skipped:", error?.message || error);
        setOrders(isAdmin ? sortOrdersNewestFirst(legacyOrdersRef.current) : scopedLegacyOrders);
      }
    );

    return () => {
      cancelled = true;
      unsubscribeUsers();
      unsubscribeOrders();
    };
  }, [storeHydrated, isAdmin, user, userEmail]);

  useEffect(() => {
    const normalizedEmail = String(user?.email || "").trim().toLowerCase();

    if (normalizedEmail) {
      lastAuthenticatedEmailRef.current = normalizedEmail;
    }
  }, [user]);

  useEffect(() => {
    if (!activeAdminEmail) {
      return;
    }

    setAdminLoginForm((prev) =>
      prev.email === activeAdminEmail
        ? prev
        : {
            ...prev,
            email: activeAdminEmail
          }
    );
  }, [activeAdminEmail]);

  useEffect(() => {
    setPolicyForm({
      termsAndConditions: storeTermsAndConditions,
      privacyPolicy: storePrivacyPolicy,
      contactEmail: storeContactEmail,
      aboutUs: storeAboutUs
    });
  }, [storeTermsAndConditions, storePrivacyPolicy, storeContactEmail, storeAboutUs]);

  useEffect(() => {
    let active = true;

    const hydrateStore = async () => {
      let cloudSnapshot = null;

      try {
        const cloudDoc = await getDoc(
          doc(
            db,
            FIRESTORE_PATHS.publicStoreCollection,
            FIRESTORE_PATHS.publicStoreDocument
          )
        );

        if (cloudDoc.exists()) {
          const data = cloudDoc.data();

          if (data && typeof data === "object") {
            cloudSnapshot = data;
          }
        }
      } catch (error) {
        console.warn("Firestore load skipped; falling back to local copies.", error);
      }

      let idbSnapshot = null;

      try {
        idbSnapshot = await readPersistentStore();

        if (idbSnapshot !== null && typeof idbSnapshot !== "object") {
          idbSnapshot = null;
        }
      } catch (error) {
        console.warn("IndexedDB load skipped.", error);
      }

      const legacySnapshot = buildLegacyBrowserSnapshot();

      try {
        if (!active) {
          return;
        }

        const snapshot = pickFreshAppSnapshot(
          cloudSnapshot,
          idbSnapshot,
          legacySnapshot
        );

        if (!snapshot || typeof snapshot !== "object") {
          return;
        }

        const fallbackSettings = normalizeSettingsState(
          readStorage(STORAGE_KEYS.settings, defaultSettings)
        );
        const fallbackProducts = readStorage(STORAGE_KEYS.products, defaultProducts);

        const nextSettings = normalizeSettingsState(
          snapshot.settings !== undefined ? snapshot.settings : fallbackSettings
        );

        const productSeed =
          snapshot.products !== undefined ? snapshot.products : fallbackProducts;
        const userSeed = Array.isArray(snapshot.users) ? snapshot.users : [];
        const orderSeed = Array.isArray(snapshot.orders) ? snapshot.orders : [];

        legacyUsersRef.current = mergeAdminUsers(userSeed);
        legacyOrdersRef.current = sortOrdersNewestFirst(orderSeed);

        startTransition(() => {
          setSettings(nextSettings);
          setProducts(normalizeProductsState(productSeed, nextSettings));
          setUsers([]);
          setOrders([]);
        });

        if (snapshotFreshness(snapshot) > 0) {
          clearLegacyStoreSnapshot();
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (active) {
          setStoreHydrated(true);
        }
      }
    };

    hydrateStore();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.cart, cart);
  }, [cart]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.wishlist, wishlist);
  }, [wishlist]);

  useEffect(() => {
    if (!storeHydrated) {
      return undefined;
    }

    const snapshot = buildPublicStoreSnapshot({
      products,
      settings,
      updatedAt: Date.now()
    });

    const persistStore = async () => {
      try {
        // Local persistence first so a refresh sees the newest state even if Cloud is slow or offline.
        if (!canUsePersistentStore()) {
          writeLegacyStoreSnapshot(snapshot);
        } else {
          await writePersistentStore(snapshot);
          clearLegacyStoreSnapshot();
        }
      } catch (error) {
        console.error("Local storefront save failed; using legacy storage fallback.", error);
        writeLegacyStoreSnapshot(snapshot);
      }

      if (isAdmin) {
        try {
          await setDoc(
            doc(
              db,
              FIRESTORE_PATHS.publicStoreCollection,
              FIRESTORE_PATHS.publicStoreDocument
            ),
            snapshot
          );
        } catch (error) {
          console.warn("Cloud storefront save queued or failed:", error?.message || error);
        }
      }
    };

    if (persistentSaveTimerRef.current) {
      window.clearTimeout(persistentSaveTimerRef.current);
    }

    persistentSaveTimerRef.current = window.setTimeout(() => {
      persistStore();
      persistentSaveTimerRef.current = null;
    }, 380);

    return () => {
      if (persistentSaveTimerRef.current) {
        window.clearTimeout(persistentSaveTimerRef.current);
        persistentSaveTimerRef.current = null;
      }
    };
  }, [storeHydrated, isAdmin, products, settings]);

  useEffect(() => {
    writeSessionValue(STORAGE_KEYS.adminSession, adminSessionToken);
  }, [adminSessionToken]);

  useEffect(() => {
    return () => {
      if (bannerResetTimerRef.current) {
        window.clearTimeout(bannerResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (homepageBanners.length <= 1) {
      setActiveBannerIndex(0);
      setBannerTransitionEnabled(false);
      return;
    }

    setActiveBannerIndex((prev) =>
      prev > homepageBanners.length ? 0 : prev
    );
    setBannerTransitionEnabled(true);
  }, [homepageBanners.length]);

  useEffect(() => {
    if (activePage !== "home" || homepageBanners.length <= 1) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setBannerTransitionEnabled(true);
      setActiveBannerIndex((prev) => {
        const n = homepageBanners.length;
        if (n <= 1) {
          return 0;
        }
        if (prev >= n) {
          return 0;
        }
        return prev + 1;
      });
    }, HOME_BANNER_AUTOPLAY_MS);

    return () => window.clearInterval(timer);
  }, [activePage, homepageBanners.length]);

  useEffect(() => {
    if (
      selectedCategory !== "all" &&
      !managedTshirtCategories.includes(selectedCategory)
    ) {
      setSelectedCategory("all");
    }
  }, [managedTshirtCategories, selectedCategory]);

  useEffect(() => {
    if (!storeHydrated) {
      return;
    }

    const validProductIds = new Set(products.map((product) => product.id));

    setWishlist((prev) => {
      const nextWishlist = prev.filter((productId) => validProductIds.has(productId));
      return nextWishlist.length === prev.length ? prev : nextWishlist;
    });

    setCart((prev) => {
      const nextCart = prev.filter((item) => validProductIds.has(item.productId));
      return nextCart.length === prev.length ? prev : nextCart;
    });
  }, [storeHydrated, products]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setToast("");
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!enabledPaymentOptions.some((option) => option.value === paymentMethod)) {
      setPaymentMethod(enabledPaymentOptions[0]?.value || "");
    }
  }, [enabledPaymentOptions, paymentMethod]);

  useEffect(() => {
    if (!hasActiveSearch) {
      setSearchSuggestionsOpen(false);
    }
  }, [hasActiveSearch]);

  useEffect(() => {
    const syncSearchInput = () => {
      if (searchInputRef.current && searchInputRef.current.value !== searchTerm) {
        searchInputRef.current.value = searchTerm;
      }
    };

    syncSearchInput();
    const frameId = window.requestAnimationFrame(syncSearchInput);
    const timerId = window.setTimeout(syncSearchInput, 250);
    window.addEventListener("pageshow", syncSearchInput);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
      window.removeEventListener("pageshow", syncSearchInput);
    };
  }, [searchTerm]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      return;
    }

    const normalizedSearch = searchTerm.trim().toLowerCase();
    const isRestrictedEmail =
      normalizedSearch === lastAuthenticatedEmailRef.current ||
      ADMIN_EMAILS.includes(normalizedSearch);

    if (!isRestrictedEmail) {
      return;
    }

    const shouldClear = !user || !hasAdminAccess || adminAuthStep !== "authenticated";

    if (!shouldClear) {
      return;
    }

    resetSearchUi();
  }, [searchTerm, user, hasAdminAccess, adminAuthStep]);

  useEffect(() => {
    if (isAdminOwner) {
      return;
    }

    setAdminBackendAccess(null);
    setHasAdminAccess(false);
    setAdminSecurityError("");
    setAdminSessionToken("");
    setAdminAuthStep("loginPassword");
  }, [isAdminOwner]);

  useEffect(() => {
    if (!isAdminOwner || !userEmail) {
      return;
    }

    const storedUnlock = readSessionValue(STORAGE_KEYS.adminSession, "");

    if (storedUnlock && storedUnlock === userEmail) {
      startTransition(() => {
        setAdminSessionToken(userEmail);
        setHasAdminAccess(true);
        setAdminAuthStep("authenticated");
      });
    } else if (storedUnlock && storedUnlock !== userEmail) {
      writeSessionValue(STORAGE_KEYS.adminSession, "");
      setAdminSessionToken("");
    }
  }, [isAdminOwner, userEmail]);

  useEffect(() => {
    if (!selectedProduct) {
      return;
    }

    setProductConfig(createDefaultConfig(selectedProduct));
  }, [selectedProduct]);

  useEffect(() => {
    setZoomedMedia(null);
  }, [selectedProductId, activePage]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (drawerRef.current && !drawerRef.current.contains(event.target)) {
        setMenuOpen(false);
      }

      if (tshirtRef.current && !tshirtRef.current.contains(event.target)) {
        setShowTshirtMenu(false);
      }

      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setSearchSuggestionsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;

    const handleScroll = () => {
      const nextY = window.scrollY;
      setNavHidden(nextY > lastY && nextY > 120 && !menuOpen);
      lastY = nextY;
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, [menuOpen]);

  useEffect(() => {
    const revealItems = document.querySelectorAll(".js-reveal");

    if (revealItems.length === 0) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
          }
        });
      },
      {
        threshold: 0.16,
        rootMargin: "0px 0px -48px 0px"
      }
    );

    revealItems.forEach((item) => observer.observe(item));

    return () => observer.disconnect();
  }, [
    activePage,
    selectedCategory,
    sortBy,
    products.length,
    settings.offers.length,
    homepageBanners.length
  ]);

  useEffect(() => {
    if (!zoomedMedia) {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setZoomedMedia(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [zoomedMedia]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setAdminBackendAccess(null);
        setUser(null);
        return;
      }

      const email = normalizeEmail(firebaseUser.email);
      if (!ADMIN_EMAILS.includes(email)) {
        setAdminBackendAccess(null);
      }
      const existing = usersRef.current.find(
        (entry) => normalizeEmail(entry.email) === email
      );

      if (existing?.status === "blocked") {
        setToast("This account is currently suspended.");
        await signOut(auth);
        setUser(null);
          return;
        }

      const nextUser = normalizeUserRecord({
        ...existing,
        id: existing?.id || createId("usr"),
        uid: firebaseUser.uid,
        name: existing?.name || firebaseUser.displayName || email.split("@")[0],
        email,
        phone: existing?.phone || "",
        gender: existing?.gender || "",
        birthdate: existing?.birthdate || "",
        photo: getFirebaseProfilePhotoUrl(firebaseUser) || existing?.photo || "",
        role: ADMIN_EMAILS.includes(email) ? "admin" : "customer",
        status: "active",
        joinedAt: existing?.joinedAt || Date.now(),
        lastLoginAt: Date.now(),
        auraPoints:
          existing?.auraPoints !== undefined
            ? Number(existing.auraPoints)
            : 0
      });

      setUsers((prev) => [
        nextUser,
        ...prev.filter((entry) => normalizeEmail(entry.email) !== email)
      ]);
      setUser(nextUser);

      try {
        await setDoc(
          doc(db, FIRESTORE_PATHS.usersCollection, buildUserDocId(email)),
          nextUser,
          { merge: true }
        );
      } catch (error) {
        console.warn("User profile sync skipped:", error?.message || error);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    activePageRef.current = activePage;
    pageHistoryRef.current = history;
  }, [activePage, history]);

  useEffect(() => {
    window.history.replaceState({ vatsauraPage: activePageRef.current }, "");

    const handleBrowserBack = () => {
      const currentHistory = pageHistoryRef.current;

      if (currentHistory.length === 0) {
        return;
      }

      if (activePageRef.current === "profile") {
        setIsEditingProfile(false);
      }

      const previousPage = currentHistory[currentHistory.length - 1] || "home";
      setHistory((prev) => prev.slice(0, -1));
      setActivePage(previousPage);
      setMenuOpen(false);
      setShowTshirtMenu(false);
      setSearchSuggestionsOpen(false);
    };

    window.addEventListener("popstate", handleBrowserBack);
    return () => window.removeEventListener("popstate", handleBrowserBack);
  }, []);

  const navigateTo = (page) => {
    if (page === activePage) {
      setMenuOpen(false);
      setSearchSuggestionsOpen(false);
      return;
    }

    if (activePage === "profile") {
      setIsEditingProfile(false);
    }

    setHistory((prev) => [...prev, activePage]);
    window.history.pushState({ vatsauraPage: page }, "");
    setActivePage(page);
    setMenuOpen(false);
    setShowTshirtMenu(false);
    setSearchSuggestionsOpen(false);
  };

  const goBack = () => {
    if (activePage === "profile") {
      setIsEditingProfile(false);
    }
    const previousPage = history[history.length - 1] || "home";
    setHistory((prev) => prev.slice(0, -1));
    setActivePage(previousPage);
    setMenuOpen(false);
    setShowTshirtMenu(false);
    setSearchSuggestionsOpen(false);
  };

  const goHome = () => {
    if (activePage === "profile") {
      setIsEditingProfile(false);
    }
    setActivePage("home");
    setHistory([]);
    setMenuOpen(false);
    setShowTshirtMenu(false);
    setSearchSuggestionsOpen(false);
  };

  const handleSearchChange = (event) => {
    const nextValue = event.target.value;
    const normalizedValue = nextValue.trim().toLowerCase();
    const shouldIgnoreInjectedEmail =
      (!user || !hasAdminAccess) &&
      Boolean(normalizedValue) &&
      (normalizedValue === lastAuthenticatedEmailRef.current ||
        ADMIN_EMAILS.includes(normalizedValue));

    if (shouldIgnoreInjectedEmail) {
      event.target.value = "";
      setSearchTerm("");
      setSearchSuggestionsOpen(false);
      return;
    }

    const hasValue = Boolean(nextValue.trim());

    setSearchTerm(nextValue);
    setMenuOpen(false);
    setShowTshirtMenu(false);
    setSearchSuggestionsOpen(hasValue);

    if (!hasValue) {
      return;
    }
  };

  const clearSearch = () => {
    setSearchTerm("");
    setSearchSuggestionsOpen(false);
  };

  const resetSearchUi = () => {
    setSearchTerm("");
    setSearchSuggestionsOpen(false);

    if (searchInputRef.current) {
      searchInputRef.current.value = "";
      searchInputRef.current.blur();
    }
  };

  const activateSearchResults = () => {
    if (!hasActiveSearch) {
      return;
    }

    setSelectedDepartment("all");
    setSelectedCategory("all");
    setMenuOpen(false);
    setShowTshirtMenu(false);
    setSearchSuggestionsOpen(false);

    if (activePage !== "home") {
      setHistory((prev) => [...prev, activePage]);
      setActivePage("home");
    }
  };

  const handleSearchFocus = () => {
    if (hasActiveSearch) {
      setSearchSuggestionsOpen(true);
    }
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      activateSearchResults();
    }

    if (event.key === "Escape") {
      setSearchSuggestionsOpen(false);
    }
  };

  const openProductFromSearch = (product) => {
    setSearchSuggestionsOpen(false);
    openProduct(product);
  };

  const openDepartment = (department, category = "all") => {
    setSelectedDepartment(department);
    setSelectedCategory(category);
    setActivePage("home");
    setShowTshirtMenu(false);
    setMenuOpen(false);
    setSearchSuggestionsOpen(false);
  };

  const submitAdminPassword = () => {
    setAdminSecurityError("");

    if (adminLoginForm.password !== ADMIN_PANEL_PASSWORD) {
      setAdminSecurityError("Incorrect password");
      return;
    }

    setAdminSessionToken(userEmail);
    writeSessionValue(STORAGE_KEYS.adminSession, userEmail);
    setHasAdminAccess(true);
    setAdminAuthStep("authenticated");
    setAdminLoginForm((prev) => ({
      ...prev,
      password: "",
      pin: "",
      otpCode: ""
    }));
    setToast("Admin panel unlocked.");
    navigateTo("admin");
  };

  const endAdminSession = () => {
    resetSearchUi();
    setHasAdminAccess(false);
    setAdminSessionToken("");
    writeSessionValue(STORAGE_KEYS.adminSession, "");
    setAdminAuthStep("loginPassword");
    setAdminSecurityError("");
    setToast("Admin session locked.");
  };

  const saveAdminPasswordSettings = () => {
    setAdminSecurityError("");
    setToast("Admin password is set in the app code. Change ADMIN_PANEL_PASSWORD in App.js to update it.");
  };

  const saveAdminPinSettings = () => {
    setAdminSecurityError("");
    setToast("PIN sign-in is disabled.");
  };

  const saveAdminTwoFactorSettings = () => {
    setAdminSecurityError("");
    setToast("Email and SMS OTP are disabled.");
  };

  useEffect(() => {
    if (!user || isEditingProfile) {
      return;
    }

    const email = String(user.email || "").toLowerCase();
    const existing = users.find((u) => u.email?.toLowerCase() === email);

    if (existing && (
      existing.name !== user.name ||
      existing.phone !== user.phone ||
      existing.gender !== user.gender ||
      existing.birthdate !== user.birthdate
    )) {
      setUser((prev) => ({
        ...prev,
        name: existing.name,
        phone: existing.phone,
        gender: existing.gender,
        birthdate: existing.birthdate
      }));
    }
  }, [users, user, isEditingProfile]);

  const startEditingProfile = () => {
    if (!currentUserRecord) {
      return;
    }
    setProfileForm({
      name: currentUserRecord.name || "",
      phone: currentUserRecord.phone || "",
      gender: currentUserRecord.gender || "",
      birthdate: currentUserRecord.birthdate || ""
    });
    setIsEditingProfile(true);
  };

  const saveProfile = async () => {
    if (!user || !currentUserRecord) {
      return;
    }

    if (!profileForm.name.trim()) {
      setToast("Name is required.");
      return;
    }

    if (profileForm.phone && !/^\d{10}$/.test(profileForm.phone)) {
      setToast("Please enter a valid 10-digit phone number.");
      return;
    }

    const email = normalizeEmail(user.email);
    const nextUserRecord = normalizeUserRecord({
      ...currentUserRecord,
      uid: user.uid,
      name: profileForm.name.trim(),
      phone: profileForm.phone.trim(),
      gender: profileForm.gender,
      birthdate: profileForm.birthdate
    });

    try {
      await setDoc(
        doc(db, FIRESTORE_PATHS.usersCollection, buildUserDocId(email)),
        nextUserRecord,
        { merge: true }
      );
      setUsers((prev) =>
        prev.map((entry) =>
          normalizeEmail(entry.email) === email ? nextUserRecord : entry
        )
      );
      setUser((prev) =>
        prev
          ? {
              ...prev,
              name: nextUserRecord.name,
              phone: nextUserRecord.phone,
              gender: nextUserRecord.gender,
              birthdate: nextUserRecord.birthdate
            }
          : prev
      );
      setIsEditingProfile(false);
      setToast("Profile updated successfully.");
    } catch (error) {
      console.error(error);
      setToast("Unable to save your profile right now.");
    }
  };

  const handleRazorpayPayment = async (amountToPay, onPaymentSuccess) => {
    setRazorpayLoading(true);
    try {
      await loadRazorpayCheckout();

      const response = await fetch(buildApiUrl("/api/payment/create-order"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amountToPay) })
      });

      const orderData = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(orderData.error || "Failed to initiate payment.");
      }

      const options = {
        key: process.env.REACT_APP_RAZORPAY_KEY_ID || orderData.key_id || "rzp_live_SmMk7YKFu4mTU6",
        amount: orderData.amount,
        currency: orderData.currency,
        name: siteName,
        description: "Order Payment",
        order_id: orderData.id,
        handler: function (response) {
          Promise.resolve(
            onPaymentSuccess({
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature
            })
          ).catch((error) => {
            console.error("Order sync after Razorpay payment failed:", error);
            setToast("Payment succeeded, but order sync needs a retry.");
            setRazorpayLoading(false);
          });
        },
        prefill: {
          name: checkoutForm.name,
          email: user?.email,
          contact: checkoutForm.phone
        },
        theme: {
          color: tone.black
        },
        modal: {
          ondismiss: function () {
            setRazorpayLoading(false);
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", function (response) {
        setToast(`Payment failed: ${response.error.description}`);
        setRazorpayLoading(false);
      });
      rzp.open();
    } catch (error) {
      console.error("Razorpay Error:", error);
      setToast(error.message || "Unable to start Razorpay payment.");
      setRazorpayLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const credentials = await signInWithPopup(auth, provider);
      const signedInEmail = normalizeEmail(credentials?.user?.email);

      if (ADMIN_EMAILS.includes(signedInEmail)) {
        try {
          const backendAdmin = await checkBackendAdminAccess(credentials.user);

          if (backendAdmin.denied) {
            console.warn("Backend admin check denied access for allowlisted admin login.");
            setAdminBackendAccess(null);
          } else if (backendAdmin.admin) {
            setAdminBackendAccess(true);
          } else {
            setAdminBackendAccess(null);
          }
        } catch (error) {
          console.error(error);
          setAdminBackendAccess(null);
        }
      } else {
        setAdminBackendAccess(null);
      }

      setMenuOpen(false);
      setToast("Logged in successfully.");
    } catch (error) {
      console.error(error);
      setToast("Login failed. Please try again.");
    }
  };

  const logout = async () => {
    try {
      if (adminSessionToken) {
        await endAdminSession();
      }

      setAdminBackendAccess(null);
      await signOut(auth);
      setUser(null);
      setIsEditingProfile(false);
      setSelectedProductId("");
      setProductConfig(null);
      setMenuOpen(false);
      setShowTshirtMenu(false);
      setSelectedDepartment("all");
      setSelectedCategory("all");
      setHistory([]);
      setActivePage("home");
      resetSearchUi();
      setToast("Logged out successfully.");
    } catch (error) {
      console.error(error);
      setToast("Logout failed. Please try again.");
    }
  };

  const openProduct = (product) => {
    setSelectedProductId(product.id);
    setProductConfig(createDefaultConfig(product));
    navigateTo("product");
  };

  const handleProductMediaTouchStart = (event) => {
    const touch = event.touches?.[0];

    if (!touch) {
      return;
    }

    productMediaTouchRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      moved: false
    };
  };

  const handleProductMediaTouchMove = (event) => {
    const touch = event.touches?.[0];
    const state = productMediaTouchRef.current;

    if (!touch || !state) {
      return;
    }

    const deltaX = touch.clientX - state.x;
    const deltaY = touch.clientY - state.y;

    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 4) {
      state.moved = true;
    } else if (Math.abs(deltaX) > 6) {
      state.moved = true;
    }
  };

  const openZoomedProductMedia = (event, panel) => {
    if (productMediaTouchRef.current?.moved) {
      event.preventDefault();
      productMediaTouchRef.current = null;
      return;
    }

    setZoomedMedia({
      type: "image",
      src: panel.src,
      alt: `${selectedProduct.name} ${panel.title}`
    });
  };

  const updateProductConfig = (field, value) => {
    setProductConfig((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const toggleWishlist = (productId) => {
    setWishlist((prev) => {
  if (prev.includes(productId)) {
    return prev.filter((entry) => entry !== productId);
  } else {
    return [productId, ...prev];
  }
});
};
  const addConfiguredProductToCart = (product = selectedProduct, config = productConfig) => {
    if (!product || !config) {
      return;
    }

    if (product.availability !== PRODUCT_AVAILABILITY.IN_STOCK) {
      setToast(product.availability === PRODUCT_AVAILABILITY.COMING_SOON ? "Coming soon." : "Product is out of stock.");
      return;
    }

    const quantity = Math.max(1, Number(config.quantity || 1));
    const unitPrice = discountPrice(product);
    const cartItem = {
      cartId: createId("cart"),
      productId: product.id,
      name: product.name,
      department: product.department,
      category: product.category,
      unitPrice,
      color: config.color,
      size: config.size,
      quantity
    };

    setCart((prev) => [...prev, cartItem]);
    setToast(`${product.name} added to cart.`);
  };

  const addAndGoToCart = () => {
    addConfiguredProductToCart();
    navigateTo("cart");
  };

  const updateCartQuantity = (cartId, change) => {
    setCart((prev) =>
      prev.map((item) =>
        item.cartId === cartId
          ? { ...item, quantity: Math.max(1, Number(item.quantity) + change) }
          : item
      )
    );
  };

  const removeFromCart = (cartId) => {
    setCart((prev) => prev.filter((item) => item.cartId !== cartId));
  };

  const handleCheckoutChange = (event) => {
    const { name, value } = event.target;
    setCheckoutForm((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const proceedToPayment = () => {
    const requiredFields = ["name", "phone", "address", "city", "pincode"];
    const hasMissing = requiredFields.some(
      (field) => !String(checkoutForm[field] || "").trim()
    );

    if (cart.length === 0) {
      setToast("Add products to the cart before checkout.");
      return;
    }

    if (hasMissing) {
      setToast("Fill name, phone, address, city and pincode.");
      return;
    }

    if (!/^\d{10}$/.test(String(checkoutForm.phone || "").trim())) {
      setToast("Please enter a valid 10-digit phone number.");
      return;
    }

    navigateTo("payment");
  };

  const placeOrder = () => {
    if (cart.length === 0) {
      setToast("Your cart is empty.");
      return;
    }

    if (!user || !userEmail) {
      setToast("Please log in before placing an order.");
      return;
    }

    if (!paymentMethod) {
      setToast("Payment methods are currently unavailable. Please contact support.");
      return;
    }

    const codCharge = paymentMethod === "cod" ? COD_CHARGE : 0;
    const orderTotal = cartTotal + codCharge;
    const canUseAuraPoints = paymentMethod !== "cod";
    const auraUsed = canUseAuraPoints && (checkoutForm.useAuraPoints || (paymentMethod === "upi" && user)) && user ? Math.min(auraPoints, orderTotal) : 0;
    const remainingPayable = orderTotal - auraUsed;
    const isFullAuraPayment = auraUsed >= orderTotal && auraUsed > 0;

    if (paymentMethod === "upi" && !isFullAuraPayment) {
      if (!settings.upiQrData) {
        setToast("UPI payment is currently unavailable. Please try another method or contact support.");
        return;
      }

      if (!checkoutForm.transactionId?.trim() || !checkoutForm.customerName?.trim()) {
        setToast("Transaction ID and Customer Name are required for UPI payments.");
        return;
      }

      const utr = checkoutForm.transactionId.trim();
      if (!/^[a-zA-Z0-9]{12,}$/.test(utr)) {
        setToast("Please enter a valid Transaction ID / UTR (at least 12 alphanumeric characters).");
        return;
      }

      const isDuplicateUtr = orders.some(
        (o) => o.paymentMethod === "upi" && o.customer?.transactionId?.trim() === utr
      );
      if (isDuplicateUtr) {
        setToast("This Transaction ID has already been submitted.");
        return;
      }
    }

    if (paymentMethod === "aura" && auraPoints < orderTotal) {
      setToast("Not enough Aura points for this order.");
      return;
    }

    const orderId = createOrderId();
    let orderStatus = "Pending Payment";
    
    if (isFullAuraPayment) {
      orderStatus = "Paid";
    } else if (paymentMethod === "upi") {
      orderStatus = "Payment Submitted";
    }

    // Razorpay Integration
    if (paymentMethod === "razorpay" && !isFullAuraPayment) {
      handleRazorpayPayment(remainingPayable, (razorpayResponse) => {
        return finalizeOrder(orderId, "Paid", razorpayResponse);
      });
      return;
    }

    finalizeOrder(orderId, orderStatus);
  };

  const finalizeOrder = async (orderId, orderStatus, razorpayData = null) => {
    const now = Date.now();
    const codCharge = paymentMethod === "cod" ? COD_CHARGE : 0;
    const orderTotal = cartTotal + codCharge;
    const canUseAuraPoints = paymentMethod !== "cod";
    const auraUsed = canUseAuraPoints && (checkoutForm.useAuraPoints || (paymentMethod === "upi" && user)) && user ? Math.min(auraPoints, orderTotal) : 0;
    const remainingPayable = orderTotal - auraUsed;
    const isFullAuraPayment = auraUsed >= orderTotal && auraUsed > 0;

    const order = normalizeOrderRecord({
      id: orderId,
      createdAt: now,
      dateLabel: new Date(now).toLocaleString("en-IN"),
      paymentMethod,
      status: orderStatus,
      paymentSubmittedAt: (paymentMethod === "upi" || paymentMethod === "razorpay") && !isFullAuraPayment ? now : null,
      paymentSubmittedLabel: (paymentMethod === "upi" || paymentMethod === "razorpay") && !isFullAuraPayment ? new Date(now).toLocaleString("en-IN") : null,
      items: cart,
      total: orderTotal,
      codCharge,
      auraPointsUsed: auraUsed,
      remainingPayable: remainingPayable,
      customer: {
        ...checkoutForm,
        email: userEmail,
        phone: checkoutForm.phone
      },
      razorpayData,
      userUid: String(user?.uid || ""),
      userEmail,
      userPhone: normalizePhone(checkoutForm.phone),
      refundRequested: false,
      returnRequested: false
    });

    const cashback = Math.floor(cartTotal * 0.05);
    const pointsAfterDeduction = Math.max(0, auraPoints - auraUsed);
    const nextAura = pointsAfterDeduction + cashback;
    const email = normalizeEmail(user?.email);
    const matchingUser = usersRef.current.find((entry) => normalizeEmail(entry.email) === email);
    const history = [...(matchingUser?.auraHistory || [])];

    if (auraUsed > 0) {
      history.unshift({
        id: createId("tra"),
        date: new Date(now).toLocaleDateString("en-IN"),
        time: new Date(now).toLocaleTimeString("en-IN"),
        amount: -auraUsed,
        type: "Deduction",
        adminName: "System",
        reason: "Used for order payment",
        orderId
      });
    }

    if (cashback > 0) {
      history.unshift({
        id: createId("tra"),
        date: new Date(now).toLocaleDateString("en-IN"),
        time: new Date(now).toLocaleTimeString("en-IN"),
        amount: cashback,
        type: "Deposit",
        adminName: "System",
        reason: `Cashback for order (${orderId})`
      });
    }

    const nextUserRecord = normalizeUserRecord({
      ...(matchingUser || currentUserRecord || user),
      uid: user?.uid || matchingUser?.uid || "",
      name: matchingUser?.name || user?.name || user?.displayName || email.split("@")[0],
      email,
      phone: matchingUser?.phone || checkoutForm.phone,
      gender: matchingUser?.gender || "",
      birthdate: matchingUser?.birthdate || "",
      photo: matchingUser?.photo || user?.photo || getFirebaseProfilePhotoUrl(user) || "",
      auraPoints: nextAura,
      totalSpent: Number(matchingUser?.totalSpent || 0) + orderTotal,
      totalOrders: Number(matchingUser?.totalOrders || 0) + 1,
      auraHistory: history,
      lastLoginAt: matchingUser?.lastLoginAt || Date.now()
    });

    try {
      await setDoc(doc(db, FIRESTORE_PATHS.ordersCollection, order.id), order);
      await setDoc(
        doc(db, FIRESTORE_PATHS.usersCollection, buildUserDocId(email)),
        nextUserRecord,
        { merge: true }
      );

      setOrders((prev) => sortOrdersNewestFirst([order, ...prev]));
      setUsers((prev) => {
        const nextUsers = prev.filter((entry) => normalizeEmail(entry.email) !== email);
        return [nextUserRecord, ...nextUsers];
      });
      setCart([]);
      setCheckoutForm(initialCheckoutForm);
      setHistory(["home"]);
      setActivePage("orders");
      setToast(`Order ${orderId} placed successfully.`);
    } catch (error) {
      console.error(error);
      setToast("Payment succeeded, but order sync is pending. Please refresh My Orders in a moment.");
    } finally {
      setRazorpayLoading(false);
    }
  };

  const setUserFormField = (field, value) => {
    setUserForm((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const addManualUser = async () => {
    const email = normalizeEmail(userForm.email);

    if (!userForm.name.trim() || !email) {
      setToast("Enter user name and email.");
      return;
    }

    if (users.some((entry) => entry.email?.toLowerCase() === email)) {
      setToast("This email already exists.");
      return;
    }

    const nextUser = {
      id: createId("usr"),
      name: userForm.name.trim(),
      email,
      role: ADMIN_EMAILS.includes(email) ? "admin" : "customer",
      status: "active",
      photo: "",
      auraPoints: 0,
      joinedAt: Date.now(),
      lastLoginAt: null,
      auraHistory: []
    };

    try {
      const normalizedUser = normalizeUserRecord(nextUser);
      await setDoc(
        doc(db, FIRESTORE_PATHS.usersCollection, buildUserDocId(email)),
        normalizedUser
      );
      setUsers((prev) => [normalizedUser, ...prev]);
      setUserForm(emptyUserForm);
      setToast("User added.");
    } catch (error) {
      console.error(error);
      setToast("Unable to add the user right now.");
    }
  };

  const removeUser = async (email) => {
    const normalizedEmail = normalizeEmail(email);

    try {
      await deleteDoc(
        doc(db, FIRESTORE_PATHS.usersCollection, buildUserDocId(normalizedEmail))
      );
      setUsers((prev) =>
        prev.filter((entry) => normalizeEmail(entry.email) !== normalizedEmail)
      );

      if (normalizeEmail(user?.email) === normalizedEmail) {
        logout();
      }

      setToast("User removed.");
    } catch (error) {
      console.error(error);
      setToast("Unable to remove the user right now.");
    }
  };

  const toggleBlockUser = async (email) => {
    const normalizedEmail = normalizeEmail(email);
    const existingUser = users.find((entry) => normalizeEmail(entry.email) === normalizedEmail);

    if (!existingUser) {
      return;
    }

    const nextUserRecord = normalizeUserRecord({
      ...existingUser,
      status: existingUser.status === "blocked" ? "active" : "blocked"
    });

    try {
      await setDoc(
        doc(db, FIRESTORE_PATHS.usersCollection, buildUserDocId(normalizedEmail)),
        nextUserRecord,
        { merge: true }
      );
      setUsers((prev) =>
        prev.map((entry) =>
          normalizeEmail(entry.email) === normalizedEmail ? nextUserRecord : entry
        )
      );

      if (
        nextUserRecord.status === "blocked" &&
        normalizeEmail(user?.email) === normalizedEmail
      ) {
        logout();
      }

      setToast("User status updated.");
    } catch (error) {
      console.error(error);
      setToast("Unable to update user status right now.");
    }
  };

  const updateAuraPoints = async (email, actionType) => {
    const amount = Number(auraActionForm.amount);
    const reason = auraActionForm.reason.trim();

    if (isNaN(amount) || (amount <= 0 && actionType !== "Edit")) {
      setToast("Enter a valid positive amount.");
      return;
    }

    if (!reason) {
      setToast("Enter a reason for this transaction.");
      return;
    }

    const adminName = user?.name || "Admin";
    const now = Date.now();
    const normalizedEmail = normalizeEmail(email);
    const existingUser = users.find((entry) => normalizeEmail(entry.email) === normalizedEmail);

    if (!existingUser) {
      setToast("User not found.");
      return;
    }

    let nextPoints = Number(existingUser.auraPoints || 0);
    let delta = 0;

    if (actionType === "Add") {
      delta = amount;
      nextPoints += amount;
    } else if (actionType === "Deduct") {
      delta = -amount;
      nextPoints = Math.max(0, nextPoints - amount);
    } else if (actionType === "Edit") {
      delta = amount - nextPoints;
      nextPoints = Math.max(0, amount);
    }

    const transaction = {
      id: createId("tra"),
      date: new Date(now).toLocaleDateString("en-IN"),
      time: new Date(now).toLocaleTimeString("en-IN"),
      amount: delta,
      type: actionType === "Edit" ? "Adjustment" : (delta >= 0 ? "Deposit" : "Withdrawal"),
      adminName,
      reason
    };
    const nextUserRecord = normalizeUserRecord({
      ...existingUser,
      auraPoints: nextPoints,
      auraHistory: [transaction, ...(existingUser.auraHistory || [])]
    });

    try {
      await setDoc(
        doc(db, FIRESTORE_PATHS.usersCollection, buildUserDocId(normalizedEmail)),
        nextUserRecord,
        { merge: true }
      );
      setUsers((prev) =>
        prev.map((entry) =>
          normalizeEmail(entry.email) === normalizedEmail ? nextUserRecord : entry
        )
      );
      setAuraActionForm({ amount: "", reason: "", targetUserEmail: "" });
      setToast(`Aura points ${actionType.toLowerCase()}ed.`);
    } catch (error) {
      console.error(error);
      setToast("Unable to update Aura points right now.");
    }
  };

  const setProductFormField = (field, value) => {
    setProductForm((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const buildEmptyProductForm = () => ({
    ...emptyProductForm,
    department: managedProductDepartments[0] || DEFAULT_PRODUCT_DEPARTMENTS[0],
    category:
      (managedProductDepartments[0] || DEFAULT_PRODUCT_DEPARTMENTS[0]) === "tshirts"
        ? managedTshirtCategories[0] || DEFAULT_TSHIRT_CATEGORIES[0]
        : "General",
    mediaImages: [],
    videoData: "",
    imageData: ""
  });

  const addProductImages = (newImages) => {
    const safeNewImages = newImages.filter(Boolean);

    setProductForm((prev) => {
      const nextImages = [...getProductImages(prev), ...safeNewImages].slice(0, 6);

      return {
        ...prev,
        mediaImages: nextImages,
        imageData: nextImages[0] || ""
      };
    });

    if (safeNewImages.length > 0) {
      setToast("Product images updated.");
    }
  };

  const replaceProductImageAt = (index, nextImage) => {
    if (!nextImage) {
      return;
    }

    setProductForm((prev) => {
      const nextImages = [...getProductImages(prev)];
      nextImages[index] = nextImage;
      const safeImages = nextImages.filter(Boolean).slice(0, 6);

      return {
        ...prev,
        mediaImages: safeImages,
        imageData: safeImages[0] || ""
      };
    });

    setToast("Product image replaced.");
  };

  const removeProductImageAt = (index) => {
    setProductForm((prev) => {
      const nextImages = getProductImages(prev).filter((_, itemIndex) => itemIndex !== index);

      return {
        ...prev,
        mediaImages: nextImages,
        imageData: nextImages[0] || ""
      };
    });

    setToast("Product image removed.");
  };

  const moveProductImage = (index, direction) => {
    setProductForm((prev) => {
      const nextImages = [...getProductImages(prev)];
      const targetIndex = direction === "left" ? index - 1 : index + 1;

      if (targetIndex < 0 || targetIndex >= nextImages.length) {
        return prev;
      }

      [nextImages[index], nextImages[targetIndex]] = [
        nextImages[targetIndex],
        nextImages[index]
      ];

      return {
        ...prev,
        mediaImages: nextImages,
        imageData: nextImages[0] || ""
      };
    });

    setToast("Product image order updated.");
  };

  const setProductVideo = (nextVideo) => {
    setProductForm((prev) => ({
      ...prev,
      videoData: nextVideo || ""
    }));

    setToast(nextVideo ? "Product video updated." : "Product video removed.");
  };

  const addTshirtCategory = () => {
    const nextCategory = normalizeCategoryName(categoryDraft);

    if (!nextCategory) {
      setToast("Enter a T-shirt category.");
      return;
    }

    if (
      managedTshirtCategories.some(
        (category) => category.toLowerCase() === nextCategory.toLowerCase()
      )
    ) {
      setToast("This T-shirt category already exists.");
      return;
    }

    setSettings((prev) => ({
      ...prev,
      tshirtCategories: [...sanitizeTshirtCategories(prev.tshirtCategories), nextCategory]
    }));

    setProductForm((prev) => ({
      ...prev,
      category: prev.category || nextCategory
    }));
    setCategoryDraft("");
    setToast("T-shirt category added.");
  };

  const removeTshirtCategory = (categoryToRemove) => {
    if (managedTshirtCategories.length <= 1) {
      setToast("Keep at least one T-shirt category.");
      return;
    }

    const nextCategories = managedTshirtCategories.filter(
      (category) => category !== categoryToRemove
    );
    const fallbackCategory = nextCategories[0];

    setSettings((prev) => ({
      ...prev,
      tshirtCategories: nextCategories
    }));

    setProducts((prev) =>
      prev.map((product) =>
        product.category === categoryToRemove
          ? { ...product, category: fallbackCategory }
          : product
      )
    );

    setProductForm((prev) =>
      prev.category === categoryToRemove
        ? {
            ...prev,
            category: fallbackCategory
          }
        : prev
    );

    if (selectedCategory === categoryToRemove) {
      setSelectedCategory("all");
    }

    setToast("T-shirt category removed.");
  };

  const addProductDepartment = () => {
    const nextDepartment = normalizeDepartmentName(departmentDraft);

    if (!nextDepartment) {
      setToast("Enter a product section name.");
      return;
    }

    if (managedProductDepartments.includes(nextDepartment)) {
      setToast("This product section already exists.");
      return;
    }

    setSettings((prev) => ({
      ...prev,
      productDepartments: [...sanitizeProductDepartments(prev.productDepartments), nextDepartment]
    }));

    setDepartmentDraft("");
    setToast("Product section added.");
  };

  const removeProductDepartment = (departmentToRemove) => {
    if (managedProductDepartments.length <= 1) {
      setToast("Keep at least one product section.");
      return;
    }

    const nextDepartments = managedProductDepartments.filter(
      (department) => department !== departmentToRemove
    );
    const fallbackDepartment = nextDepartments[0] || DEFAULT_PRODUCT_DEPARTMENTS[0];

    setSettings((prev) => ({
      ...prev,
      productDepartments: nextDepartments
    }));

    setProducts((prev) =>
      prev.map((product) =>
        product.department === departmentToRemove
          ? {
              ...product,
              department: fallbackDepartment,
              category:
                fallbackDepartment === "tshirts"
                  ? managedTshirtCategories[0] || DEFAULT_TSHIRT_CATEGORIES[0]
                  : product.category || "General"
            }
          : product
      )
    );

    setProductForm((prev) =>
      prev.department === departmentToRemove
        ? {
            ...prev,
            department: fallbackDepartment,
            category:
              fallbackDepartment === "tshirts"
                ? managedTshirtCategories[0] || DEFAULT_TSHIRT_CATEGORIES[0]
                : prev.category || "General"
          }
        : prev
    );

    if (selectedDepartment === departmentToRemove) {
      setSelectedDepartment("all");
      setSelectedCategory("all");
    }

    setToast("Product section removed.");
  };

  const editProduct = (product) => {
    setProductForm({
      id: product.id,
      name: product.name,
      department: normalizeDepartmentName(product.department) || DEFAULT_PRODUCT_DEPARTMENTS[0],
      category: normalizeCategoryName(product.category),
      price: String(product.price),
      discount: String(product.discount),
      stock: String(product.stock),
      availability: normalizeProductAvailability(product.availability, product.stock),
      description: product.description,
      colors: product.colors.join(", "),
      sizes: product.sizes.join(", "),
      badge: product.badge || "",
      imageData: getProductImages(product)[0] || "",
      mediaImages: getProductImages(product),
      videoData: getProductVideo(product)
    });
    setAdminTab("products");
  };

  const saveProduct = () => {
    if (!productForm.name.trim() || !productForm.category.trim()) {
      setToast("Enter product name and category.");
      return;
    }

    const normalizedDepartment =
      normalizeDepartmentName(productForm.department) || DEFAULT_PRODUCT_DEPARTMENTS[0];
    const normalizedCategory = normalizeCategoryName(productForm.category);

    if (
      normalizedDepartment === "tshirts" &&
      !managedTshirtCategories.includes(normalizedCategory)
    ) {
      setToast("Pick a category from the T-shirt category manager.");
      return;
    }

    const nextProduct = normalizeProduct({
      id: productForm.id || createId("prd"),
      name: productForm.name.trim(),
      department: normalizedDepartment,
      category:
        normalizedDepartment === "tshirts"
          ? normalizedCategory
          : productForm.category.trim() || "General",
      price: Number(productForm.price),
      discount: Number(productForm.discount),
      stock: Number(productForm.stock),
      availability: normalizeProductAvailability(productForm.availability, productForm.stock),
      description: productForm.description.trim(),
      colors: productForm.colors,
      sizes: productForm.sizes,
      badge: productForm.badge.trim(),
      mediaImages: getProductImages(productForm),
      videoData: getProductVideo(productForm),
      imageData: getProductImages(productForm)[0] || "",
      createdAt: productForm.id
        ? products.find((entry) => entry.id === productForm.id)?.createdAt || Date.now()
        : Date.now()
    });

    setProducts((prev) => {
      const exists = prev.some((entry) => entry.id === nextProduct.id);
      return exists
        ? prev.map((entry) => (entry.id === nextProduct.id ? nextProduct : entry))
        : [nextProduct, ...prev];
    });

    setProductForm(buildEmptyProductForm());
    setToast("Product saved.");
  };

  const deleteProduct = (productId) => {
    setProducts((prev) => prev.filter((entry) => entry.id !== productId));
    setWishlist((prev) => prev.filter((entry) => entry !== productId));
    setCart((prev) => prev.filter((entry) => entry.productId !== productId));
    setSettings((prev) => ({
      ...prev,
      latestDropProductIds: sanitizeStoredProductIds(
        (prev.latestDropProductIds || []).filter((entry) => entry !== productId),
        MAX_LATEST_DROPS
      ),
      banners: normalizeStoredBanners(
        (prev.banners || []).map((banner) =>
          banner.linkedProductId === productId
            ? {
                ...banner,
                linkedProductId: ""
              }
            : banner
        )
      )
    }));

    if (selectedProductId === productId) {
      setSelectedProductId("");
      setActivePage("home");
    }

    setToast("Product deleted.");
  };

  const updateOrderStatus = async (orderId, status) => {
    const existingOrder = orders.find((entry) => entry.id === orderId);

    if (!existingOrder) {
      return;
    }

    const deliveredAt =
      status === "Delivered"
        ? Number(existingOrder.deliveredAt) || Date.now()
        : Number(existingOrder.deliveredAt) || 0;

    const nextOrder = normalizeOrderRecord({
      ...existingOrder,
      status,
      deliveredAt,
      deliveredAtLabel:
        status === "Delivered" || deliveredAt
          ? formatDateTimeLabel(deliveredAt)
          : "",
      refundRequested:
        status === "Refund Requested" ? true : existingOrder.refundRequested,
      returnRequested:
        status === "Return Requested" ? true : existingOrder.returnRequested
    });

    try {
      await setDoc(doc(db, FIRESTORE_PATHS.ordersCollection, orderId), nextOrder, {
        merge: true
      });
      setOrders((prev) =>
        prev.map((entry) => (entry.id === orderId ? nextOrder : entry))
      );
      setToast(`Order marked as ${status}.`);
    } catch (error) {
      console.error(error);
      setToast("Unable to update the order right now.");
    }
  };

  const openReturnRequestForm = (order) => {
    setReturnRequestForm({
      orderId: order.id,
      name: currentUserRecord?.name || user?.name || order.customer?.name || "",
      phone: currentUserRecord?.phone || order.customer?.phone || "",
      reason: ""
    });
  };

  const submitReturnRequest = async (orderId) => {
    const existingOrder = orders.find((entry) => entry.id === orderId);

    if (!existingOrder) {
      setToast("Order not found.");
      return;
    }

    if (!canRequestReturnForOrder(existingOrder)) {
      setToast("Return request window is closed for this order.");
      return;
    }

    const name = String(returnRequestForm.name || "").trim();
    const phone = String(returnRequestForm.phone || "").trim();
    const reason = String(returnRequestForm.reason || "").trim();

    if (!name || !phone || !reason) {
      setToast("Enter name, phone number, and return reason.");
      return;
    }

    if (!/^\d{10}$/.test(phone)) {
      setToast("Please enter a valid 10-digit phone number.");
      return;
    }

    const requestedAt = Date.now();
    const nextOrder = normalizeOrderRecord({
      ...existingOrder,
      returnRequested: true,
      returnRequestStatus: "Pending",
      returnRequest: {
        name,
        phone,
        reason,
        requestedAt,
        requestedAtLabel: formatDateTimeLabel(requestedAt)
      }
    });

    try {
      await setDoc(doc(db, FIRESTORE_PATHS.ordersCollection, orderId), nextOrder, {
        merge: true
      });
      setOrders((prev) =>
        prev.map((entry) => (entry.id === orderId ? nextOrder : entry))
      );
      setReturnRequestForm({ orderId: "", name: "", phone: "", reason: "" });
      setToast("Return request submitted.");
    } catch (error) {
      console.error(error);
      setToast("Unable to submit the return request right now.");
    }
  };

  const updateReturnRequestStatus = async (orderId, returnRequestStatus) => {
    const existingOrder = orders.find((entry) => entry.id === orderId);

    if (!existingOrder || !existingOrder.returnRequested) {
      return;
    }

    const nextOrder = normalizeOrderRecord({
      ...existingOrder,
      returnRequestStatus
    });

    try {
      await setDoc(doc(db, FIRESTORE_PATHS.ordersCollection, orderId), nextOrder, {
        merge: true
      });
      setOrders((prev) =>
        prev.map((entry) => (entry.id === orderId ? nextOrder : entry))
      );
      setToast(`Return request ${returnRequestStatus.toLowerCase()}.`);
    } catch (error) {
      console.error(error);
      setToast("Unable to update the return request right now.");
    }
  };

  const buildEmptyBannerForm = () => ({
    ...emptyBannerForm
  });

  const buildEmptyHighlightForm = () => ({
    ...emptyHighlightForm
  });

  const setBannerFormField = (field, value) => {
    setBannerForm((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const setHighlightFormField = (field, value) => {
    setHighlightForm((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const saveBanner = () => {
    if (!String(bannerForm.mediaData || "").trim()) {
      setToast("Upload banner media.");
      return;
    }

    if (!bannerForm.id && managedHomepageBanners.length >= MAX_HOME_BANNERS) {
      setToast(`You can upload up to ${MAX_HOME_BANNERS} homepage banners.`);
      return;
    }

    const nextBanner = normalizeBanner(
      {
        id: bannerForm.id || createId("banner"),
        title: bannerForm.title.trim(),
        subtitle: bannerForm.subtitle.trim(),
        description: bannerForm.description.trim(),
        mediaType: bannerForm.mediaType,
        mediaData: String(bannerForm.mediaData || "").trim(),
        linkedProductId: String(bannerForm.linkedProductId || "").trim(),
        aspectRatio: normalizeAspectRatio(
          bannerForm.aspectRatio,
          DEFAULT_BANNER_ASPECT_RATIO
        )
      },
      0
    );

    setSettings((prev) => {
      const safeBanners = Array.isArray(prev.banners) ? prev.banners : [];
      const exists = safeBanners.some((entry) => entry.id === nextBanner.id);
      const nextBanners = exists
        ? safeBanners.map((entry) => (entry.id === nextBanner.id ? nextBanner : entry))
        : [...safeBanners, nextBanner];

      return {
        ...prev,
        banners: normalizeStoredBanners(nextBanners)
      };
    });

    setBannerForm(buildEmptyBannerForm());
    setToast("Banner saved.");
  };

  const editBanner = (banner) => {
    setBannerForm(normalizeBanner(banner));
    setAdminTab("content");
  };

  const removeBanner = (bannerId) => {
    setSettings((prev) => ({
      ...prev,
      banners: prev.banners.filter((entry) => entry.id !== bannerId)
    }));

    if (bannerForm.id === bannerId) {
      setBannerForm(buildEmptyBannerForm());
    }

    setToast("Banner removed.");
  };

  const moveBanner = (bannerId, direction) => {
    setSettings((prev) => {
      const safeBanners = normalizeStoredBanners(prev.banners);
      const currentIndex = safeBanners.findIndex((entry) => entry.id === bannerId);
      const targetIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;

      if (
        currentIndex === -1 ||
        targetIndex < 0 ||
        targetIndex >= safeBanners.length
      ) {
        return prev;
      }

      const nextBanners = [...safeBanners];
      [nextBanners[currentIndex], nextBanners[targetIndex]] = [
        nextBanners[targetIndex],
        nextBanners[currentIndex]
      ];

      return {
        ...prev,
        banners: nextBanners
      };
    });
    setToast("Banner order updated.");
  };

  const saveHomeHighlight = () => {
    if (!highlightForm.title.trim()) {
      setToast("Enter a homepage feature label.");
      return;
    }

    if (!highlightForm.id && managedHomeHighlights.length >= MAX_HOME_HIGHLIGHTS) {
      setToast(`You can add up to ${MAX_HOME_HIGHLIGHTS} homepage features.`);
      return;
    }

    const nextHighlight = normalizeHomeHighlight(
      {
        id: highlightForm.id || createId("highlight"),
        title: highlightForm.title.trim(),
        description: highlightForm.description.trim(),
        badge: highlightForm.badge.trim(),
        iconKey: highlightForm.iconKey
      },
      0
    );

    setSettings((prev) => {
      const safeHighlights = normalizeStoredHomeHighlights(prev.homeHighlights);
      const exists = safeHighlights.some((entry) => entry.id === nextHighlight.id);
      const nextHighlights = exists
        ? safeHighlights.map((entry) =>
            entry.id === nextHighlight.id ? nextHighlight : entry
          )
        : [...safeHighlights, nextHighlight];

      return {
        ...prev,
        homeHighlights: normalizeStoredHomeHighlights(nextHighlights)
      };
    });

    setHighlightForm(buildEmptyHighlightForm());
    setToast("Homepage feature saved.");
  };

  const editHomeHighlight = (highlight) => {
    setHighlightForm(normalizeHomeHighlight(highlight));
    setAdminTab("content");
  };

  const removeHomeHighlight = (highlightId) => {
    setSettings((prev) => ({
      ...prev,
      homeHighlights: normalizeStoredHomeHighlights(
        (prev.homeHighlights || []).filter((entry) => entry.id !== highlightId)
      )
    }));

    if (highlightForm.id === highlightId) {
      setHighlightForm(buildEmptyHighlightForm());
    }

    setToast("Homepage feature removed.");
  };

  const moveHomeHighlight = (highlightId, direction) => {
    setSettings((prev) => {
      const safeHighlights = normalizeStoredHomeHighlights(prev.homeHighlights);
      const currentIndex = safeHighlights.findIndex((entry) => entry.id === highlightId);
      const targetIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;

      if (
        currentIndex === -1 ||
        targetIndex < 0 ||
        targetIndex >= safeHighlights.length
      ) {
        return prev;
      }

      const nextHighlights = [...safeHighlights];
      [nextHighlights[currentIndex], nextHighlights[targetIndex]] = [
        nextHighlights[targetIndex],
        nextHighlights[currentIndex]
      ];

      return {
        ...prev,
        homeHighlights: nextHighlights
      };
    });
    setToast("Homepage feature order updated.");
  };

  const addLatestDropProduct = (productId) => {
    if (!productId) {
      setToast("Pick a product to feature in Latest Drops.");
      return;
    }

    if (latestDropProductIds.includes(productId)) {
      setToast("This product is already in Latest Drops.");
      return;
    }

    if (latestDropProductIds.length >= MAX_LATEST_DROPS) {
      setToast(`You can pin up to ${MAX_LATEST_DROPS} Latest Drops.`);
      return;
    }

    setSettings((prev) => ({
      ...prev,
      latestDropProductIds: sanitizeStoredProductIds(
        [...(prev.latestDropProductIds || []), productId],
        MAX_LATEST_DROPS
      )
    }));
    setToast("Latest Drops updated.");
  };

  const removeLatestDropProduct = (productId) => {
    setSettings((prev) => ({
      ...prev,
      latestDropProductIds: sanitizeStoredProductIds(
        (prev.latestDropProductIds || []).filter((entry) => entry !== productId),
        MAX_LATEST_DROPS
      )
    }));
    setToast("Latest Drops updated.");
  };

  const moveLatestDropProduct = (productId, direction) => {
    const currentIndex = latestDropProductIds.findIndex((entry) => entry === productId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (
      currentIndex === -1 ||
      targetIndex < 0 ||
      targetIndex >= latestDropProductIds.length
    ) {
      return;
    }

    const nextIds = [...latestDropProductIds];
    [nextIds[currentIndex], nextIds[targetIndex]] = [
      nextIds[targetIndex],
      nextIds[currentIndex]
    ];

    setSettings((prev) => ({
      ...prev,
      latestDropProductIds: sanitizeStoredProductIds(nextIds, MAX_LATEST_DROPS)
    }));
    setToast("Latest Drops order updated.");
  };

  const saveOffer = () => {
    if (!offerForm.text.trim()) {
      setToast("Enter an offer.");
      return;
    }

    const nextOffer = {
      id: offerForm.id || createId("offer"),
      text: offerForm.text.trim()
    };

    setSettings((prev) => {
      const exists = prev.offers.some((entry) => entry.id === nextOffer.id);
      return {
        ...prev,
        offers: exists
          ? prev.offers.map((entry) => (entry.id === nextOffer.id ? nextOffer : entry))
          : [nextOffer, ...prev.offers]
      };
    });

    setOfferForm(emptyOfferForm);
    setToast("Offer saved.");
  };

  const editOffer = (offer) => {
    setOfferForm(offer);
    setAdminTab("content");
  };

  const removeOffer = (offerId) => {
    setSettings((prev) => ({
      ...prev,
      offers: prev.offers.filter((entry) => entry.id !== offerId)
    }));
    setToast("Offer removed.");
  };

  const saveStorePolicies = () => {
    const nextTerms = String(policyForm.termsAndConditions || "").trim();
    const nextPrivacy = String(policyForm.privacyPolicy || "").trim();
    const nextContactEmail = String(policyForm.contactEmail || "").trim();
    const nextAboutUs = String(policyForm.aboutUs || "").trim();

    setSettings((prev) => ({
      ...prev,
      termsAndConditions: nextTerms || defaultSettings.termsAndConditions,
      privacyPolicy: nextPrivacy || defaultSettings.privacyPolicy,
      contactEmail: nextContactEmail || defaultSettings.contactEmail,
      aboutUs: nextAboutUs || defaultSettings.aboutUs
    }));
    setToast("Policies updated.");
  };

  const resetPolicyForm = () => {
    setPolicyForm({
      termsAndConditions: storeTermsAndConditions,
      privacyPolicy: storePrivacyPolicy,
      contactEmail: storeContactEmail,
      aboutUs: storeAboutUs
    });
    setToast("Policy draft reset.");
  };

  const updateSettingField = (field, value) => {
    setSettings((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const togglePaymentMethod = (method) => {
    setSettings((prev) => ({
      ...prev,
      paymentMethods: {
        ...prev.paymentMethods,
        [method]: !prev.paymentMethods[method]
      }
    }));
  };

  const handleImageUpload = async (event, onDone, options = {}) => {
    const {
      multiple = false,
      successMessage = "Media uploaded.",
      failureMessage = "Media upload failed.",
      validateFiles
    } = options;
    const files = Array.from(event.target.files || []);

    if (files.length === 0) {
      return;
    }

    const validationMessage =
      typeof validateFiles === "function" ? validateFiles(files) : "";

    if (validationMessage) {
      setToast(validationMessage);
      event.target.value = "";
      return;
    }

    try {
      const uploads = await Promise.all(files.map((file) => uploadFileToCloudinary(file)));
      await Promise.resolve(
        onDone(multiple ? uploads : uploads[0], multiple ? files : files[0])
      );
      setToast(successMessage);
    } catch (error) {
      console.error(error);
      setToast(failureMessage);
    } finally {
      event.target.value = "";
    }
  };

  const renderBackButton = () => (
    <button
      onClick={goBack}
      className="button-secondary back-button"
      style={{ ...secondaryButtonStyle, marginBottom: "20px" }}
    >
      Back
    </button>
  );

  const renderPolicyPage = (title, content) => (
    <div style={shellStyle}>
      {renderBackButton()}
      <div style={{ ...cardStyle, maxWidth: "980px" }}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        <div
          style={{
            whiteSpace: "pre-line",
            lineHeight: 1.9,
            color: tone.body
          }}
        >
          {content}
        </div>
      </div>
    </div>
  );

  const renderMorePage = () => (
    <div style={shellStyle}>
      {renderBackButton()}
      <div style={{ ...cardStyle, maxWidth: "980px" }}>
        <h2 style={{ marginTop: 0 }}>More</h2>
        <div
          style={{
            display: "grid",
            gap: "24px",
            lineHeight: 1.9,
            color: tone.body
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "16px",
              flexWrap: "wrap"
            }}
          >
            <strong>Contact Us</strong>
            <a href={`mailto:${storeContactEmail}`} style={{ color: tone.body }}>
              {storeContactEmail}
            </a>
          </div>
          <div>
            <strong>About Us</strong>
            <div style={{ marginTop: "8px", whiteSpace: "pre-line" }}>{storeAboutUs}</div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderBrandMedia = (className, style) =>
    brandMediaIsVideo ? (
      <video
        src={brandMediaSource}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        controlsList="nodownload"
        disablePictureInPicture
        draggable={false}
        onContextMenu={(event) => event.preventDefault()}
        className={className}
        style={style}
      />
    ) : (
      <img
        src={brandMediaSource}
        alt={siteName}
        className={className}
        style={style}
        decoding="async"
        draggable={false}
        onContextMenu={(event) => event.preventDefault()}
      />
    );

  const getPrimaryProductMedia = (product) => {
    const [firstImage] = getProductImages(product);

    if (firstImage) {
      return {
        id: `${product.id}-primary-image`,
        type: "image",
        src: firstImage,
        title: product.category,
        note: product.badge || "Product Detail"
      };
    }

    const video = getProductVideo(product);

    return video
      ? {
          id: `${product.id}-primary-video`,
          type: "video",
          src: video,
          title: "Product Video",
          note: "Preview"
        }
      : null;
  };

  const jumpToBanner = (index) => {
    if (homepageBanners.length <= 1) {
      return;
    }

    if (bannerResetTimerRef.current) {
      window.clearTimeout(bannerResetTimerRef.current);
      bannerResetTimerRef.current = null;
    }

    setBannerTransitionEnabled(true);
    setActiveBannerIndex(index);
  };

  const handleHeroCarouselTransitionEnd = (event) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    const property = String(event.propertyName || "");
    if (property && !property.includes("transform")) {
      return;
    }

    if (
      homepageBanners.length <= 1 ||
      activeBannerIndexRef.current !== homepageBanners.length
    ) {
      return;
    }

    if (bannerResetTimerRef.current) {
      window.clearTimeout(bannerResetTimerRef.current);
    }

    setBannerTransitionEnabled(false);
    setActiveBannerIndex(0);
    bannerResetTimerRef.current = window.setTimeout(() => {
      setBannerTransitionEnabled(true);
      bannerResetTimerRef.current = null;
    }, 60);
  };

  const renderProductCard = (product) => {
    const inWishlist = wishlist.includes(product.id);
    const price = discountPrice(product);
    const primaryMedia = getPrimaryProductMedia(product);
    const cardFlag = product.badge || COLLECTION_COPY[product.category]?.eyebrow || "New Drop";
    const productSubtitle = formatProductSubtitle(product);

    return (
      <article
        key={product.id}
        className="product-card js-reveal"
        role="button"
        tabIndex={0}
        aria-label={`View ${product.name}`}
        onClick={() => openProduct(product)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }

          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openProduct(product);
          }
        }}
        style={{
          display: "grid",
          gap: 0,
          height: "100%"
        }}
      >
        <div className="product-card__media-shell">
          <span className="product-card__flag">{cardFlag}</span>

          <div
            className="product-card__media"
            style={{
              background: primaryMedia ? "transparent" : tone.soft
            }}
          >
            {primaryMedia?.type === "image" ? (
              <img
                src={primaryMedia.src}
                alt={product.name}
                loading="lazy"
                decoding="async"
                className="product-card__image"
                style={{
                  filter: "none"
                }}
              />
            ) : primaryMedia?.type === "video" ? (
              <video
                src={primaryMedia.src}
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                className="product-card__image"
                style={{
                  filter: "none"
                }}
              />
            ) : (
              <div className="product-card__placeholder">
                <p
                  style={{
                    margin: 0,
                    fontSize: "12px",
                    letterSpacing: "3px",
                    textTransform: "uppercase",
                    color: tone.muted
                  }}
                >
                  {COLLECTION_COPY[product.category]?.eyebrow || "Luxury Collection"}
                </p>
                <h3 style={{ margin: "12px 0 0", fontSize: "28px" }}>{product.category}</h3>
              </div>
            )}
          </div>
        </div>

        <div className="product-card__content">
          <div className="product-card__body">
            <div className="product-card__meta-row">
              <div className="product-card__text">
                <h3 className="product-card__title">{product.name}</h3>
                <p className="product-card__subtitle">{productSubtitle}</p>
                <p className="product-card__kalawa-note">A symbol of who we are.</p>
              </div>

              <button
                type="button"
                aria-label={inWishlist ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
                className="product-card__wishlist"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleWishlist(product.id);
                }}
              >
                <HeartIcon fill={inWishlist ? "currentColor" : "none"} />
              </button>
            </div>
          </div>

          <div className="product-card__footer">
            <p className="product-card__price">{formatCurrency(price)}</p>
            {product.discount > 0 && (
              <p className="product-card__compare">
                <s>{formatCurrency(product.price)}</s> ({product.discount}% off)
              </p>
            )}
          </div>
        </div>
      </article>
    );
  };

  const renderCatalogSection = (title, sectionProducts, departmentKey, menuItems) => (
    <section className="catalog-section js-reveal" style={{ marginTop: "32px" }}>
      <div
        className="section-heading"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px"
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 6px" }}>{title}</h2>
          <p style={{ margin: 0, color: tone.muted }}>
            {hasActiveSearch
              ? `Showing ${sectionProducts.length} result${sectionProducts.length === 1 ? "" : "s"} for "${searchTerm.trim()}".`
              : "Explore the full devotional streetwear catalog beyond the featured homepage drops."}
          </p>
        </div>
        {!hasActiveSearch && menuItems.length > 0 && (
          <div className="filter-pill-row" style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {menuItems.map((item) => (
              <button
                key={item.value}
                onClick={() => openDepartment(departmentKey, item.value)}
                className="filter-pill"
                style={{
                  ...secondaryButtonStyle,
                  background:
                    selectedDepartment === departmentKey && selectedCategory === item.value
                      ? tone.black
                      : tone.white,
                  color:
                    selectedDepartment === departmentKey && selectedCategory === item.value
                      ? tone.white
                      : tone.body
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {sectionProducts.length === 0 ? (
        <div className="empty-state-card" style={{ ...cardStyle, color: tone.muted }}>
          No products found for this selection.
        </div>
      ) : (
        <div className="catalog-grid">
          {sectionProducts.map((product) => renderProductCard(product))}
        </div>
      )}
    </section>
  );

  const renderHome = () => (
    <>
      <section className="hero-media-banner hero-media-banner--carousel js-reveal">
        <div
          className="hero-media-banner__viewport"
          style={{ aspectRatio: `${activeHomepageBannerAspectRatio}` }}
        >
          <div
            className="hero-media-banner__track"
            style={{
              transform: `translate3d(-${activeBannerIndex * 100}%, 0, 0)`,
              transition: bannerTransitionEnabled
                ? "transform 760ms cubic-bezier(0.22, 1, 0.36, 1)"
                : "none"
            }}
            onTransitionEnd={handleHeroCarouselTransitionEnd}
          >
            {heroCarouselBanners.map((banner, index) => {
              const bannerMediaSource = getBannerMediaSource(banner);
              const bannerMediaType = getBannerMediaType(banner);
              const linkedBannerProduct =
                products.find((item) => item.id === banner.linkedProductId) || null;

              return (
                <div key={`${banner.id}-${index}`} className="hero-media-banner__slide">
                  {bannerMediaType === "video" ? (
                    <video
                      key={`video-${banner.id}-${index}-${bannerMediaSource}`}
                      src={bannerMediaSource}
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="auto"
                      className="hero-media-banner__asset"
                    />
                  ) : (
                    <img
                      key={`image-${banner.id}-${index}-${bannerMediaSource}`}
                      src={bannerMediaSource}
                      alt={banner.title || `${siteName} banner ${index + 1}`}
                      className="hero-media-banner__asset"
                      decoding="async"
                      loading="eager"
                      fetchPriority={index === 0 ? "high" : "auto"}
                    />
                  )}
                  <div className="hero-media-banner__overlay">
                    <div className="hero-media-banner__copy">
                      {banner.subtitle ? (
                        <p className="hero-media-banner__eyebrow">{banner.subtitle}</p>
                      ) : null}
                      <h2 className="hero-media-banner__title">{banner.title}</h2>
                      {banner.description ? (
                        <p className="hero-media-banner__description">{banner.description}</p>
                      ) : null}
                      {linkedBannerProduct ? (
                        <button
                          type="button"
                          onClick={() => openProduct(linkedBannerProduct)}
                          className="hero-media-banner__cta"
                        >
                          <span>Shop Now</span>
                          <ArrowRightIcon />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {homepageBanners.length > 1 && (
          <div className="hero-media-banner__controls" aria-label="Homepage banner controls">
            {homepageBanners.map((banner, index) => (
              <button
                key={banner.id}
                onClick={() => jumpToBanner(index)}
                className={`hero-media-banner__dot${
                  activeHomepageBannerIndex === index ? " is-active" : ""
                }`}
                aria-label={`Show ${banner.title || `banner ${index + 1}`}`}
              />
            ))}
          </div>
        )}
      </section>

      <div className="home-shell" style={shellStyle}>
        {hasActiveSearch ? (
          <section className="js-reveal" style={{ ...cardStyle, marginTop: "8px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap"
              }}
            >
              <div>
                <h2 style={{ margin: "0 0 8px" }}>Search Results</h2>
                <p style={{ margin: 0, color: tone.muted }}>
                  Live results for "{searchTerm.trim()}".
                </p>
              </div>
              <button onClick={clearSearch} style={secondaryButtonStyle}>
                Clear Search
              </button>
            </div>
          </section>
        ) : (
          <>
            {managedHomeHighlights.length > 0 && (
              <section
                className="home-highlight-strip js-reveal"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(
                    Math.max(managedHomeHighlights.length, 1),
                    4
                  )}, minmax(0, 1fr))`
                }}
              >
                {managedHomeHighlights.map((highlight) => {
                  const HighlightIcon =
                    HOME_HIGHLIGHT_ICON_COMPONENTS[highlight.iconKey] || 
                    QualitySealIcon;

                  return (
                    <article key={highlight.id} className="home-highlight-card">
                      <div className="home-highlight-card__icon">
                        <HighlightIcon />
                      </div>
                      <div className="home-highlight-card__copy">
                        {highlight.badge ? (
                          <span className="home-highlight-card__badge">{highlight.badge}</span>
                        ) : null}
                        <div className="home-highlight-card__title-row">
                          <h3>{highlight.title}</h3>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}

            <section className="latest-drops-panel js-reveal">
              <div className="latest-drops-panel__header">
                <div>
                  <p className="latest-drops-panel__eyebrow">Curated Fresh</p>
                  <h2 style={{ margin: "0 0 8px" }}>Latest Drops</h2>
                </div>
                <div style={{ minWidth: "220px" }}>
                  <select
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value)}
                    style={selectStyle}
                  >
                    {sortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {latestDropProducts.length > 0 ? (
                <div className="catalog-grid latest-drops-panel__grid">
                  {latestDropProducts.map((product) => renderProductCard(product))}
                </div>
              ) : (
                <div className="empty-state-card" style={{ ...cardStyle, color: tone.muted, marginTop: "18px" }}>
                  Add products to start your Latest Drops section.
                </div>
              )}
            </section>
          </>
        )}

        {renderCatalogSection(
          hasActiveSearch ? "Matching Products" : "Shop All Drops",
          tshirtProducts,
          "tshirts",
          tshirtCategories
        )}
      </div>
    </>
  );

  const renderProductPage = () => {
    if (!selectedProduct || !productConfig) {
      return (
        <div style={shellStyle}>
          {renderBackButton()}
          <div style={cardStyle}>The selected product is no longer available.</div>
        </div>
      );
    }

    const finalPrice = discountPrice(selectedProduct);
    const mediaItems = getProductMediaItems(selectedProduct);
    const selectedQuantity = Math.max(1, Number(productConfig.quantity) || 1);
    const productAvailability = normalizeProductAvailability(
      selectedProduct.availability,
      selectedProduct.stock
    );
    const isProductInStock = productAvailability === PRODUCT_AVAILABILITY.IN_STOCK;
    const isProductComingSoon = productAvailability === PRODUCT_AVAILABILITY.COMING_SOON;
    const availabilityText = isProductInStock
      ? `${selectedProduct.stock} T-shirt${selectedProduct.stock === 1 ? "" : "s"} available`
      : isProductComingSoon
        ? "Coming Soon"
        : "Out of Stock";
    const productDetails = [
      { label: "Collection", value: selectedProduct.category },
      { label: "Edition", value: selectedProduct.badge || "Signature Drop" },
      {
        label: "Availability",
        value: availabilityText
      },
      { label: "Fabric", value: "Premium heavyweight cotton" },
      { label: "Care", value: "Cold wash inside out and dry flat" },
      { label: "Dispatch", value: "Ships within 48 hours" }
    ];
    const galleryPanels =
      mediaItems.length > 0
        ? mediaItems
        : [
            {
              id: "placeholder",
              type: "placeholder",
              title: selectedProduct.category,
              note: selectedProduct.badge || "Signature Drop"
            }
          ];

    return (
      <div className="product-page-shell">
        <div className="product-split-layout">
          <section className="product-side product-side--left js-reveal">
            <div className="product-side__inner">
              <div className="product-side__back-shell">
                {renderBackButton()}
              </div>

              <div className="product-side__headline">
                <p className="product-side__eyebrow">
                  T-Shirt / {selectedProduct.category}
                </p>
                {selectedProduct.badge ? (
                  <span className="product-side__badge">{selectedProduct.badge}</span>
                ) : null}
              </div>

              <div className="product-side__copy">
                <h1 className="product-side__title">{selectedProduct.name}</h1>
                <p className="product-side__description">
                  {selectedProduct.description}
                </p>
              </div>

              <div className="product-side__price-row">
                <span className="product-side__price">{formatCurrency(finalPrice)}</span>
                {selectedProduct.discount > 0 && (
                  <span className="product-side__compare">
                    <s>{formatCurrency(selectedProduct.price)}</s> ({selectedProduct.discount}% off)
                  </span>
                )}
              </div>

              <section className="product-side__section">
                <p className="product-side__label">Sizes</p>
                <div className="detail-chip-row product-option-row">
                  {selectedProduct.sizes.map((size) => (
                    <button
                      key={size}
                      onClick={() => updateProductConfig("size", size)}
                      className="button-secondary product-option-chip"
                      style={{
                        ...secondaryButtonStyle,
                        background: productConfig.size === size ? tone.black : "transparent",
                        color: productConfig.size === size ? tone.white : tone.body
                      }}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </section>

              <div className="product-side__actions">
                {isProductInStock ? (
                  <button
                    onClick={() => addConfiguredProductToCart()}
                    className="button-primary product-side__cta"
                    style={primaryButtonStyle}
                  >
                    Add to Cart
                  </button>
                ) : isProductComingSoon ? (
                  <button
                    type="button"
                    className="button-primary product-side__cta"
                    style={primaryButtonStyle}
                    disabled
                  >
                    Coming Soon
                  </button>
                ) : (
                  <p className="product-side__note">
                    Out of Stock
                  </p>
                )}
              </div>
            </div>
          </section>

          <section
            className="product-media-column js-reveal"
            aria-label={`${selectedProduct.name} media gallery`}
          >
            {galleryPanels.map((panel) => (
              <article
                key={panel.id}
                className={`product-media-item${
                  panel.type === "placeholder" ? " product-media-item--placeholder" : ""
                }`}
              >
                <div className="product-media-frame">
                  {panel.type === "image" ? (
                    <button
                      type="button"
                      className="product-media-button"
                      onTouchStart={handleProductMediaTouchStart}
                      onTouchMove={handleProductMediaTouchMove}
                      onClick={(event) => openZoomedProductMedia(event, panel)}
                    >
                      <img
                        src={panel.src}
                        alt={`${selectedProduct.name} ${panel.title}`}
                        className="product-media-asset product-media-asset--image"
                        style={{ filter: "none" }}
                      />
                    </button>
                  ) : panel.type === "video" ? (
                    <video
                      src={panel.src}
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="metadata"
                      className="product-media-asset product-media-asset--video"
                      style={{ filter: "none" }}
                    />
                  ) : (
                    <div className="product-media-placeholder">
                      <p>{panel.title}</p>
                      <h2>{selectedProduct.name}</h2>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </section>

          <section className="product-side product-side--right js-reveal">
            <div className="product-side__inner">
              <section className="product-side__section product-side__section--tight">
                <p className="product-side__label">Colours</p>
                <div className="detail-chip-row product-option-row">
                  {selectedProduct.colors.map((color) => (
                    <button
                      key={color}
                      onClick={() => updateProductConfig("color", color)}
                      className="button-secondary product-option-chip"
                      style={{
                        ...secondaryButtonStyle,
                        background: productConfig.color === color ? tone.black : "transparent",
                        color: productConfig.color === color ? tone.white : tone.body
                      }}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </section>

              <section className="product-side__section product-side__section--tight">
                <p className="product-side__label">Quantity</p>
                <input
                  type="number"
                  min="1"
                  value={productConfig.quantity}
                  onChange={(event) => updateProductConfig("quantity", event.target.value)}
                  className="product-side__quantity"
                  style={inputStyle}
                />
              </section>

              <div className="product-config-summary">
                <span>Selected setup</span>
                <strong>{productConfig.color} / {productConfig.size}</strong>
                {isProductComingSoon ? null : (
                  <p>
                    {isProductInStock
                      ? `${selectedQuantity} piece${selectedQuantity > 1 ? "s" : ""} ready for checkout`
                      : availabilityText}
                  </p>
                )}
              </div>

              <div className="product-detail-list">
                {productDetails.map((detail) => (
                  <div key={detail.label} className="product-detail-list__item">
                    <span>{detail.label}</span>
                    <strong>{detail.value}</strong>
                  </div>
                ))}
              </div>

              <div className="product-side__actions product-side__actions--secondary">
                {isProductInStock ? (
                  <button
                    onClick={addAndGoToCart}
                    className="button-secondary product-side__cta product-side__cta--secondary"
                    style={buyNowButtonStyle}
                  >
                    Buy Now
                  </button>
                ) : null}
                <button
                  onClick={() => toggleWishlist(selectedProduct.id)}
                  className="product-side__text-button"
                >
                  {wishlist.includes(selectedProduct.id) ? "Saved in Wishlist" : "Save to Wishlist"}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  };

  const renderWishlist = () => {
    const wishlistProducts = products.filter((product) => wishlist.includes(product.id));

    return (
      <div style={shellStyle}>
        {renderBackButton()}
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Wishlist</h2>
          {wishlistProducts.length === 0 ? (
            <p style={{ margin: 0, color: tone.muted }}>
              No saved products yet.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "18px"
              }}
            >
              {wishlistProducts.map((product) => renderProductCard(product))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCart = () => (
    <div style={shellStyle}>
      {renderBackButton()}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "24px"
        }}
      >
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Cart</h2>
          {cart.length === 0 ? (
            <>
              <p style={{ color: tone.muted }}>Your cart is empty.</p>
              <button onClick={goHome} style={primaryButtonStyle}>
                Continue Shopping
              </button>
            </>
          ) : (
            <div style={{ display: "grid", gap: "14px" }}>
              {cart.map((item) => (
                <div
                  key={item.cartId}
                  style={{
                    border: `1px solid ${tone.line}`,
                    borderRadius: "18px",
                    padding: "18px"
                  }}
                >
                  {(() => {
                    const cartProduct = products.find((product) => product.id === item.productId) || null;
                    const cartImage = cartProduct ? getProductImages(cartProduct)[0] : "";

                    return (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: "14px"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", minWidth: 0 }}>
                      {cartImage ? (
                        <img
                          src={cartImage}
                          alt={item.name}
                          style={{
                            width: "56px",
                            height: "56px",
                            objectFit: "cover",
                            borderRadius: "12px",
                            flexShrink: 0
                          }}
                        />
                      ) : null}
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ margin: "0 0 8px" }}>{item.name}</h3>
                        <p style={{ margin: "4px 0", color: tone.muted }}>
                          {item.color} | {item.size} | Qty {item.quantity}
                        </p>
                        <p style={{ margin: 0, fontWeight: 700 }}>{formatCurrency(item.unitPrice * item.quantity)}</p>
                      </div>
                    </div>
                    <button onClick={() => removeFromCart(item.cartId)} style={secondaryButtonStyle}>
                      Remove
                    </button>
                  </div>
                    );
                  })()}

                  <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
                    <button onClick={() => updateCartQuantity(item.cartId, -1)} style={secondaryButtonStyle}>
                      -
                    </button>
                    <div
                      style={{
                        minWidth: "60px",
                        borderRadius: "12px",
                        background: tone.soft,
                        display: "grid",
                        placeItems: "center",
                        fontWeight: 700
                      }}
                    >
                      {item.quantity}
                    </div>
                    <button onClick={() => updateCartQuantity(item.cartId, 1)} style={secondaryButtonStyle}>
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Order Summary</h2>
          <div style={{ display: "grid", gap: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Items</span>
              <span>{cartCount}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Shipping</span>
              <span>Free</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "20px" }}>
              <span>Total</span>
              <span>{formatCurrency(cartTotal)}</span>
            </div>
          </div>
          <button
            onClick={() => navigateTo("checkout")}
            style={{ ...primaryButtonStyle, width: "100%", marginTop: "22px" }}
            disabled={cart.length === 0}
          >
            Proceed to Checkout
          </button>
        </aside>
      </div>
    </div>
  );

  const renderCheckout = () => (
    <div style={shellStyle}>
      {renderBackButton()}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "24px"
        }}
      >
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Checkout Details</h2>
          <div style={{ display: "grid", gap: "14px" }}>
            <input name="name" value={checkoutForm.name} onChange={handleCheckoutChange} placeholder="Full name" style={inputStyle} />
            <input name="phone" value={checkoutForm.phone} onChange={handleCheckoutChange} placeholder="Phone number" style={inputStyle} />
            <input name="address" value={checkoutForm.address} onChange={handleCheckoutChange} placeholder="Full address" style={inputStyle} />
            <input name="city" value={checkoutForm.city} onChange={handleCheckoutChange} placeholder="City" style={inputStyle} />
            <input name="pincode" value={checkoutForm.pincode} onChange={handleCheckoutChange} placeholder="Pincode" style={inputStyle} />
            <input name="landmark" value={checkoutForm.landmark} onChange={handleCheckoutChange} placeholder="Landmark (optional)" style={inputStyle} />
          </div>
        </section>

        <aside style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Delivery Summary</h2>
          <div style={{ display: "grid", gap: "12px" }}>
            {cart.map((item) => (
              (() => {
                const cartProduct = products.find((product) => product.id === item.productId) || null;
                const cartImage = cartProduct ? getProductImages(cartProduct)[0] : "";

                return (
                  <div
                    key={item.cartId}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      paddingBottom: "12px",
                      borderBottom: `1px solid ${tone.line}`
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", minWidth: 0 }}>
                      {cartImage ? (
                        <img
                          src={cartImage}
                          alt={item.name}
                          style={{
                            width: "46px",
                            height: "46px",
                            objectFit: "cover",
                            borderRadius: "10px",
                            flexShrink: 0
                          }}
                        />
                      ) : null}
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{item.name}</p>
                        <p style={{ margin: 0, color: tone.muted }}>
                          {item.size} | {item.color} | Qty {item.quantity}
                        </p>
                      </div>
                    </div>
                    <span>{formatCurrency(item.unitPrice * item.quantity)}</span>
                  </div>
                );
              })()
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "16px", fontWeight: 800 }}>
            <span>Total</span>
            <span>{formatCurrency(cartTotal)}</span>
          </div>
          <button onClick={proceedToPayment} style={{ ...primaryButtonStyle, width: "100%", marginTop: "22px" }}>
            Continue to Payment
          </button>
        </aside>
      </div>
    </div>
  );

  const renderPayment = () => {
    const codCharge = paymentMethod === "cod" ? COD_CHARGE : 0;
    const orderTotal = cartTotal + codCharge;
    const canUseAuraPoints = paymentMethod !== "cod";
    const auraUsed = canUseAuraPoints && checkoutForm.useAuraPoints && user ? Math.min(auraPoints, orderTotal) : 0;
    const remainingPayable = orderTotal - auraUsed;
    const isFullAuraPayment = auraUsed >= orderTotal && auraUsed > 0;

    return (
      <div style={shellStyle}>
        {renderBackButton()}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "24px"
          }}
        >
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Payment Methods</h2>

            {user && auraPoints > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "16px",
                  borderRadius: "0px",
                  border: `1px solid ${tone.line}`,
                  background: (canUseAuraPoints && (checkoutForm.useAuraPoints || paymentMethod === "upi")) ? tone.soft : "transparent",
                  marginBottom: "20px"
                }}
              >
                <input
                  type="checkbox"
                  checked={canUseAuraPoints && (checkoutForm.useAuraPoints || paymentMethod === "upi")}
                  disabled={paymentMethod === "upi" || paymentMethod === "cod"}
                  onChange={(e) => setCheckoutForm(prev => ({ ...prev, useAuraPoints: e.target.checked }))}
                  style={{ width: "20px", height: "20px", cursor: paymentMethod === "upi" || paymentMethod === "cod" ? "default" : "pointer" }}
                />
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 700 }}>
                    {paymentMethod === "upi" ? "Aura Points Applied" : "Use Aura Points"}
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", color: tone.muted }}>
                    Available: {formatCurrency(auraPoints)}
                  </p>
                </div>
                {paymentMethod === "upi" && (
                  <span style={{ fontSize: "12px", color: "#2e7d32", fontWeight: 700 }}>
                    Auto-applied for UPI
                  </span>
                )}
              </div>
            )}

            <div style={{ display: "grid", gap: "14px" }}>
              {enabledPaymentOptions.length === 0 ? (
                <div style={{ color: tone.muted }}>
                  No payment methods are currently available.
                </div>
              ) : (
                enabledPaymentOptions.map((option) => (
                  <div
                    key={option.value}
                    onClick={() => {
                      setPaymentMethod(option.value);
                      if (option.value === "upi" && user) {
                        setCheckoutForm((prev) => ({ ...prev, useAuraPoints: true }));
                      } else if (option.value === "cod") {
                        setCheckoutForm((prev) => ({ ...prev, useAuraPoints: false }));
                      }
                    }}
                    style={{
                      border:
                        paymentMethod === option.value
                          ? `2px solid ${tone.black}`
                          : `1px solid ${tone.border}`,
                      borderRadius: "0px",
                      padding: "18px",
                      background: paymentMethod === option.value ? tone.soft : tone.white,
                      cursor: "pointer"
                    }}
                  >
                    <h3 style={{ margin: "0 0 8px" }}>{option.title}</h3>
                    <p style={{ margin: 0, color: tone.muted }}>{option.description}</p>
                  </div>
                ))
              )}
            </div>

            {paymentMethod === "upi" && !isFullAuraPayment && (
              <div style={{ marginTop: "20px", display: "grid", gap: "16px" }}>
                <div
                  style={{
                    border: `1px solid ${tone.line}`,
                    borderRadius: "0px",
                    padding: "18px",
                    background: tone.soft,
                    display: "grid",
                    gap: "14px"
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <h3 style={{ marginTop: 0 }}>UPI Payment</h3>
                    <p style={{ margin: "0 0 10px", fontSize: "18px", fontWeight: 700 }}>
                      Amount to Pay: {formatCurrency(remainingPayable)}
                    </p>
                    {settings.upiId && (
                      <p style={{ margin: "0 0 14px", color: tone.muted, fontSize: "14px" }}>
                        UPI ID: <span style={{ color: tone.black, fontWeight: 700 }}>{settings.upiId}</span>
                      </p>
                    )}
                  </div>

                  {settings.upiQrData ? (
                    <div style={{ display: "grid", placeItems: "center", background: "#fff", padding: "12px", borderRadius: "0px" }}>
                      <img
                        src={resolveCloudinaryMediaUrl(settings.upiQrData)}
                        alt="UPI QR"
                        style={{ width: "220px", maxWidth: "100%", filter: "none" }}
                      />
                    </div>
                  ) : (
                    <p style={{ color: tone.muted, textAlign: "center", margin: 0 }}>
                      UPI QR not configured.
                    </p>
                  )}
                </div>

                <div style={{ display: "grid", gap: "12px" }}>
                  <h4 style={{ margin: 0 }}>Payment Verification</h4>
                  <input
                    name="customerName"
                    value={checkoutForm.customerName}
                    onChange={handleCheckoutChange}
                    placeholder="Customer Name (on UPI App)"
                    style={inputStyle}
                  />
                  <input
                    name="transactionId"
                    value={checkoutForm.transactionId}
                    onChange={handleCheckoutChange}
                    placeholder="Transaction ID / UTR (Required)"
                    style={inputStyle}
                  />
                  <label style={{ display: "grid", gap: "6px", color: tone.muted, fontSize: "13px" }}>
                    Upload payment screenshot (Optional)
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) =>
                        handleImageUpload(event, (dataUrl) =>
                          setCheckoutForm((prev) => ({ ...prev, paymentScreenshot: dataUrl }))
                        )
                      }
                    />
                  </label>
                  {checkoutForm.paymentScreenshot && (
                    <div style={{ position: "relative", width: "80px" }}>
                      <img
                        src={resolveCloudinaryMediaUrl(checkoutForm.paymentScreenshot)}
                        alt="Screenshot"
                        style={{ width: "100%", height: "100px", objectFit: "cover", borderRadius: "0px" }}
                      />
                      <button
                        onClick={() => setCheckoutForm((prev) => ({ ...prev, paymentScreenshot: "" }))}
                        style={{
                          position: "absolute",
                          top: "-5px",
                          right: "-5px",
                          background: tone.black,
                          color: "#fff",
                          border: "none",
                          borderRadius: "50%",
                          width: "20px",
                          height: "20px",
                          cursor: "pointer",
                          fontSize: "12px"
                        }}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {isFullAuraPayment && (
              <div
                style={{
                  marginTop: "20px",
                  padding: "20px",
                  borderRadius: "0px",
                  background: "#e8f5e9",
                  border: "1px solid #a5d6a7",
                  textAlign: "center"
                }}
              >
                <h3 style={{ margin: "0 0 8px", color: "#2e7d32" }}>Full Aura Payment</h3>
                <p style={{ margin: 0, color: "#2e7d32" }}>
                  Your Aura Points cover the total amount. No UPI payment required.
                </p>
              </div>
            )}
          </section>

          <aside style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Final Summary</h2>
            <p style={{ color: tone.muted, lineHeight: 1.7 }}>
              Deliver to: {checkoutForm.name || "Guest"}, {checkoutForm.address || "-"},{" "}
              {checkoutForm.city || "-"} {checkoutForm.pincode || ""}
            </p>
            <div style={{ display: "grid", gap: "14px" }}>
              <div style={{ display: "grid", gap: "10px" }}>
                {cart.map((item) => {
                  const cartProduct = products.find((product) => product.id === item.productId) || null;
                  const cartImage = cartProduct ? getProductImages(cartProduct)[0] : "";

                  return (
                    <div
                      key={item.cartId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                        {cartImage ? (
                          <img
                            src={cartImage}
                            alt={item.name}
                            style={{
                              width: "42px",
                              height: "42px",
                              objectFit: "cover",
                              borderRadius: "10px",
                              flexShrink: 0
                            }}
                          />
                        ) : null}
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: "14px" }}>{item.name}</p>
                          <p style={{ margin: 0, color: tone.muted, fontSize: "12px" }}>
                            {item.size} | {item.color}
                          </p>
                        </div>
                      </div>
                      <span style={{ fontSize: "13px", color: tone.muted }}>x{item.quantity}</span>
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "10px 12px",
                  borderRadius: "14px",
                  background: tone.soft
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                  <img
                    src={kalawaImage}
                    alt="Free Kalawa"
                    style={{
                      width: "48px",
                      height: "28px",
                      objectFit: "cover",
                      borderRadius: "999px",
                      flexShrink: 0
                    }}
                  />
                  <span style={{ fontSize: "14px", color: tone.body }}>Free Kalawa</span>
                </div>
                <span style={{ fontSize: "14px", color: tone.muted }}>Included</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Items</span>
                <span>{cartCount}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Total Amount</span>
                <span>{formatCurrency(cartTotal)}</span>
              </div>
              {codCharge > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>COD Charge</span>
                  <span>{formatCurrency(codCharge)}</span>
                </div>
              )}
              {auraUsed > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "#2e7d32", fontWeight: 700 }}>
                  <span>Aura Points Used</span>
                  <span>-{formatCurrency(auraUsed)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${tone.line}`, paddingTop: "14px", fontWeight: 800, fontSize: "20px" }}>
                <span>{remainingPayable > 0 ? "Remaining Amount to Pay" : "Total Payable"}</span>
                <span>{formatCurrency(remainingPayable)}</span>
              </div>
            </div>
            <button
              onClick={placeOrder}
              disabled={
                paymentMethod === "upi" &&
                !isFullAuraPayment &&
                (!checkoutForm.transactionId?.trim() || !checkoutForm.customerName?.trim())
              }
              style={{
                ...primaryButtonStyle,
                width: "100%",
                marginTop: "22px",
                padding: "18px",
                textTransform: "uppercase",
                letterSpacing: "2px",
                opacity: (paymentMethod === "upi" && !isFullAuraPayment && (!checkoutForm.transactionId?.trim() || !checkoutForm.customerName?.trim())) ? 0.5 : 1
              }}
            >
              {isFullAuraPayment ? "Confirm with Aura Points" : "Place Order"}
            </button>
          </aside>
        </div>
        <footer className="payment-footer" aria-label="Accepted payment methods">
          <div className="payment-footer__icons" aria-label="Payment methods we accept">
            {acceptedPaymentLogos.map((logo) => (
              <span className="payment-footer__icon-card" key={logo.name}>
                <img src={logo.src} alt={logo.name} className="payment-footer__icon" />
              </span>
            ))}
          </div>
          <div className="footer-powered">
            <span>Powered by</span>
            <img src={razorpayLogoSrc} alt="Razorpay" className="footer-powered__logo" />
          </div>
        </footer>
      </div>
    );
  };

  const renderOrders = () => {
    const visibleOrders = isAdmin
      ? uniqueOrders
      : uniqueOrders.filter((order) => doesOrderBelongToUser(order, currentUserRecord || user));

    return (
      <div style={shellStyle}>
        {renderBackButton()}
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>{isAdmin ? "All Orders" : "My Orders"}</h2>
          {visibleOrders.length === 0 ? (
            <p style={{ margin: 0, color: tone.muted }}>No orders yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "18px" }}>
              {visibleOrders.map((order) => (
                <div
                  key={order.id}
                  style={{
                    border: `1px solid ${tone.line}`,
                    borderRadius: "18px",
                    padding: "20px"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap"
                    }}
                  >
                    <div>
                      <h3 style={{ margin: "0 0 6px" }}>{order.id}</h3>
                      <p style={{ margin: 0, color: tone.muted }}>{order.dateLabel}</p>
                    </div>
                    <span
                      style={{
                        padding: "8px 12px",
                        borderRadius: "999px",
                        background: 
                          order.status === "Paid" ? "#e8f5e9" :
                          order.status === "Rejected" ? "#ffebee" :
                          order.status === "Unpaid" ? "#fff3e0" :
                          tone.soft,
                        color:
                          order.status === "Paid" ? "#2e7d32" :
                          order.status === "Rejected" ? "#c62828" :
                          order.status === "Unpaid" ? "#ef6c00" :
                          tone.body,
                        border: `1px solid ${
                          order.status === "Paid" ? "#a5d6a7" :
                          order.status === "Rejected" ? "#ef9a9a" :
                          order.status === "Unpaid" ? "#ffcc80" :
                          tone.line
                        }`,
                        fontWeight: 700
                      }}
                    >
                      {order.status}
                    </span>
                  </div>

                  {(order.status === "Rejected" || order.status === "Unpaid") && (
                    <div
                      style={{
                        marginTop: "16px",
                        padding: "14px",
                        borderRadius: "14px",
                        background: order.status === "Rejected" ? "#fff5f5" : "#fffaf0",
                        border: `1px solid ${order.status === "Rejected" ? "#feb2b2" : "#fbd38d"}`,
                        color: order.status === "Rejected" ? "#c53030" : "#9c4221"
                      }}
                    >
                      <strong>Note:</strong> {
                        order.status === "Rejected" 
                          ? "Your payment was rejected. This usually happens if the UTR is invalid or fake. Please contact support if you think this is a mistake."
                          : "Your payment was marked as unpaid. Please ensure you have completed the UPI transaction and provided the correct UTR."
                      }
                    </div>
                  )}

                  {order.paymentMethod === "upi" && (
                    <div style={{ marginTop: "16px", fontSize: "13px", color: tone.muted }}>
                      <p style={{ margin: "0 0 4px" }}>
                        Payment Details: {order.customer.customerName} | UTR: {order.customer.transactionId}
                      </p>
                      <p style={{ margin: 0 }}>
                        Submitted: {order.paymentSubmittedLabel}
                      </p>
                    </div>
                  )}

                  <div style={{ marginTop: "16px", display: "grid", gap: "10px" }}>
                    {order.items.map((item) => (
                      <div
                        key={item.cartId}
                        style={{
                          padding: "14px",
                          borderRadius: "14px",
                          background: tone.soft
                        }}
                      >
                        <strong>{item.name}</strong>
                        <p style={{ margin: "6px 0 0", color: tone.muted }}>
                          {item.color} | {item.size} | Qty {item.quantity}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "12px",
                      marginTop: "16px"
                    }}
                  >
                    <div>
                      <p style={{ margin: "0 0 6px", color: tone.muted }}>Delivery</p>
                      <p style={{ margin: 0 }}>
                        {order.customer.name}, {order.customer.address}, {order.customer.city}
                      </p>
                    </div>
                    <div>
                      <p style={{ margin: "0 0 6px", color: tone.muted }}>Payment</p>
                      <p style={{ margin: 0 }}>
                        {paymentCatalog.find((option) => option.value === order.paymentMethod)?.title}
                      </p>
                    </div>
                    <div>
                      <p style={{ margin: "0 0 6px", color: tone.muted }}>Total</p>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ margin: 0, fontWeight: 700 }}>{formatCurrency(order.total)}</p>
                        {order.auraPointsUsed > 0 && (
                          <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#2e7d32" }}>
                            -{formatCurrency(order.auraPointsUsed)} (Aura)
                          </p>
                        )}
                        {order.remainingPayable > 0 && (
                          <p style={{ margin: "2px 0 0", fontSize: "12px", color: tone.muted }}>
                            Paid via UPI
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {!isAdmin && order.deliveredAtLabel && (
                    <div style={{ marginTop: "14px", fontSize: "13px", color: tone.muted }}>
                      Delivered: {order.deliveredAtLabel}
                    </div>
                  )}

                  {!isAdmin && order.returnRequested && (
                    <div
                      style={{
                        marginTop: "16px",
                        padding: "14px",
                        borderRadius: "14px",
                        background: tone.soft,
                        border: `1px solid ${tone.line}`,
                        display: "grid",
                        gap: "8px"
                      }}
                    >
                      <p style={{ margin: 0 }}>
                        <strong>Return Status:</strong> {order.returnRequestStatus || "Pending"}
                      </p>
                      <p style={{ margin: 0, color: tone.muted }}>
                        If admin approves the return, Aura Points will be credited to wallet after product return verification. No cash refund will be provided*
                      </p>
                    </div>
                  )}

                  {!isAdmin && canRequestReturnForOrder(order) && (
                    <div style={{ marginTop: "16px", display: "grid", gap: "12px" }}>
                      <button
                        onClick={() =>
                          returnRequestForm.orderId === order.id
                            ? setReturnRequestForm({ orderId: "", name: "", phone: "", reason: "" })
                            : openReturnRequestForm(order)
                        }
                        style={secondaryButtonStyle}
                      >
                        Return Request
                      </button>

                      {returnRequestForm.orderId === order.id && (
                        <div
                          style={{
                            padding: "16px",
                            borderRadius: "16px",
                            border: `1px solid ${tone.line}`,
                            background: tone.soft,
                            display: "grid",
                            gap: "12px"
                          }}
                        >
                          <input
                            value={returnRequestForm.name}
                            onChange={(event) =>
                              setReturnRequestForm((prev) => ({ ...prev, name: event.target.value }))
                            }
                            placeholder="Name"
                            style={inputStyle}
                          />
                          <input
                            value={returnRequestForm.phone}
                            onChange={(event) =>
                              setReturnRequestForm((prev) => ({ ...prev, phone: event.target.value }))
                            }
                            placeholder="Phone Number"
                            style={inputStyle}
                          />
                          <textarea
                            value={returnRequestForm.reason}
                            onChange={(event) =>
                              setReturnRequestForm((prev) => ({ ...prev, reason: event.target.value }))
                            }
                            placeholder="Return Reason"
                            style={textareaStyle}
                          />
                          <button
                            onClick={() => submitReturnRequest(order.id)}
                            style={primaryButtonStyle}
                          >
                            Submit Return Request
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderWallet = () => (
    <div style={shellStyle}>
      {renderBackButton()}
      <div style={{ ...cardStyle, background: tone.black, color: tone.white }}>
        <p style={{ marginTop: 0, letterSpacing: "3px", textTransform: "uppercase", color: "#cfcfcf" }}>
          Wallet
        </p>
        <h2 style={{ margin: "8px 0 6px", fontSize: "42px" }}>{formatCurrency(auraPoints)}</h2>
        <p style={{ margin: 0, color: "#d8d8d8", lineHeight: 1.7 }}>
          Aura points are managed by the store and can be used at checkout when the payment method is enabled.
        </p>
      </div>
    </div>
  );

  const renderTermsAndConditions = () =>
    renderPolicyPage("Terms & Conditions", storeTermsAndConditions);

  const renderPrivacyPolicy = () =>
    renderPolicyPage("Privacy Policy", storePrivacyPolicy);

  const renderProfile = () => (
    <div style={shellStyle}>
      {renderBackButton()}
      <div style={cardStyle}>
        {!user ? (
          <>
            <h2 style={{ marginTop: 0 }}>Profile</h2>
            <p style={{ color: tone.muted }}>Login to view your profile and wallet.</p>
            <button onClick={loginWithGoogle} style={primaryButtonStyle}>
              Continue with Google
                </button>
          </>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "24px"
            }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h2 style={{ margin: 0 }}>Profile</h2>
                {!isEditingProfile && (
                  <button
                    onClick={startEditingProfile}
                    style={{ ...secondaryButtonStyle, padding: "8px 16px", borderRadius: "10px", fontSize: "14px" }}
                  >
                    Edit Profile
                  </button>
                )}
              </div>

              {isEditingProfile ? (
                <div style={{ display: "grid", gap: "16px" }}>
                  <div style={{ display: "grid", gap: "6px" }}>
                    <label style={{ fontSize: "12px", color: tone.muted, fontWeight: 700, textTransform: "uppercase" }}>Full Name</label>
                    <input
                      value={profileForm.name}
                      onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                      placeholder="Enter your name"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: "grid", gap: "6px" }}>
                    <label style={{ fontSize: "12px", color: tone.muted, fontWeight: 700, textTransform: "uppercase" }}>Email (Read-only)</label>
                    <input
                      value={user.email}
                      readOnly
                      style={{ ...inputStyle, background: "rgba(0,0,0,0.03)", color: tone.muted, cursor: "not-allowed" }}
                    />
                  </div>
                  <div style={{ display: "grid", gap: "6px" }}>
                    <label style={{ fontSize: "12px", color: tone.muted, fontWeight: 700, textTransform: "uppercase" }}>Phone Number</label>
                    <input
                      value={profileForm.phone}
                      onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                      placeholder="10-digit number"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "1fr 1fr" }}>
                    <div style={{ display: "grid", gap: "6px" }}>
                      <label style={{ fontSize: "12px", color: tone.muted, fontWeight: 700, textTransform: "uppercase" }}>Gender</label>
                      <select
                        value={profileForm.gender}
                        onChange={(e) => setProfileForm({ ...profileForm, gender: e.target.value })}
                        style={selectStyle}
                      >
                        <option value="">Select Gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div style={{ display: "grid", gap: "6px" }}>
                      <label style={{ fontSize: "12px", color: tone.muted, fontWeight: 700, textTransform: "uppercase" }}>Birthdate</label>
                      <input
                        type="date"
                        value={profileForm.birthdate}
                        onChange={(e) => setProfileForm({ ...profileForm, birthdate: e.target.value })}
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                    <button onClick={saveProfile} style={{ ...primaryButtonStyle, flex: 1 }}>Save Changes</button>
                    <button onClick={() => setIsEditingProfile(false)} style={{ ...secondaryButtonStyle, flex: 1 }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
                  {user.photo ? (
                    <img
                      src={user.photo}
                      alt={user.name}
                      referrerPolicy="no-referrer"
                      style={{
                        width: "68px",
                        height: "68px",
                        borderRadius: "50%",
                        objectFit: "cover",
                        filter: "none"
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "68px",
                        height: "68px",
                        borderRadius: "50%",
                        background: tone.soft,
                        border: `1px solid ${tone.line}`,
                        display: "grid",
                        placeItems: "center"
                      }}
                    >
                      <UserIcon />
                    </div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h3 style={{ margin: "0 0 4px" }}>{currentUserRecord?.name || user.name}</h3>
                    <p style={{ margin: 0, color: tone.muted, overflowWrap: "anywhere", wordBreak: "break-word" }}>{user.email}</p>
                    {currentUserRecord?.phone && (
                      <p style={{ margin: "4px 0 0", fontSize: "13px", color: tone.muted }}>{currentUserRecord.phone}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>Account Summary</h3>
              <div style={{ display: "grid", gap: "12px" }}>
                {[
                  `Aura Points: ${formatCurrency(auraPoints)}`,
                  `Gender: ${currentUserRecord?.gender || "Not specified"}`,
                  `Birthdate: ${currentUserRecord?.birthdate || "Not specified"}`,
                  `Wishlist Items: ${wishlist.length}`,
                  `Orders: ${uniqueOrders.filter((order) => doesOrderBelongToUser(order, currentUserRecord || user)).length}`,
                  `Role: ${
                    isAdmin
                      ? "Admin"
                      : isAdminOwner
                        ? "Admin (Locked)"
                        : "Customer"
                  }`
                ].map((item) => (
                  <div
                    key={item}
                    style={{
                      padding: "14px",
                      borderRadius: "14px",
                      border: `1px solid ${tone.line}`,
                      background: tone.soft
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {user && currentUserRecord?.auraHistory && currentUserRecord.auraHistory.length > 0 && (
          <div style={{ marginTop: "32px" }}>
            <h3 style={{ margin: "0 0 16px", letterSpacing: "1px", textTransform: "uppercase", fontSize: "16px", color: tone.muted }}>
              Aura Points History
            </h3>
            <div
              style={{
                border: `1px solid ${tone.line}`,
                borderRadius: "20px",
                overflow: "hidden",
                background: tone.soft
              }}
            >
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr style={{ background: "rgba(0,0,0,0.02)" }}>
                      <th style={{ padding: "16px", borderBottom: `1px solid ${tone.line}`, fontWeight: 800 }}>Date & Time</th>
                      <th style={{ padding: "16px", borderBottom: `1px solid ${tone.line}`, fontWeight: 800 }}>Type</th>
                      <th style={{ padding: "16px", borderBottom: `1px solid ${tone.line}`, fontWeight: 800 }}>Amount</th>
                      <th style={{ padding: "16px", borderBottom: `1px solid ${tone.line}`, fontWeight: 800 }}>Admin</th>
                      <th style={{ padding: "16px", borderBottom: `1px solid ${tone.line}`, fontWeight: 800 }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentUserRecord.auraHistory.map((tra) => (
                      <tr key={tra.id}>
                        <td style={{ padding: "16px", borderBottom: `1px solid ${tone.line}` }}>
                          <span style={{ display: "block", fontSize: "14px" }}>{tra.date}</span>
                          <span style={{ display: "block", fontSize: "12px", color: tone.muted }}>{tra.time}</span>
                        </td>
                        <td style={{ padding: "16px", borderBottom: `1px solid ${tone.line}` }}>
                          <span
                            style={{
                              padding: "4px 10px",
                              borderRadius: "999px",
                              fontSize: "12px",
                              fontWeight: 700,
                              background: tra.type === "Deposit" ? "#e8f5e9" : tra.type === "Adjustment" ? "#fff3e0" : "#ffebee",
                              color: tra.type === "Deposit" ? "#2e7d32" : tra.type === "Adjustment" ? "#ef6c00" : "#c62828",
                              border: `1px solid ${tra.type === "Deposit" ? "#a5d6a7" : tra.type === "Adjustment" ? "#ffcc80" : "#ef9a9a"}`
                            }}
                          >
                            {tra.type}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "16px",
                            borderBottom: `1px solid ${tone.line}`,
                            fontWeight: 800,
                            fontSize: "16px",
                            color: tra.amount >= 0 ? "#2e7d32" : "#c62828"
                          }}
                        >
                          {tra.amount >= 0 ? "+" : ""}{tra.amount}
                        </td>
                        <td style={{ padding: "16px", borderBottom: `1px solid ${tone.line}`, color: tone.muted, fontSize: "14px" }}>
                          {tra.adminName}
                        </td>
                        <td style={{ padding: "16px", borderBottom: `1px solid ${tone.line}`, fontSize: "14px" }}>
                          {tra.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderAdminSecurityGate = () => (
    <div style={shellStyle}>
      {renderBackButton()}
      <div style={{ maxWidth: "760px" }}>
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Admin Security</h2>
          <p style={{ color: tone.muted, lineHeight: 1.8 }}>
            Admin access requires Google sign-in with an authorized email, then the admin password (verified on this device).
          </p>

          {!user && (
            <>
              <p style={{ color: tone.muted }}>
                Login with Google first, then continue with the secured admin flow.
              </p>
              <button onClick={loginWithGoogle} style={primaryButtonStyle}>
                Login with Google
              </button>
            </>
          )}

          {user && !isAdminOwner && (
            <p style={{ margin: 0, color: tone.muted, lineHeight: 1.8 }}>
              This admin panel is reserved for configured administrator accounts.
            </p>
          )}

          {user && isAdminOwner && (
            <div style={{ display: "grid", gap: "14px" }}>
              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  border: `1px solid ${tone.line}`,
                  borderRadius: "18px",
                  padding: "16px",
                  background: tone.soft
                }}
              >
                <p style={{ margin: 0, color: tone.muted }}>
                  Signed in as: {activeAdminEmail || frontendAdminEmail}
                </p>
                <p style={{ margin: 0, color: tone.muted }}>
                  Enter the admin password to unlock this browser session.
                </p>
              </div>

              {adminAuthStep === "loginPassword" && (
                <div style={{ display: "grid", gap: "12px" }}>
                  <h3 style={{ margin: 0 }}>Admin Login</h3>
                  <input
                    value={adminLoginForm.email}
                    readOnly
                    placeholder="Admin email"
                    autoComplete="username email"
                    style={inputStyle}
                  />
                  <input
                    type="password"
                    value={adminLoginForm.password}
                    onChange={(event) => {
                      setAdminSecurityError("");
                      setAdminLoginForm((prev) => ({ ...prev, password: event.target.value }));
                    }}
                    placeholder="Admin password"
                    autoComplete="current-password"
                    style={inputStyle}
                  />
                  {adminSecurityError ? (
                    <p style={{ margin: 0, color: "#c62828", fontSize: "14px" }}>{adminSecurityError}</p>
                  ) : null}
                  <button onClick={submitAdminPassword} style={primaryButtonStyle}>
                    Verify Password
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderAdmin = () => {
    if (!user || !isAdminOwner) {
      return (
        <div style={shellStyle}>
          {renderBackButton()}
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Admin Panel</h2>
            <p style={{ color: tone.muted }}>
              Only configured Google administrator accounts can access the admin panel.
            </p>
            {!user && (
              <button onClick={loginWithGoogle} style={primaryButtonStyle}>
                Login with Google
              </button>
            )}
          </div>
        </div>
      );
    }

    if (!hasAdminAccess) {
      return renderAdminSecurityGate();
    }

    return (
      <div style={shellStyle}>
        {renderBackButton()}
        <div
          className="admin-shell-grid"
        >
          <aside className="admin-panel-card" style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Admin Panel</h2>
            <p style={{ marginTop: 0, color: tone.muted }}>
              Protected by Google login and a shared admin password verified in the browser.
            </p>
            <div style={{ display: "grid", gap: "10px" }}>
              {adminTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setAdminTab(tab.key)}
                  style={{
                    ...secondaryButtonStyle,
                    textAlign: "left",
                    background: adminTab === tab.key ? tone.black : tone.white,
                    color: adminTab === tab.key ? tone.white : tone.body
                  }}
                >
                  {tab.label}
                </button>
              ))}
              <button onClick={endAdminSession} style={secondaryButtonStyle}>
                Lock Admin
              </button>
            </div>
          </aside>

          <section className="admin-panel-card" style={cardStyle}>
            {adminTab === "dashboard" && (
              <>
                <h2 style={{ marginTop: 0 }}>Dashboard</h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "14px"
                  }}
                >
                  {[
                    { label: "Total Users", value: users.length },
                    { label: "Total Sales", value: formatCurrency(totalSales) },
                    { label: "Daily Report", value: formatCurrency(dailySales) },
                    { label: "Weekly Report", value: formatCurrency(weeklySales) },
                    { label: "Monthly Report", value: formatCurrency(monthlySales) },
                    { label: "Total Orders", value: uniqueOrders.length }
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      style={{
                        border: `1px solid ${tone.line}`,
                        borderRadius: "18px",
                        padding: "18px",
                        background: tone.soft
                      }}
                    >
                      <p style={{ margin: "0 0 8px", color: tone.muted }}>{stat.label}</p>
                      <h3 style={{ margin: 0 }}>{stat.value}</h3>
                    </div>
                  ))}
                </div>
              </>
            )}

            {adminTab === "users" && (
              <>
                <h2 style={{ marginTop: 0 }}>User Management</h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(260px, 320px) 1fr",
                    gap: "20px"
                  }}
                >
                  <div style={{ display: "grid", gap: "12px" }}>
                    <input
                      value={userForm.name}
                      onChange={(event) => setUserFormField("name", event.target.value)}
                      placeholder="Full name"
                      style={inputStyle}
                    />
                    <input
                      value={userForm.email}
                      onChange={(event) => setUserFormField("email", event.target.value)}
                      placeholder="Email"
                      style={inputStyle}
                    />
                    <input
                      value={userForm.auraPoints}
                      onChange={(event) => setUserFormField("auraPoints", event.target.value)}
                      placeholder="Initial Aura points"
                      style={inputStyle}
                    />
                    <button onClick={addManualUser} style={primaryButtonStyle}>
                      Add User
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: "12px" }}>
                    {users.map((entry) => (
                      <div
                        key={entry.email}
                        style={{
                          border: `1px solid ${tone.line}`,
                          borderRadius: "18px",
                          padding: "16px"
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "12px",
                            flexWrap: "wrap"
                          }}
                        >
                          <div>
                            <h3 style={{ margin: "0 0 4px" }}>{entry.name}</h3>
                            <p style={{ margin: 0, color: tone.muted }}>
                              {entry.email} | {entry.role} | {entry.status}
                            </p>
                            <p style={{ margin: "6px 0 0" }}>
                              Aura Points: {formatCurrency(Number(entry.auraPoints || 0))}
                            </p>
                          </div>
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            {!ADMIN_EMAILS.includes(entry.email?.toLowerCase()) && (
                              <>
                                <button onClick={() => toggleBlockUser(entry.email)} style={secondaryButtonStyle}>
                                  {entry.status === "blocked" ? "Unblock" : "Block"}
                                </button>
                                <button onClick={() => removeUser(entry.email)} style={secondaryButtonStyle}>
                                  Remove
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop: "16px",
                            padding: "16px",
                            borderRadius: "14px",
                            background: tone.soft,
                            border: `1px solid ${tone.line}`,
                            display: "grid",
                            gap: "12px"
                          }}
                        >
                          <p style={{ margin: 0, fontSize: "12px", color: tone.muted, textTransform: "uppercase", letterSpacing: "1px" }}>
                            Aura Points Management
                          </p>
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            <input
                              placeholder="Amount"
                              style={{ ...inputStyle, width: "100px", background: "#fff" }}
                              value={auraActionForm.targetUserEmail === entry.email ? auraActionForm.amount : ""}
                              onChange={(e) => setAuraActionForm(prev => ({ ...prev, amount: e.target.value, targetUserEmail: entry.email }))}
                            />
                            <input
                              placeholder="Reason (Mandatory)"
                              style={{ ...inputStyle, flex: 1, minWidth: "150px", background: "#fff" }}
                              value={auraActionForm.targetUserEmail === entry.email ? auraActionForm.reason : ""}
                              onChange={(e) => setAuraActionForm(prev => ({ ...prev, reason: e.target.value, targetUserEmail: entry.email }))}
                            />
                          </div>
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            <button
                              onClick={() => updateAuraPoints(entry.email, "Add")}
                              style={{ ...secondaryButtonStyle, background: "#e8f5e9", color: "#2e7d32", border: "1px solid #a5d6a7" }}
                            >
                              Add Points
                            </button>
                            <button
                              onClick={() => updateAuraPoints(entry.email, "Deduct")}
                              style={{ ...secondaryButtonStyle, background: "#ffebee", color: "#c62828", border: "1px solid #ef9a9a" }}
                            >
                              Deduct Points
                            </button>
                            <button
                              onClick={() => updateAuraPoints(entry.email, "Edit")}
                              style={{ ...secondaryButtonStyle, background: "#fff3e0", color: "#ef6c00", border: "1px solid #ffcc80" }}
                            >
                              Set Balance
                            </button>
                          </div>
                        </div>

                        {entry.auraHistory && entry.auraHistory.length > 0 && (
                          <div style={{ marginTop: "16px" }}>
                            <p style={{ margin: "0 0 10px", fontSize: "12px", color: tone.muted, textTransform: "uppercase", letterSpacing: "1px" }}>
                              Transaction History
                            </p>
                            <div style={{ maxHeight: "200px", overflowY: "auto", border: `1px solid ${tone.line}`, borderRadius: "12px" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                                <thead style={{ position: "sticky", top: 0, background: tone.soft, textAlign: "left" }}>
                                  <tr>
                                    <th style={{ padding: "10px", borderBottom: `1px solid ${tone.line}` }}>Date</th>
                                    <th style={{ padding: "10px", borderBottom: `1px solid ${tone.line}` }}>Amount</th>
                                    <th style={{ padding: "10px", borderBottom: `1px solid ${tone.line}` }}>Type</th>
                                    <th style={{ padding: "10px", borderBottom: `1px solid ${tone.line}` }}>Reason</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entry.auraHistory.map((tra) => (
                                    <tr key={tra.id}>
                                      <td style={{ padding: "10px", borderBottom: `1px solid ${tone.line}` }}>{tra.date}</td>
                                      <td style={{ padding: "10px", borderBottom: `1px solid ${tone.line}`, color: tra.amount >= 0 ? "#2e7d32" : "#c62828", fontWeight: 700 }}>
                                        {tra.amount >= 0 ? "+" : ""}{tra.amount}
                                      </td>
                                      <td style={{ padding: "10px", borderBottom: `1px solid ${tone.line}` }}>{tra.type}</td>
                                      <td style={{ padding: "10px", borderBottom: `1px solid ${tone.line}`, color: tone.muted }}>{tra.reason}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {adminTab === "products" && (
              <>
                <h2 style={{ marginTop: 0 }}>Product Management</h2>
                <div
                  className="admin-split-grid"
                >
                  <div className="admin-stack">
                    <input value={productForm.name} onChange={(event) => setProductFormField("name", event.target.value)} placeholder="Product name" style={inputStyle} />
                    <select
                      value={productForm.department}
                      onChange={(event) => {
                        const nextDepartment = event.target.value;
                        setProductForm((prev) => ({
                          ...prev,
                          department: nextDepartment,
                          category:
                            nextDepartment === "tshirts"
                              ? managedTshirtCategories[0] || DEFAULT_TSHIRT_CATEGORIES[0]
                              : prev.category === "General"
                                ? prev.category
                                : "General"
                        }));
                      }}
                      style={selectStyle}
                    >
                      {departmentOptions.map((department) => (
                        <option key={department.value} value={department.value}>
                          {department.label}
                        </option>
                      ))}
                    </select>
                    {productForm.department === "tshirts" ? (
                      <select value={productForm.category} onChange={(event) => setProductFormField("category", event.target.value)} style={selectStyle}>
                        {availableProductCategories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={productForm.category}
                        onChange={(event) => setProductFormField("category", event.target.value)}
                        placeholder="Category"
                        style={inputStyle}
                      />
                    )}
                    <textarea value={productForm.description} onChange={(event) => setProductFormField("description", event.target.value)} placeholder="Description" style={textareaStyle} />
                    <input value={productForm.colors} onChange={(event) => setProductFormField("colors", event.target.value)} placeholder="Colours: Black, White" style={inputStyle} />
                    <input value={productForm.sizes} onChange={(event) => setProductFormField("sizes", event.target.value)} placeholder="Sizes: S, M, L, XL" style={inputStyle} />
                    <div className="admin-three-field-grid">
                      <input value={productForm.price} onChange={(event) => setProductFormField("price", event.target.value)} placeholder="Price" style={inputStyle} />
                      <input value={productForm.discount} onChange={(event) => setProductFormField("discount", event.target.value)} placeholder="Discount" style={inputStyle} />
                      <input value={productForm.stock} onChange={(event) => setProductFormField("stock", event.target.value)} placeholder="Stock" style={inputStyle} />
                    </div>
                    <select value={productForm.availability} onChange={(event) => setProductFormField("availability", event.target.value)} style={selectStyle}>
                      <option value={PRODUCT_AVAILABILITY.IN_STOCK}>In Stock</option>
                      <option value={PRODUCT_AVAILABILITY.OUT_OF_STOCK}>Out of Stock</option>
                      <option value={PRODUCT_AVAILABILITY.COMING_SOON}>Coming Soon</option>
                    </select>
                    <input value={productForm.badge} onChange={(event) => setProductFormField("badge", event.target.value)} placeholder="Badge" style={inputStyle} />
                    <div
                      style={{
                        border: `1px solid ${tone.line}`,
                        borderRadius: "18px",
                        padding: "16px",
                        background: tone.soft,
                        display: "grid",
                        gap: "14px"
                      }}
                    >
                      <div>
                        <h3 style={{ margin: "0 0 6px" }}>Product Media</h3>
                        <p style={{ margin: 0, color: tone.muted }}>
                          Upload up to 6 square-ready images and 1 product video. The first image is used as the product cover.
                        </p>
                      </div>

                      <label style={{ display: "grid", gap: "8px", color: tone.muted }}>
                        Add product images
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) =>
                            handleImageUpload(
                              event,
                              (uploads) => addProductImages(uploads),
                              {
                                multiple: true,
                                successMessage: "Product images uploaded.",
                                failureMessage: "Product image upload failed."
                              }
                            )
                          }
                        />
                      </label>

                      <div className="admin-media-grid">
                        {productFormImages.map((image, index) => (
                          <div
                            key={`${image.slice(0, 30)}-${index}`}
                            style={{
                              border: `1px solid ${tone.line}`,
                              borderRadius: "16px",
                              padding: "10px",
                              background: tone.white,
                              display: "grid",
                              gap: "10px"
                            }}
                          >
                            <div
                              style={{
                                width: "100%",
                                minHeight: "120px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "transparent"
                              }}
                            >
                              <img
                                src={image}
                                alt={`Product ${index + 1}`}
                                style={{
                                  width: "auto",
                                  height: "auto",
                                  maxWidth: "100%",
                                  maxHeight: "160px",
                                  display: "block"
                                }}
                              />
                            </div>
                            <p style={{ margin: 0, fontSize: "12px", color: tone.muted }}>
                              Image {index + 1}{index === 0 ? " | cover" : ""}
                            </p>
                            <label style={{ display: "grid", gap: "6px", color: tone.muted, fontSize: "12px" }}>
                              Replace
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(event) =>
                                  handleImageUpload(
                                    event,
                                    (upload) => replaceProductImageAt(index, upload),
                                    {
                                      successMessage: "Product image replaced.",
                                      failureMessage: "Product image replace failed."
                                    }
                                  )
                                }
                              />
                            </label>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                              <button
                                onClick={() => moveProductImage(index, "left")}
                                style={secondaryButtonStyle}
                                disabled={index === 0}
                              >
                                Left
                              </button>
                              <button
                                onClick={() => moveProductImage(index, "right")}
                                style={secondaryButtonStyle}
                                disabled={index === productFormImages.length - 1}
                              >
                                Right
                              </button>
                              <button onClick={() => removeProductImageAt(index)} style={secondaryButtonStyle}>
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}

                        {productFormImages.length === 0 && (
                          <div
                            style={{
                              border: `1px dashed ${tone.border}`,
                              borderRadius: "16px",
                              padding: "16px",
                              color: tone.muted,
                              background: tone.white
                            }}
                          >
                            No images uploaded yet.
                          </div>
                        )}
                      </div>

                      <label style={{ display: "grid", gap: "8px", color: tone.muted }}>
                        Upload or replace product video
                        <input
                          type="file"
                          accept="video/mp4,video/*"
                          onChange={(event) =>
                            handleImageUpload(
                              event,
                              (upload) => setProductVideo(upload),
                              {
                                successMessage: "Product video uploaded.",
                                failureMessage: "Product video upload failed."
                              }
                            )
                          }
                        />
                      </label>

                      <div
                        style={{
                          border: `1px solid ${tone.line}`,
                          borderRadius: "16px",
                          padding: "12px",
                          background: tone.white,
                          display: "grid",
                          gap: "10px"
                        }}
                      >
                        <p style={{ margin: 0, color: tone.muted, fontSize: "12px" }}>
                          Product Video
                        </p>
                        {productFormVideo ? (
                          <>
                            <div
                              style={{
                                width: "100%",
                                aspectRatio: "1 / 1",
                                overflow: "hidden",
                                borderRadius: "12px",
                                background: tone.black
                              }}
                            >
                              <video
                                src={productFormVideo}
                                controls
                                playsInline
                                preload="metadata"
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover"
                                }}
                              />
                            </div>
                            <button onClick={() => setProductVideo("")} style={secondaryButtonStyle}>
                              Delete Video
                            </button>
                          </>
                        ) : (
                          <p style={{ margin: 0, color: tone.muted }}>
                            No product video uploaded.
                          </p>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                      <button onClick={saveProduct} style={primaryButtonStyle}>
                        {productForm.id ? "Update Product" : "Add Product"}
                      </button>
                      <button
                        onClick={() => setProductForm(buildEmptyProductForm())}
                        style={secondaryButtonStyle}
                      >
                        Clear
                      </button>
                    </div>

                    <div
                      style={{
                        border: `1px solid ${tone.line}`,
                        borderRadius: "18px",
                        padding: "16px",
                        background: tone.soft,
                        display: "grid",
                        gap: "12px"
                      }}
                      >
                        <div>
                          <h3 style={{ margin: "0 0 6px" }}>Manage Product Sections</h3>
                          <p style={{ margin: 0, color: tone.muted }}>
                            Add a future section here and it will appear beside T-Shirts in the top navigation.
                          </p>
                        </div>
                        <div className="admin-input-action-grid">
                          <input
                            value={departmentDraft}
                            onChange={(event) => setDepartmentDraft(event.target.value)}
                            placeholder="Add section"
                            style={inputStyle}
                          />
                          <button onClick={addProductDepartment} style={secondaryButtonStyle}>
                            Add
                          </button>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                          {managedProductDepartments.map((department) => (
                            <div
                              key={department}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                                padding: "10px 12px",
                                borderRadius: "999px",
                                border: `1px solid ${tone.border}`,
                                background: tone.white
                              }}
                            >
                              <span>{formatDepartmentLabel(department)}</span>
                              <button
                                onClick={() => removeProductDepartment(department)}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: tone.muted,
                                  cursor: "pointer",
                                  fontWeight: 700
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                    <div
                      style={{
                        border: `1px solid ${tone.line}`,
                        borderRadius: "18px",
                        padding: "16px",
                        background: tone.soft,
                        display: "grid",
                        gap: "12px"
                      }}
                    >
                      <div>
                          <h3 style={{ margin: "0 0 6px" }}>Manage T-Shirt Categories</h3>
                          <p style={{ margin: 0, color: tone.muted }}>
                            These options control the T-shirt menu and product category list.
                          </p>
                      </div>
                      <div className="admin-input-action-grid">
                        <input
                          value={categoryDraft}
                          onChange={(event) => setCategoryDraft(event.target.value)}
                          placeholder="Add category"
                          style={inputStyle}
                        />
                        <button onClick={addTshirtCategory} style={secondaryButtonStyle}>
                          Add
                        </button>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                        {managedTshirtCategories.map((category) => (
                          <div
                            key={category}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              padding: "10px 12px",
                              borderRadius: "999px",
                              border: `1px solid ${tone.border}`,
                              background: tone.white
                            }}
                          >
                            <span>{category}</span>
                            <button
                              onClick={() => removeTshirtCategory(category)}
                              style={{
                                border: "none",
                                background: "transparent",
                                color: tone.muted,
                                cursor: "pointer",
                                fontWeight: 700
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="admin-stack">
                    {products.map((product) => (
                      <div
                        key={product.id}
                        style={{
                          border: `1px solid ${tone.line}`,
                          borderRadius: "18px",
                          padding: "16px"
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "12px",
                            flexWrap: "wrap"
                          }}
                        >
                          <div>
                            <h3 style={{ margin: "0 0 4px" }}>{product.name}</h3>
                            <p style={{ margin: 0, color: tone.muted }}>
                              {product.department} | {product.category}
                            </p>
                            <p style={{ margin: "6px 0 0" }}>
                              {formatCurrency(discountPrice(product))} | Stock {product.stock}
                            </p>
                            <p style={{ margin: "6px 0 0", color: tone.muted, fontSize: "13px" }}>
                              Media: {getProductImages(product).length} image{getProductImages(product).length === 1 ? "" : "s"}
                              {getProductVideo(product) ? " | 1 video" : ""}
                            </p>
                          </div>
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            <button onClick={() => editProduct(product)} style={secondaryButtonStyle}>
                              Edit
                            </button>
                            <button onClick={() => deleteProduct(product.id)} style={secondaryButtonStyle}>
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {adminTab === "orders" && (
              <>
                <h2 style={{ marginTop: 0 }}>Order Management</h2>
                <div style={{ marginBottom: "18px" }}>
                  <input
                    value={adminOrdersSearch}
                    onChange={(event) => setAdminOrdersSearch(event.target.value)}
                    placeholder="Search by Order ID, Customer Name, or Phone Number"
                    style={inputStyle}
                  />
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(260px, 340px) 1fr",
                    gap: "20px"
                  }}
                >
                  <div style={{ display: "grid", gap: "12px" }}>
                    {filteredAdminOrders.map((order) => (
                      <button
                        key={order.id}
                        onClick={() => setSelectedAdminOrderId(order.id)}
                        style={{
                          ...secondaryButtonStyle,
                          textAlign: "left",
                          background:
                            selectedAdminOrder?.id === order.id ? tone.black : tone.white,
                          color:
                            selectedAdminOrder?.id === order.id ? tone.white : tone.body
                        }}
                      >
                        {order.id}
                        <br />
                        <span style={{ fontSize: "12px", opacity: 0.8 }}>{order.status}</span>
                      </button>
                    ))}
                  </div>

                  <div>
                    {selectedAdminOrder ? (
                      <div
                        style={{
                          border: `1px solid ${tone.line}`,
                          borderRadius: "18px",
                          padding: "18px"
                        }}
                      >
                        <h3 style={{ marginTop: 0 }}>{selectedAdminOrder.id}</h3>
                        <div style={{ display: "grid", gap: "12px", marginBottom: "18px" }}>
                          <p style={{ margin: 0, color: tone.muted }}>
                            Created: {selectedAdminOrder.dateLabel}
                          </p>
                          {selectedAdminOrder.deliveredAtLabel && (
                            <p style={{ margin: 0, color: tone.muted }}>
                              Delivered: {selectedAdminOrder.deliveredAtLabel}
                            </p>
                          )}
                          <p style={{ margin: 0, color: tone.muted }}>
                            Customer: <strong>{selectedAdminOrder.customer.name}</strong> ({selectedAdminOrder.customer.phone})
                          </p>
                          <p style={{ margin: 0, color: tone.muted }}>
                            Address: {selectedAdminOrder.customer.address}, {selectedAdminOrder.customer.city} {selectedAdminOrder.customer.pincode}
                          </p>
                          {selectedAdminOrder.returnRequested && (
                            <p style={{ margin: 0, color: tone.muted }}>
                              Return Status: <strong>{selectedAdminOrder.returnRequestStatus || "Pending"}</strong>
                            </p>
                          )}
                        </div>

                        {selectedAdminOrder.paymentMethod === "upi" && (
                          <div
                            style={{
                              border: `1px solid ${tone.line}`,
                              borderRadius: "16px",
                              padding: "16px",
                              marginBottom: "18px",
                              background: tone.soft
                            }}
                          >
                            <h4 style={{ marginTop: 0, marginBottom: "10px" }}>Payment Details (UPI)</h4>
                            <div style={{ display: "grid", gap: "8px", fontSize: "14px" }}>
                              <p style={{ margin: 0 }}>
                                <span style={{ color: tone.muted }}>UPI Customer Name:</span>{" "}
                                <strong>{selectedAdminOrder.customer.customerName}</strong>
                              </p>
                              <p style={{ margin: 0 }}>
                                <span style={{ color: tone.muted }}>Transaction ID / UTR:</span>{" "}
                                <strong style={{ color: "#d32f2f" }}>{selectedAdminOrder.customer.transactionId}</strong>
                              </p>
                              <p style={{ margin: 0 }}>
                                <span style={{ color: tone.muted }}>Submission Date:</span>{" "}
                                {selectedAdminOrder.paymentSubmittedLabel}
                              </p>
                              {selectedAdminOrder.customer.paymentScreenshot && (
                                <div style={{ marginTop: "10px" }}>
                                  <p style={{ margin: "0 0 6px", color: tone.muted }}>Screenshot:</p>
                                  <a
                                    href={resolveCloudinaryMediaUrl(
                                      selectedAdminOrder.customer.paymentScreenshot
                                    )}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <img
                                      src={resolveCloudinaryMediaUrl(
                                        selectedAdminOrder.customer.paymentScreenshot
                                      )}
                                      alt="Payment Proof"
                                      style={{
                                        maxWidth: "200px",
                                        maxHeight: "300px",
                                        borderRadius: "8px",
                                        border: `1px solid ${tone.line}`,
                                        display: "block"
                                      }}
                                    />
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <div style={{ display: "grid", gap: "10px", marginTop: "14px" }}>
                          {selectedAdminOrder.items.map((item) => (
                            <div
                              key={item.cartId}
                              style={{
                                padding: "12px",
                                borderRadius: "14px",
                                background: tone.soft
                              }}
                            >
                              {item.name} | {item.size} | {item.color} | Qty {item.quantity}
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: "16px", borderTop: `1px solid ${tone.line}`, paddingTop: "16px" }}>
                          <p style={{ margin: "0 0 6px", display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: tone.muted }}>Items Total:</span>
                            <span>{formatCurrency(selectedAdminOrder.total)}</span>
                          </p>
                          {selectedAdminOrder.auraPointsUsed > 0 && (
                            <p style={{ margin: "0 0 6px", display: "flex", justifyContent: "space-between", color: "#2e7d32" }}>
                              <span>Aura Points Used:</span>
                              <span>-{formatCurrency(selectedAdminOrder.auraPointsUsed)}</span>
                            </p>
                          )}
                          <p style={{ margin: 0, display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "18px" }}>
                            <span>{selectedAdminOrder.remainingPayable > 0 ? "Payable via UPI:" : "Final Total:"}</span>
                            <span>{formatCurrency(selectedAdminOrder.remainingPayable ?? selectedAdminOrder.total)}</span>
                          </p>
                        </div>
                        
                        <div style={{ display: "grid", gap: "10px", marginTop: "20px" }}>
                          <p style={{ margin: 0, color: tone.muted, fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px" }}>
                            Quick Payment Actions
                          </p>
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            <button
                              onClick={() => updateOrderStatus(selectedAdminOrder.id, "Paid")}
                              style={{ ...secondaryButtonStyle, background: "#4caf50", color: "#fff", border: "none" }}
                            >
                              Mark as Paid
                            </button>
                            <button
                              onClick={() => updateOrderStatus(selectedAdminOrder.id, "Rejected")}
                              style={{ ...secondaryButtonStyle, background: "#f44336", color: "#fff", border: "none" }}
                            >
                              Mark as Rejected
                            </button>
                            <button
                              onClick={() => updateOrderStatus(selectedAdminOrder.id, "Unpaid")}
                              style={{ ...secondaryButtonStyle, background: "#ff9800", color: "#fff", border: "none" }}
                            >
                              Mark as Unpaid
                            </button>
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: "10px", marginTop: "20px" }}>
                          <p style={{ margin: 0, color: tone.muted, fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px" }}>
                            Order Lifecycle
                          </p>
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            {[
                              "New",
                              "Processing",
                              "Shipped",
                              "Delivered",
                              "Return Requested",
                              "Refunded"
                            ].map((status) => (
                              <button
                                key={status}
                                onClick={() => updateOrderStatus(selectedAdminOrder.id, status)}
                                style={secondaryButtonStyle}
                              >
                                {status}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p style={{ color: tone.muted }}>No orders available.</p>
                    )}
                  </div>
                </div>
              </>
            )}

            {adminTab === "returns" && (
              <>
                <h2 style={{ marginTop: 0 }}>Returns</h2>
                <div style={{ marginBottom: "18px" }}>
                  <input
                    value={adminReturnsSearch}
                    onChange={(event) => setAdminReturnsSearch(event.target.value)}
                    placeholder="Search by Order ID, Customer Name, or Phone Number"
                    style={inputStyle}
                  />
                </div>
                {filteredReturnOrders.length === 0 ? (
                  <p style={{ margin: 0, color: tone.muted }}>No return requests found.</p>
                ) : (
                  <div style={{ display: "grid", gap: "16px" }}>
                    {filteredReturnOrders.map((order) => (
                      <div
                        key={order.id}
                        style={{
                          border: `1px solid ${tone.line}`,
                          borderRadius: "18px",
                          padding: "18px",
                          display: "grid",
                          gap: "12px"
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "12px",
                            flexWrap: "wrap"
                          }}
                        >
                          <div>
                            <h3 style={{ margin: "0 0 6px" }}>{order.id}</h3>
                            <p style={{ margin: 0, color: tone.muted }}>
                              Customer: <strong>{order.returnRequest?.name || order.customer.name}</strong>
                            </p>
                          </div>
                          <span
                            style={{
                              padding: "8px 12px",
                              borderRadius: "999px",
                              border: `1px solid ${tone.line}`,
                              background: tone.soft,
                              fontWeight: 700
                            }}
                          >
                            {order.returnRequestStatus || "Pending"}
                          </span>
                        </div>

                        <div style={{ display: "grid", gap: "8px" }}>
                          <p style={{ margin: 0, color: tone.muted }}>
                            Phone Number: {order.returnRequest?.phone || order.customer.phone}
                          </p>
                          <p style={{ margin: 0, color: tone.muted }}>
                            Reason: {order.returnRequest?.reason || "Not provided"}
                          </p>
                          <p style={{ margin: 0, color: tone.muted }}>
                            Request Date/Time: {order.returnRequest?.requestedAtLabel || "Not available"}
                          </p>
                          <p style={{ margin: 0, color: tone.muted }}>
                            Delivery Date: {order.deliveredAtLabel || "Not available"}
                          </p>
                        </div>

                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          <button
                            onClick={() => updateReturnRequestStatus(order.id, "Approved")}
                            style={{ ...secondaryButtonStyle, background: "#e8f5e9", color: "#2e7d32", border: "1px solid #a5d6a7" }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => updateReturnRequestStatus(order.id, "Rejected")}
                            style={{ ...secondaryButtonStyle, background: "#ffebee", color: "#c62828", border: "1px solid #ef9a9a" }}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {adminTab === "content" && (
              <>
                <h2 style={{ marginTop: 0 }}>Website Content Management</h2>
                <div
                  className="admin-split-grid"
                >
                  <div className="admin-stack">
                    <div style={{ display: "grid", gap: "6px" }}>
                      <h3 style={{ margin: 0 }}>Homepage Carousel</h3>
                      <p style={{ margin: 0, color: tone.muted }}>
                        Upload up to {MAX_HOME_BANNERS} banners in any mix of images and videos. The homepage follows the order shown on the right.
                      </p>
                    </div>
                    <input value={bannerForm.title} onChange={(event) => setBannerFormField("title", event.target.value)} placeholder="Banner label" style={inputStyle} />
                    <input value={bannerForm.subtitle} onChange={(event) => setBannerFormField("subtitle", event.target.value)} placeholder="Internal note" style={inputStyle} />
                    <textarea value={bannerForm.description} onChange={(event) => setBannerFormField("description", event.target.value)} placeholder="Description" style={textareaStyle} />
                    <select
                      value={bannerForm.linkedProductId}
                      onChange={(event) => setBannerFormField("linkedProductId", event.target.value)}
                      style={selectStyle}
                    >
                      <option value="">No Shop Now product linked</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} | {product.category}
                        </option>
                      ))}
                    </select>
                    <p style={{ margin: 0, color: tone.muted, fontSize: "13px" }}>
                      {bannerForm.linkedProductId
                        ? `Shop Now will open ${
                            products.find((product) => product.id === bannerForm.linkedProductId)?.name ||
                            "the selected product"
                          }.`
                        : "Link a product here to show a Shop Now button on the banner."}
                    </p>
                    <label style={{ display: "grid", gap: "8px", color: tone.muted }}>
                      Upload banner image or video
                      <input
                        type="file"
                        accept="image/*,video/*"
                        onChange={(event) =>
                          handleImageUpload(
                            event,
                            async (dataUrl, file) => {
                              const nextMediaType = getFileMediaType(file) || bannerForm.mediaType;
                              const nextMediaSource = resolveCloudinaryMediaUrl(dataUrl);
                              const nextAspectRatio = await getMediaAspectRatio(
                                nextMediaSource,
                                nextMediaType
                              );

                              setBannerForm((prev) => ({
                                ...prev,
                                mediaType: nextMediaType,
                                mediaData: nextMediaSource,
                                aspectRatio: nextAspectRatio
                              }));
                            },
                            {
                              successMessage: "Banner media uploaded.",
                              validateFiles: (files) => {
                                if (files.length !== 1) {
                                  return "Upload one banner item at a time.";
                                }

                                return getFileMediaType(files[0])
                                  ? ""
                                  : "Upload an image or video banner.";
                              },
                              failureMessage: "Banner media upload failed."
                            }
                          )
                        }
                      />
                    </label>
                    <p style={{ margin: 0, color: tone.muted, fontSize: "13px" }}>
                      {bannerForm.mediaData
                        ? `${bannerForm.mediaType === "video" ? "Video" : "Image"} ready for preview.`
                        : "No custom media selected. The default brand video is used as a fallback preview."}
                    </p>
                    <div
                      style={{
                        border: `1px solid ${tone.line}`,
                        borderRadius: "18px",
                        padding: "14px",
                        background: tone.soft,
                        display: "grid",
                        gap: "10px"
                      }}
                    >
                      <p style={{ margin: 0, color: tone.muted, fontSize: "12px", letterSpacing: "2px", textTransform: "uppercase" }}>
                        Banner Preview
                      </p>
                      <div
                        style={{
                          width: "100%",
                          aspectRatio: `${normalizeAspectRatio(
                            bannerForm.aspectRatio,
                            DEFAULT_BANNER_ASPECT_RATIO
                          )}`,
                          overflow: "hidden",
                          borderRadius: "16px",
                          background: tone.black
                        }}
                      >
                        {getBannerMediaType(bannerForm) === "video" ? (
                          <video
                            key={`banner-form-video-${getBannerMediaSource(bannerForm)}`}
                            src={getBannerMediaSource(bannerForm)}
                            autoPlay
                            loop
                            muted
                            playsInline
                            preload="metadata"
                            controls={Boolean(bannerForm.mediaData)}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover"
                            }}
                          />
                        ) : (
                          <img
                            key={`banner-form-image-${getBannerMediaSource(bannerForm)}`}
                            src={getBannerMediaSource(bannerForm)}
                            alt={bannerForm.title || "Homepage banner preview"}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover"
                            }}
                          />
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        <button
                          onClick={saveBanner}
                          style={primaryButtonStyle}
                          disabled={!bannerForm.id && managedHomepageBanners.length >= MAX_HOME_BANNERS}
                        >
                          {bannerForm.id ? "Update Banner" : "Add Banner"}
                        </button>
                        <button onClick={() => setBannerForm(buildEmptyBannerForm())} style={secondaryButtonStyle}>
                          Clear Banner Form
                        </button>
                        <button
                          onClick={() =>
                            setBannerForm((prev) => ({
                              ...prev,
                              mediaData: "",
                              aspectRatio: DEFAULT_BANNER_ASPECT_RATIO
                            }))
                          }
                          style={secondaryButtonStyle}
                        >
                          Remove Uploaded Media
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        border: `1px solid ${tone.line}`,
                        borderRadius: "18px",
                        padding: "16px",
                        display: "grid",
                        gap: "12px",
                        background: tone.white
                      }}
                    >
                      <div style={{ display: "grid", gap: "6px" }}>
                        <h3 style={{ margin: 0 }}>Homepage Feature Strip</h3>
                        <p style={{ margin: 0, color: tone.muted }}>
                          Add, remove, or replace the horizontal feature options shown below the banner.
                        </p>
                      </div>

                      <input
                        value={highlightForm.title}
                        onChange={(event) => setHighlightFormField("title", event.target.value)}
                        placeholder="Feature label"
                        style={inputStyle}
                      />
                      <input
                        value={highlightForm.description}
                        onChange={(event) =>
                          setHighlightFormField("description", event.target.value)
                        }
                        placeholder="Optional note"
                        style={inputStyle}
                      />
                      <input
                        value={highlightForm.badge}
                        onChange={(event) => setHighlightFormField("badge", event.target.value)}
                        placeholder="Badge text (optional, e.g. New)"
                        style={inputStyle}
                      />
                      <select
                        value={highlightForm.iconKey}
                        onChange={(event) => setHighlightFormField("iconKey", event.target.value)}
                        style={selectStyle}
                      >
                        {HOME_HIGHLIGHT_ICON_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        <button onClick={saveHomeHighlight} style={primaryButtonStyle}>
                          {highlightForm.id ? "Update Feature" : "Add Feature"}
                        </button>
                        <button
                          onClick={() => setHighlightForm(buildEmptyHighlightForm())}
                          style={secondaryButtonStyle}
                        >
                          Clear Feature Form
                        </button>
                      </div>
                    </div>

                    <input value={offerForm.text} onChange={(event) => setOfferForm((prev) => ({ ...prev, text: event.target.value }))} placeholder="Offer text" style={inputStyle} />
                    <button onClick={saveOffer} style={primaryButtonStyle}>
                      {offerForm.id ? "Update Offer" : "Add Offer"}
                    </button>

                    <div
                      style={{
                        border: `1px solid ${tone.line}`,
                        borderRadius: "18px",
                        padding: "16px",
                        background: tone.white,
                        display: "grid",
                        gap: "12px"
                      }}
                    >
                      <div style={{ display: "grid", gap: "6px" }}>
                        <h3 style={{ margin: 0 }}>Store Policies</h3>
                        <p style={{ margin: 0, color: tone.muted }}>
                          Only logged-in admin accounts can edit these footer pages.
                        </p>
                      </div>

                      <label style={{ display: "grid", gap: "8px", color: tone.muted }}>
                        Terms & Conditions
                        <textarea
                          value={policyForm.termsAndConditions}
                          onChange={(event) =>
                            setPolicyForm((prev) => ({
                              ...prev,
                              termsAndConditions: event.target.value
                            }))
                          }
                          style={{ ...textareaStyle, minHeight: "340px" }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: "8px", color: tone.muted }}>
                        Privacy Policy
                        <textarea
                          value={policyForm.privacyPolicy}
                          onChange={(event) =>
                            setPolicyForm((prev) => ({
                              ...prev,
                              privacyPolicy: event.target.value
                            }))
                          }
                          style={{ ...textareaStyle, minHeight: "180px" }}
                        />
                      </label>

                      <label style={{ display: "grid", gap: "8px", color: tone.muted }}>
                        Contact Us Email
                        <input
                          value={policyForm.contactEmail}
                          onChange={(event) =>
                            setPolicyForm((prev) => ({
                              ...prev,
                              contactEmail: event.target.value
                            }))
                          }
                          placeholder="support@example.com"
                          style={inputStyle}
                        />
                      </label>

                      <label style={{ display: "grid", gap: "8px", color: tone.muted }}>
                        About Us
                        <textarea
                          value={policyForm.aboutUs}
                          onChange={(event) =>
                            setPolicyForm((prev) => ({
                              ...prev,
                              aboutUs: event.target.value
                            }))
                          }
                          style={{ ...textareaStyle, minHeight: "180px" }}
                        />
                      </label>

                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        <button onClick={saveStorePolicies} style={primaryButtonStyle}>
                          Save Policies
                        </button>
                        <button onClick={resetPolicyForm} style={secondaryButtonStyle}>
                          Reset Draft
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="admin-stack admin-stack--wide">
                    <div>
                      <h3 style={{ marginTop: 0 }}>
                        Homepage Banners ({managedHomepageBanners.length}/{MAX_HOME_BANNERS})
                      </h3>
                      <div style={{ display: "grid", gap: "12px" }}>
                        {managedHomepageBanners.map((banner, index) => (
                          <div
                            key={banner.id}
                            style={{
                              border: `1px solid ${tone.line}`,
                              borderRadius: "18px",
                              padding: "16px"
                            }}
                          >
                            <div
                              style={{
                                width: "100%",
                                aspectRatio: `${normalizeAspectRatio(
                                  banner.aspectRatio,
                                  DEFAULT_BANNER_ASPECT_RATIO
                                )}`,
                                overflow: "hidden",
                                borderRadius: "14px",
                                background: tone.black,
                                marginBottom: "12px"
                              }}
                            >
                              {getBannerMediaType(banner) === "video" ? (
                                <video
                                  key={`saved-banner-video-${banner.id}-${getBannerMediaSource(banner)}`}
                                  src={getBannerMediaSource(banner)}
                                  autoPlay
                                  loop
                                  muted
                                  playsInline
                                  preload="metadata"
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover"
                                  }}
                                />
                              ) : (
                                <img
                                  key={`saved-banner-image-${banner.id}-${getBannerMediaSource(banner)}`}
                                  src={getBannerMediaSource(banner)}
                                  alt={banner.title}
                                  decoding="async"
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover"
                                  }}
                                />
                              )}
                            </div>
                            <p style={{ margin: "0 0 8px", color: tone.muted, fontSize: "12px", letterSpacing: "2px", textTransform: "uppercase" }}>
                              Banner {index + 1}
                            </p>
                            <h4 style={{ margin: "0 0 6px" }}>{banner.title}</h4>
                            <p style={{ margin: "0 0 6px", color: tone.muted }}>
                              {getBannerMediaType(banner) === "video" ? "Video banner" : "Image banner"}
                              {banner.subtitle ? ` | ${banner.subtitle}` : ""}
                            </p>
                            <p style={{ margin: 0, color: tone.muted }}>{banner.description}</p>
                            <p style={{ margin: "8px 0 0", color: tone.muted, fontSize: "13px" }}>
                              Shop Now:
                              {" "}
                              {products.find((product) => product.id === banner.linkedProductId)?.name ||
                                "No linked product"}
                            </p>
                            <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
                              <button
                                onClick={() => moveBanner(banner.id, "left")}
                                style={secondaryButtonStyle}
                                disabled={index === 0}
                              >
                                Left
                              </button>
                              <button
                                onClick={() => moveBanner(banner.id, "right")}
                                style={secondaryButtonStyle}
                                disabled={index === managedHomepageBanners.length - 1}
                              >
                                Right
                              </button>
                              <button onClick={() => editBanner(banner)} style={secondaryButtonStyle}>
                                Edit
                              </button>
                              <button onClick={() => removeBanner(banner.id)} style={secondaryButtonStyle}>
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                        {managedHomepageBanners.length === 0 && (
                          <p style={{ margin: 0, color: tone.muted }}>
                            No homepage banners uploaded yet. The storefront will fall back to the default brand video.
                          </p>
                        )}
                      </div>
                    </div>

                    <div style={{ marginTop: "28px" }}>
                      <h3 style={{ marginTop: 0 }}>
                        Homepage Feature Strip ({managedHomeHighlights.length}/{MAX_HOME_HIGHLIGHTS})
                      </h3>
                      <div style={{ display: "grid", gap: "12px" }}>
                        {managedHomeHighlights.map((highlight, index) => (
                          <div
                            key={highlight.id}
                            style={{
                              border: `1px solid ${tone.line}`,
                              borderRadius: "18px",
                              padding: "16px"
                            }}
                          >
                            <p style={{ margin: "0 0 8px", color: tone.muted, fontSize: "12px", letterSpacing: "2px", textTransform: "uppercase" }}>
                              Feature {index + 1}
                            </p>
                            <h4 style={{ margin: "0 0 6px" }}>{highlight.title}</h4>
                            <p style={{ margin: "0 0 6px", color: tone.muted }}>
                              Icon: {HOME_HIGHLIGHT_ICON_OPTIONS.find((option) => option.value === highlight.iconKey)?.label || "Quality Seal"}
                              {highlight.badge ? ` | Badge: ${highlight.badge}` : ""}
                            </p>
                            {highlight.description ? (
                              <p style={{ margin: 0, color: tone.muted }}>{highlight.description}</p>
                            ) : null}
                            <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
                              <button
                                onClick={() => moveHomeHighlight(highlight.id, "left")}
                                style={secondaryButtonStyle}
                                disabled={index === 0}
                              >
                                Left
                              </button>
                              <button
                                onClick={() => moveHomeHighlight(highlight.id, "right")}
                                style={secondaryButtonStyle}
                                disabled={index === managedHomeHighlights.length - 1}
                              >
                                Right
                              </button>
                              <button
                                onClick={() => editHomeHighlight(highlight)}
                                style={secondaryButtonStyle}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => removeHomeHighlight(highlight.id)}
                                style={secondaryButtonStyle}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}

                        {managedHomeHighlights.length === 0 && (
                          <p style={{ margin: 0, color: tone.muted }}>
                            No feature strip items added yet. Create new ones from the form on the left.
                          </p>
                        )}
                      </div>
                    </div>

                    <div style={{ marginTop: "28px" }}>
                      <h3 style={{ marginTop: 0 }}>
                        Latest Drops ({pinnedLatestDropProducts.length}/{MAX_LATEST_DROPS})
                      </h3>
                      <p style={{ marginTop: 0, color: tone.muted }}>
                        Pick which products appear right below the homepage banner and adjust their order anytime.
                      </p>

                      <div style={{ display: "grid", gap: "12px" }}>
                        {pinnedLatestDropProducts.map((product, index) => {
                          const primaryMedia = getPrimaryProductMedia(product);

                          return (
                            <div
                              key={product.id}
                              style={{
                                border: `1px solid ${tone.line}`,
                                borderRadius: "18px",
                                padding: "14px",
                                display: "grid",
                                gridTemplateColumns: "96px minmax(0, 1fr)",
                                gap: "14px",
                                alignItems: "center"
                              }}
                            >
                              <div
                                style={{
                                  width: "96px",
                                  height: "120px",
                                  borderRadius: "14px",
                                  overflow: "hidden",
                                  background: tone.soft,
                                  border: `1px solid ${tone.line}`
                                }}
                              >
                                {primaryMedia?.type === "image" ? (
                                  <img
                                    src={primaryMedia.src}
                                    alt={product.name}
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "cover",
                                      filter: "none"
                                    }}
                                  />
                                ) : primaryMedia?.type === "video" ? (
                                  <video
                                    src={primaryMedia.src}
                                    autoPlay
                                    loop
                                    muted
                                    playsInline
                                    preload="metadata"
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "cover",
                                      filter: "none"
                                    }}
                                  />
                                ) : (
                                  <div
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      display: "grid",
                                      placeItems: "center",
                                      color: tone.muted,
                                      fontSize: "12px",
                                      textTransform: "uppercase",
                                      letterSpacing: "2px"
                                    }}
                                  >
                                    {product.category}
                                  </div>
                                )}
                              </div>

                              <div style={{ minWidth: 0 }}>
                                <p style={{ margin: "0 0 6px", color: tone.muted, fontSize: "12px", letterSpacing: "2px", textTransform: "uppercase" }}>
                                  Position {index + 1}
                                </p>
                                <h4 style={{ margin: "0 0 6px" }}>{product.name}</h4>
                                <p style={{ margin: "0 0 10px", color: tone.muted }}>
                                  {product.category} | {formatCurrency(discountPrice(product))}
                                </p>
                                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                                  <button
                                    onClick={() => moveLatestDropProduct(product.id, "up")}
                                    style={secondaryButtonStyle}
                                    disabled={index === 0}
                                  >
                                    Up
                                  </button>
                                  <button
                                    onClick={() => moveLatestDropProduct(product.id, "down")}
                                    style={secondaryButtonStyle}
                                    disabled={index === pinnedLatestDropProducts.length - 1}
                                  >
                                    Down
                                  </button>
                                  <button
                                    onClick={() => removeLatestDropProduct(product.id)}
                                    style={secondaryButtonStyle}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {pinnedLatestDropProducts.length === 0 && (
                          <p style={{ margin: 0, color: tone.muted }}>
                            No products pinned yet. The storefront will temporarily show the newest products automatically.
                          </p>
                        )}
                      </div>

                      <div style={{ marginTop: "20px" }}>
                        <h4 style={{ margin: "0 0 10px" }}>Available Products</h4>
                        <div
                          style={{
                            display: "grid",
                            gap: "10px",
                            maxHeight: "420px",
                            overflowY: "auto",
                            paddingRight: "6px"
                          }}
                        >
                          {availableLatestDropProducts.map((product) => {
                            const primaryMedia = getPrimaryProductMedia(product);

                            return (
                              <div
                                key={product.id}
                                style={{
                                  border: `1px solid ${tone.line}`,
                                  borderRadius: "16px",
                                  padding: "12px",
                                  display: "grid",
                                  gridTemplateColumns: "72px minmax(0, 1fr) auto",
                                  gap: "12px",
                                  alignItems: "center"
                                }}
                              >
                                <div
                                  style={{
                                    width: "72px",
                                    height: "86px",
                                    borderRadius: "12px",
                                    overflow: "hidden",
                                    background: tone.soft,
                                    border: `1px solid ${tone.line}`
                                  }}
                                >
                                  {primaryMedia?.type === "image" ? (
                                    <img
                                      src={primaryMedia.src}
                                      alt={product.name}
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        filter: "none"
                                      }}
                                    />
                                  ) : primaryMedia?.type === "video" ? (
                                    <video
                                      src={primaryMedia.src}
                                      autoPlay
                                      loop
                                      muted
                                      playsInline
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        filter: "none"
                                      }}
                                    />
                                  ) : null}
                                </div>

                                <div style={{ minWidth: 0 }}>
                                  <strong style={{ display: "block" }}>{product.name}</strong>
                                  <span style={{ color: tone.muted, fontSize: "13px" }}>
                                    {product.category} | {formatCurrency(discountPrice(product))}
                                  </span>
                                </div>

                                <button
                                  onClick={() => addLatestDropProduct(product.id)}
                                  style={primaryButtonStyle}
                                  disabled={pinnedLatestDropProducts.length >= MAX_LATEST_DROPS}
                                >
                                  Add
                                </button>
                              </div>
                            );
                          })}

                          {availableLatestDropProducts.length === 0 && (
                            <p style={{ margin: 0, color: tone.muted }}>
                              All current products are already pinned in Latest Drops.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 style={{ marginTop: 0 }}>Offers</h3>
                      <div style={{ display: "grid", gap: "12px" }}>
                        {settings.offers.map((offer) => (
                          <div
                            key={offer.id}
                            style={{
                              border: `1px solid ${tone.line}`,
                              borderRadius: "18px",
                              padding: "16px"
                            }}
                          >
                            <p style={{ margin: 0 }}>{offer.text}</p>
                            <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
                              <button onClick={() => editOffer(offer)} style={secondaryButtonStyle}>
                                Edit
                              </button>
                              <button onClick={() => removeOffer(offer.id)} style={secondaryButtonStyle}>
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {adminTab === "settings" && (
              <>
                <h2 style={{ marginTop: 0 }}>Settings</h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: "20px"
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gap: "14px",
                      border: `1px solid ${tone.line}`,
                      borderRadius: "20px",
                      padding: "18px",
                      background: tone.soft
                    }}
                  >
                    <div>
                      <h3 style={{ margin: "0 0 6px" }}>Brand Management</h3>
                      <p style={{ margin: 0, color: tone.muted }}>
                        Manage the website name and the logo media shown in the navbar.
                      </p>
                    </div>

                    <label style={{ display: "grid", gap: "8px", color: tone.muted }}>
                      Website name
                      <input
                        value={settings.websiteName}
                        onChange={(event) => updateSettingField("websiteName", event.target.value)}
                        placeholder="Website name"
                        style={inputStyle}
                      />
                    </label>

                    <label style={{ display: "grid", gap: "8px", color: tone.muted }}>
                      Website logo
                      <input
                        type="file"
                        accept="image/*,video/mp4"
                        onChange={(event) =>
                          handleImageUpload(event, (dataUrl) =>
                            updateSettingField("logoData", dataUrl)
                          )
                        }
                      />
                    </label>

                    <p style={{ margin: 0, color: tone.muted, fontSize: "13px" }}>
                      Upload an image or MP4 logo. If no custom logo is selected, the site uses the default animated brand video.
                    </p>

                    <div
                      style={{
                        display: "grid",
                        gap: "12px",
                        border: `1px solid ${tone.line}`,
                        borderRadius: "18px",
                        padding: "16px",
                        background: tone.white
                      }}
                    >
                      <p style={{ margin: 0, color: tone.muted, fontSize: "13px", letterSpacing: "2px", textTransform: "uppercase" }}>
                        Live Brand Preview
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                        {renderBrandMedia(undefined, {
                          width: "88px",
                          height: "88px",
                          borderRadius: "22px",
                          objectFit: "cover",
                          border: `1px solid ${tone.line}`,
                          background: tone.black
                        })}
                        <div>
                          <h3 style={{ margin: "0 0 6px" }}>{siteName}</h3>
                          <p style={{ margin: 0, color: tone.muted }}>
                            {settings.logoData ? "Custom logo active" : "Default video logo active"}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                      <button
                        onClick={() => updateSettingField("websiteName", defaultSettings.websiteName)}
                        style={secondaryButtonStyle}
                      >
                        Reset Name
                      </button>
                      <button
                        onClick={() => updateSettingField("logoData", "")}
                        style={secondaryButtonStyle}
                      >
                        Use Default Video Logo
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: "12px" }}>
                    <h3 style={{ margin: 0 }}>Payment Methods</h3>
                    {paymentCatalog.map((option) => (
                      <label
                        key={option.value}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "12px",
                          border: `1px solid ${tone.line}`,
                          borderRadius: "14px",
                          padding: "12px 14px"
                        }}
                      >
                        <span>{option.title}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(settings.paymentMethods[option.value])}
                          onChange={() => togglePaymentMethod(option.value)}
                        />
                      </label>
                    ))}
                  </div>

                  <div style={{ display: "grid", gap: "12px" }}>
                    <h3 style={{ margin: 0 }}>UPI Details</h3>
                    <label style={{ display: "grid", gap: "8px", color: tone.muted }}>
                      UPI ID
                      <input
                        value={settings.upiId || ""}
                        onChange={(event) => updateSettingField("upiId", event.target.value)}
                        placeholder="e.g. yourname@upi"
                        style={inputStyle}
                      />
                    </label>
                    <label style={{ display: "grid", gap: "8px", color: tone.muted }}>
                      Add or replace UPI QR
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          handleImageUpload(event, (dataUrl) =>
                            updateSettingField("upiQrData", dataUrl)
                          )
                        }
                      />
                    </label>
                    {settings.upiQrData ? (
                      <>
                        <img
                          src={resolveCloudinaryMediaUrl(settings.upiQrData)}
                          alt="Configured UPI QR"
                          style={{
                            width: "220px",
                            borderRadius: "16px",
                            border: `1px solid ${tone.line}`,
                            filter: "none"
                          }}
                        />
                        <button onClick={() => updateSettingField("upiQrData", "")} style={secondaryButtonStyle}>
                          Remove UPI QR
                        </button>
                      </>
                    ) : (
                      <p style={{ margin: 0, color: tone.muted }}>
                        No QR uploaded yet.
                      </p>
                    )}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gap: "14px",
                      border: `1px solid ${tone.line}`,
                      borderRadius: "20px",
                      padding: "18px",
                      background: tone.soft
                    }}
                  >
                    <div>
                      <h3 style={{ margin: "0 0 6px" }}>Admin Security</h3>
                      <p style={{ margin: 0, color: tone.muted }}>
                        Admin sign-in uses Google plus a fixed password in App.js. PIN and OTP are not used.
                      </p>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gap: "10px",
                        border: `1px solid ${tone.line}`,
                        borderRadius: "16px",
                        padding: "14px",
                        background: tone.white
                      }}
                    >
                      <p style={{ margin: 0, color: tone.muted }}>
                        Admin OTP email: {adminSecurityStatus.contact.emailMasked || frontendAdminEmail}
                      </p>
                      <p style={{ margin: 0, color: tone.muted }}>
                        Admin OTP mobile: {adminSecurityStatus.contact.phoneMasked || "Not configured"}
                      </p>
                      <p style={{ margin: 0, color: tone.muted }}>
                        Password: {adminSecurityStatus.passwordConfigured ? "Configured" : "Not configured"}
                      </p>
                      <p style={{ margin: 0, color: tone.muted }}>
                        PIN lock: {adminSecurityStatus.pinConfigured ? "Enabled" : "Disabled"}
                      </p>
                    </div>

                    <div style={{ display: "grid", gap: "10px" }}>
                      <input
                        type="password"
                        value={adminSecurityForm.currentPassword}
                        onChange={(event) =>
                          setAdminSecurityForm((prev) => ({
                            ...prev,
                            currentPassword: event.target.value
                          }))
                        }
                        placeholder="Current admin password"
                        style={inputStyle}
                      />
                      <input
                        type="password"
                        value={adminSecurityForm.nextPassword}
                        onChange={(event) =>
                          setAdminSecurityForm((prev) => ({
                            ...prev,
                            nextPassword: event.target.value
                          }))
                        }
                        placeholder="New admin password"
                        style={inputStyle}
                      />
                      <input
                        type="password"
                        value={adminSecurityForm.confirmNextPassword}
                        onChange={(event) =>
                          setAdminSecurityForm((prev) => ({
                            ...prev,
                            confirmNextPassword: event.target.value
                          }))
                        }
                        placeholder="Confirm new password"
                        style={inputStyle}
                      />
                      <button onClick={saveAdminPasswordSettings} style={secondaryButtonStyle}>
                        Update Password
                      </button>
                    </div>

                    <div style={{ display: "grid", gap: "10px" }}>
                      <input
                        type="password"
                        value={adminSecurityForm.currentPin}
                        onChange={(event) =>
                          setAdminSecurityForm((prev) => ({
                            ...prev,
                            currentPin: event.target.value
                          }))
                        }
                        placeholder="Current PIN"
                        style={inputStyle}
                      />
                      <input
                        type="password"
                        value={adminSecurityForm.nextPin}
                        onChange={(event) =>
                          setAdminSecurityForm((prev) => ({
                            ...prev,
                            nextPin: event.target.value
                          }))
                        }
                        placeholder="New PIN (leave blank to remove)"
                        style={inputStyle}
                      />
                      <input
                        type="password"
                        value={adminSecurityForm.confirmNextPin}
                        onChange={(event) =>
                          setAdminSecurityForm((prev) => ({
                            ...prev,
                            confirmNextPin: event.target.value
                          }))
                        }
                        placeholder="Confirm new PIN"
                        style={inputStyle}
                      />
                      <button onClick={saveAdminPinSettings} style={secondaryButtonStyle}>
                        Save PIN
                      </button>
                    </div>

                    <div style={{ display: "grid", gap: "12px" }}>
                      <label
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "12px",
                          border: `1px solid ${tone.line}`,
                          borderRadius: "14px",
                          padding: "12px 14px",
                          background: tone.white
                        }}
                      >
                        <span>Email authenticator OTP</span>
                        <input
                          type="checkbox"
                          checked={adminSecurityForm.enableEmailOtp}
                          onChange={(event) =>
                            setAdminSecurityForm((prev) => ({
                              ...prev,
                              enableEmailOtp: event.target.checked
                            }))
                          }
                        />
                      </label>
                      <label
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "12px",
                          border: `1px solid ${tone.line}`,
                          borderRadius: "14px",
                          padding: "12px 14px",
                          background: tone.white
                        }}
                      >
                        <span>Mobile OTP</span>
                        <input
                          type="checkbox"
                          checked={adminSecurityForm.enableSmsOtp}
                          onChange={(event) =>
                            setAdminSecurityForm((prev) => ({
                              ...prev,
                              enableSmsOtp: event.target.checked
                            }))
                          }
                        />
                      </label>
                      <button onClick={saveAdminTwoFactorSettings} style={secondaryButtonStyle}>
                        Save OTP Preferences
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    );
  };

  const renderCurrentPage = () => {
    if (activePage === "product") {
      return renderProductPage();
    }

    if (activePage === "wishlist") {
      return renderWishlist();
    }

    if (activePage === "cart") {
      return renderCart();
    }

    if (activePage === "checkout") {
      return renderCheckout();
    }

    if (activePage === "payment") {
      return renderPayment();
    }

    if (activePage === "orders") {
      return renderOrders();
    }

    if (activePage === "wallet") {
      return renderWallet();
    }

    if (activePage === "profile") {
      return renderProfile();
    }

    if (activePage === "terms") {
      return renderTermsAndConditions();
    }

    if (activePage === "privacy") {
      return renderPrivacyPolicy();
    }

    if (activePage === "more") {
      return renderMorePage();
    }

    if (activePage === "admin") {
      return renderAdmin();
    }

    return renderHome();
  };

  const rightIconButton = {
    border: "1px solid rgba(255,255,255,0.35)",
    background: "transparent",
    color: tone.white,
    width: "46px",
    height: "46px",
    borderRadius: "999px",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    position: "relative"
  };

  if (!storeHydrated) {
    return (
      <div
        className="app-shell"
        style={{
          minHeight: "100vh",
          background: tone.soft,
          color: tone.body,
          display: "grid",
          placeItems: "center",
          padding: "24px"
        }}
      >
        <div style={{ ...cardStyle, width: "min(100%, 420px)", textAlign: "center" }}>
          <h2 style={{ margin: "0 0 8px" }}>{siteName}</h2>
          <p style={{ margin: 0, color: tone.muted }}>
            Loading your latest store data...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ minHeight: "100vh", background: tone.soft, color: tone.body }}>
      <nav
        className={`nav-shell${navHidden ? " nav-shell--hidden" : ""}`}
        style={{
          background: tone.black,
          color: tone.white,
          borderBottom: `1px solid ${tone.darkLine}`
        }}
      >
        <div className="nav-shell__left">
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            className="icon-button"
            style={{
              ...rightIconButton,
              width: "46px",
              height: "46px"
            }}
            aria-label="Menu"
          >
            <MenuIcon />
          </button>

          {managedProductDepartments.map((department) => (
            <div
              key={department}
              className="nav-menu-group"
              style={{ position: "relative" }}
              ref={department === "tshirts" ? tshirtRef : undefined}
            >
              <button
                onClick={() =>
                  department === "tshirts"
                    ? setShowTshirtMenu((prev) => !prev)
                    : openDepartment(department, "all")
                }
                className="nav-link-button"
              >
                {formatDepartmentLabel(department)}
              </button>

              {department === "tshirts" && showTshirtMenu && (
                <div
                  className="nav-dropdown"
                  style={{
                    background: tone.white,
                    color: tone.body,
                    border: `1px solid ${tone.line}`,
                  }}
                >
                  {tshirtCategories.map((category) => (
                    <button
                      key={category.value}
                      onClick={() => openDepartment("tshirts", category.value)}
                      className="nav-dropdown__button"
                      style={{
                        background:
                          selectedDepartment === "tshirts" && selectedCategory === category.value
                            ? tone.black
                            : "transparent",
                        color:
                          selectedDepartment === "tshirts" && selectedCategory === category.value
                            ? tone.white
                            : tone.body,
                        cursor: "pointer"
                      }}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div
          onClick={activePage === "home" ? undefined : goHome}
          onContextMenu={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
          className={`brand-lockup brand-lockup--media-only${
            activePage === "home" ? " brand-lockup--locked" : ""
          }`}
          aria-label={siteName}
        >
          <div className="brand-lockup__media-shell">
            {renderBrandMedia(
              `brand-lockup__media ${
                brandMediaIsVideo
                  ? "brand-lockup__media--video"
                  : "brand-lockup__media--image"
              }`
            )}
          </div>
        </div>

        <div className="nav-shell__right">
          <div className="nav-search" ref={searchRef}>
            <SearchIcon />
            <input
              ref={searchInputRef}
              type="search"
              id="catalog-search"
              name="catalog-search"
              value={searchTerm}
              onChange={handleSearchChange}
              onFocus={handleSearchFocus}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search the collections"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="none"
              inputMode="search"
              enterKeyHint="search"
              spellCheck={false}
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore="true"
              className="nav-search__input"
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                color: tone.white,
                width: "100%",
                minWidth: 0
              }}
            />
            {searchSuggestionsOpen && hasActiveSearch && (
              <div
                className="nav-search__panel"
                style={{
                  background: tone.white,
                  color: tone.body,
                  border: `1px solid ${tone.line}`
                }}
              >
                {searchSuggestions.length > 0 ? (
                  <>
                    {searchSuggestions.map((product) => {
                      const [searchImage] = getProductImages(product);
                      const searchVideo = getProductVideo(product);

                      return (
                        <button
                          key={product.id}
                          onClick={() => openProductFromSearch(product)}
                          className="nav-search__item"
                        >
                          {searchImage ? (
                            <img
                              src={searchImage}
                              alt={product.name}
                              className="nav-search__thumb"
                              style={{ filter: "none" }}
                            />
                          ) : searchVideo ? (
                            <video
                              src={searchVideo}
                              className="nav-search__thumb"
                              autoPlay
                              loop
                              muted
                              playsInline
                            />
                          ) : (
                            <div className="nav-search__thumb nav-search__thumb--placeholder">
                              {product.category}
                            </div>
                          )}
                          <div className="nav-search__meta">
                            <strong>{product.name}</strong>
                            <span>{product.category}</span>
                          </div>
                          <span className="nav-search__price">
                            {formatCurrency(discountPrice(product))}
                          </span>
                        </button>
                      );
                    })}
                    <button onClick={activateSearchResults} className="nav-search__view-all">
                      View all results
                    </button>
                  </>
                ) : (
                  <div className="nav-search__empty">
                    No matching products found for "{searchTerm.trim()}".
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => navigateTo("wallet")}
            className="icon-button"
            style={rightIconButton}
            aria-label="Wallet"
          >
            <WalletIcon />
          </button>

          <button
            onClick={() => navigateTo("wishlist")}
            className="icon-button"
            style={rightIconButton}
            aria-label="Wishlist"
          >
            <HeartIcon />
            {wishlist.length > 0 && (
              <span
                className="icon-counter"
                style={{
                  position: "absolute",
                  top: "-5px",
                  right: "-2px",
                  minWidth: "18px",
                  height: "18px",
                  borderRadius: "999px",
                  background: tone.white,
                  color: tone.black,
                  fontSize: "11px",
                  display: "grid",
                  placeItems: "center",
                  padding: "0 4px"
                }}
              >
                {wishlist.length}
              </span>
            )}
          </button>

          <button
            onClick={() => navigateTo("cart")}
            className="icon-button"
            style={rightIconButton}
            aria-label="Cart"
          >
            <CartIcon />
            {cartCount > 0 && (
              <span
                className="icon-counter"
                style={{
                  position: "absolute",
                  top: "-5px",
                  right: "-2px",
                  minWidth: "18px",
                  height: "18px",
                  borderRadius: "999px",
                  background: tone.white,
                  color: tone.black,
                  fontSize: "11px",
                  display: "grid",
                  placeItems: "center",
                  padding: "0 4px"
                }}
              >
                {cartCount}
              </span>
            )}
          </button>

          <button
            onClick={() => navigateTo("profile")}
            className="icon-button"
            style={rightIconButton}
            aria-label="Profile"
          >
            <UserIcon />
          </button>
        </div>
      </nav>

      {toast && (
        <div
          className="toast-pill"
          style={{
            position: "fixed",
            top: "94px",
            right: "18px",
            background: tone.black,
            color: tone.white,
            padding: "12px 16px",
            borderRadius: "14px",
            zIndex: 200,
            border: `1px solid ${tone.darkLine}`
          }}
        >
          {toast}
        </div>
      )}

      {zoomedMedia?.type === "image" && (
        <div
          onClick={() => setZoomedMedia(null)}
          className="media-zoom-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(5,5,5,0.92)",
            zIndex: 250,
            display: "grid",
            placeItems: "center",
            padding: "24px"
          }}
        >
          <button
            onClick={() => setZoomedMedia(null)}
            className="media-zoom-close"
            style={{
              position: "absolute",
              top: "22px",
              right: "22px",
              ...secondaryButtonStyle
            }}
          >
            Close
          </button>
          <div
            onClick={(event) => event.stopPropagation()}
            className="media-zoom-shell"
            style={{
              maxWidth: "min(92vw, 1280px)",
              maxHeight: "calc(92vh - 48px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <img
              src={zoomedMedia.src}
              alt={zoomedMedia.alt}
              className="media-zoom-image"
              style={{
                width: "auto",
                height: "auto",
                maxWidth: "100%",
                maxHeight: "calc(92vh - 48px)",
                objectFit: "contain",
                background: "transparent"
              }}
            />
          </div>
        </div>
      )}

      {menuOpen && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            className="drawer-overlay"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              zIndex: 180
            }}
          />
          <div
            ref={drawerRef}
            className="drawer-shell"
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              width: "300px",
              height: "100vh",
              background: tone.black,
              color: tone.white,
              padding: "24px",
              boxSizing: "border-box",
              zIndex: 190,
              borderRight: `1px solid ${tone.darkLine}`
            }}
          >
            <div
              className="drawer-shell__header"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
              }}
            >
              <h3 style={{ margin: 0 }}>Menu</h3>
              <button
                onClick={() => setMenuOpen(false)}
                className="icon-button"
                style={{ ...rightIconButton, width: "40px", height: "40px" }}
              >
                <CloseIcon />
              </button>
            </div>

            <div style={{ marginTop: "24px" }}>
              {user ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                    {user.photo ? (
                      <img
                        src={user.photo}
                        alt={user.name}
                        referrerPolicy="no-referrer"
                        style={{
                          width: "56px",
                          height: "56px",
                          borderRadius: "50%",
                          objectFit: "cover",
                          filter: "none"
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "56px",
                          height: "56px",
                          borderRadius: "50%",
                          border: `1px solid ${tone.darkLine}`,
                          display: "grid",
                          placeItems: "center"
                        }}
                      >
                        <UserIcon />
                      </div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 style={{ margin: "0 0 4px" }}>{user.name}</h3>
                      <p style={{ margin: 0, color: "#bdbdbd", fontSize: "13px", overflowWrap: "anywhere", wordBreak: "break-word" }}>{user.email}</p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h3 style={{ marginBottom: "6px" }}>Guest User</h3>
                  <p style={{ marginTop: 0, color: "#bdbdbd" }}>
                    Login for checkout, wallet and account access.
                  </p>
                </>
              )}
            </div>

            {!user && (
              <button onClick={loginWithGoogle} style={{ ...primaryButtonStyle, width: "100%", marginTop: "18px" }}>
                Continue with Google
              </button>
            )}

            <div className="drawer-shell__actions" style={{ display: "grid", gap: "10px", marginTop: "26px" }}>
              {[
                { label: "Home", action: goHome },
                { label: "Profile", action: () => navigateTo("profile") },
                { label: "My Orders", action: () => navigateTo("orders") },
                { label: "Wishlist", action: () => navigateTo("wishlist") },
                { label: "Wallet", action: () => navigateTo("wallet") },
                ...(isAdminOwner
                  ? [{ label: "Admin Panel", action: () => navigateTo("admin") }]
                  : [])
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="drawer-link"
                  style={{
                    background: "transparent",
                    color: tone.white,
                    border: `1px solid ${tone.darkLine}`,
                    borderRadius: "14px",
                    padding: "12px 14px",
                    textAlign: "left",
                    cursor: "pointer"
                  }}
                >
                  {item.label}
                </button>
              ))}

              {user && (
                <button
                  onClick={logout}
                  className="drawer-logout"
                  style={{
                    background: tone.white,
                    color: tone.black,
                    border: "none",
                    borderRadius: "14px",
                    padding: "12px 14px",
                    textAlign: "left",
                    cursor: "pointer",
                    fontWeight: 700
                  }}
                >
                  Logout
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <main
        key={`${activePage}-${selectedProductId || "root"}`}
        className="page-transition"
      >
        {renderCurrentPage()}
      </main>

      {activePage === "home" && (
        <footer
          className="site-footer"
          style={{
            background: tone.black,
            color: tone.white,
            padding: "16px 20px 10px",
            textAlign: "center"
          }}
        >
          <div style={{ ...shellStyle, maxWidth: "600px", margin: "0 auto" }}>
            <div className="site-footer__branding" style={{ 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center", 
              gap: "16px",
              marginTop: "4px",
              marginBottom: "0"
            }}>
              <span className="site-footer__brand-name" style={{ 
                fontSize: "18px", 
                fontWeight: 700, 
                letterSpacing: "2px",
                textTransform: "uppercase" 
              }}>{siteName}</span>
              <div className="site-footer__divider" style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.3)" }}></div>
              <div className="site-footer__powered">
                <span className="site-footer__powered-text">Powered by</span>
                <img src={razorpayLogoSrc} alt="Razorpay" className="site-footer__powered-logo" />
              </div>
            </div>

            <hr className="site-footer__rule" style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.15)", margin: "2px 0 8px" }} />

            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center", 
              gap: "8px", 
              marginTop: "2px",
              marginBottom: "4px",
              opacity: 0.9
            }}>
              <LockIcon width={14} height={14} strokeWidth={2.5} />
              <span style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>100% Secure Payments</span>
            </div>

            <div style={{ 
              display: "flex", 
              justifyContent: "center", 
              gap: "24px", 
              flexWrap: "wrap",
              transform: "translateY(4px)"
            }}>
              {[
                { label: "More", page: "more" },
                { label: "Terms & Conditions", page: "terms" },
                { label: "Privacy Policy", page: "privacy" }
              ].map((item) => (
                <button
                  key={item.page}
                  onClick={() => navigateTo(item.page)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    color: tone.white,
                    textDecoration: "underline",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 500,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px"
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
