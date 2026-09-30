/**
 * CloudBox – Personal Cloud Storage Application
 * Integrated with Google Stitch UI/UX Design System
 * Powered by Firebase Web SDK v10 (Modular Imports)
 * Runs locally on the Firebase Emulator Suite (Auth: 9099, Storage: 9199, Hosting: 5000)
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getStorage,
  ref,
  listAll,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  getMetadata,
  connectStorageEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/* ==========================================================================
   1. Configuration & Initialization
   ========================================================================== */

const firebaseConfig = {
  apiKey: "demo-key",
  authDomain: "demo-cloudbox.firebaseapp.com",
  projectId: "demo-cloudbox",
  storageBucket: "demo-cloudbox.appspot.com",
  appId: "demo-app-id"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const storage = getStorage(app);

// Keep emulator auto-connect logic: only connect when running on localhost / 127.0.0.1
if (["localhost", "127.0.0.1"].includes(location.hostname)) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

/* ==========================================================================
   2. State & Constants
   ========================================================================== */

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB client-side cap (matches storage.rules)
const STORAGE_QUOTA_TOTAL = 500 * 1024 * 1024; // 500 MB demo quota per user

let currentUser = null;
let currentPath = []; // Directory array: e.g. ["Documents", "Design Assets"]
let currentItems = { folders: [], files: [] }; // Cached items
let searchQuery = "";
let currentFilter = "all"; // "all" | "images" | "docs"
let currentSort = "date-desc"; // "date-desc" | "date-asc" | "name-asc" | "name-desc" | "size-desc" | "size-asc"
let viewMode = "grid"; // "grid" | "list"
let selectedFile = null; // Currently inspected file in the detail drawer
let lightboxFile = null; // Currently previewed file in lightbox
let activeUploadTasks = new Map(); // uploadId -> UploadTask for cancellation

// DOM Helper
const $ = id => document.getElementById(id);

/* ==========================================================================
   3. Helpers & Utilities
   ========================================================================== */

const ERROR_MESSAGES = {
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/user-not-found": "No account found with this email. Please create an account.",
  "auth/wrong-password": "Incorrect password. Please try again.",
  "auth/invalid-credential": "Invalid email or password. Please verify and retry.",
  "auth/email-already-in-use": "An account already exists with this email.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/missing-password": "Please enter your password.",
  "auth/missing-email": "Please enter your email address.",
  "auth/popup-closed-by-user": "Google sign-in popup was closed before completion.",
  "storage/unauthorized": "Access denied. Storage rules enforce owner-only access.",
  "storage/canceled": "Upload was canceled.",
  "storage/quota-exceeded": "Storage quota exceeded for this account."
};

function getErrorMessage(error) {
  if (!error) return "An unexpected error occurred.";
  const code = error.code || "";
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (error.message) {
    return error.message.replace(/^Firebase:\s*/, "").replace(/\s*\(auth\/.*\)\.?/, "");
  }
  return "An unexpected error occurred. Please try again.";
}

function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function sanitizeFolderName(name) {
  if (!name) return "";
  return name.trim().replace(/[\\/:*?"<>|]/g, "").replace(/^\.+/, "");
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  if (!bytes || isNaN(bytes)) return "-";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
}

function formatDate(isoString) {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "-";
  }
}

function isImageFile(filename) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename);
}

function isDocFile(filename) {
  return /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json)$/i.test(filename);
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'pdf': return { icon: 'picture_as_pdf', color: 'text-error', bg: 'bg-error/10', label: 'PDF Document' };
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp':
      return { icon: 'image', color: 'text-primary', bg: 'bg-primary/10', label: 'Image' };
    case 'svg': return { icon: 'account_tree', color: 'text-teal-600', bg: 'bg-teal-50', label: 'SVG Vector' };
    case 'json': case 'js': case 'ts': case 'html': case 'css':
      return { icon: 'code', color: 'text-amber-600', bg: 'bg-amber-50', label: 'Code File' };
    case 'doc': case 'docx': case 'txt': case 'md':
      return { icon: 'description', color: 'text-blue-600', bg: 'bg-blue-50', label: 'Document' };
    case 'zip': case 'tar': case 'gz':
      return { icon: 'folder_zip', color: 'text-purple-600', bg: 'bg-purple-50', label: 'Archive' };
    default:
      return { icon: 'draft', color: 'text-outline', bg: 'bg-surface-container', label: 'File' };
  }
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    textArea.remove();
    return successful;
  } catch {
    return false;
  }
}

/* ==========================================================================
   4. Toasts & Modals
   ========================================================================== */

function showToast(message, type = "info", duration = 3500) {
  const container = $("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `stitch-toast ${type}`;

  const iconMap = {
    info: '<span class="material-symbols-outlined text-primary text-[20px]">info</span>',
    success: '<span class="material-symbols-outlined text-emerald-600 text-[20px]">check_circle</span>',
    error: '<span class="material-symbols-outlined text-error text-[20px]">error</span>',
    warning: '<span class="material-symbols-outlined text-amber-600 text-[20px]">warning</span>'
  };

  toast.innerHTML = `
    <div class="flex-shrink-0">${iconMap[type] || iconMap.info}</div>
    <div class="flex-1 min-w-0 pr-1 text-xs font-medium text-on-surface">${esc(message)}</div>
    <button class="text-outline hover:text-on-surface p-1 rounded" aria-label="Close">✕</button>
  `;

  const closeToast = () => {
    toast.classList.add("hiding");
    setTimeout(() => toast.remove(), 200);
  };

  toast.querySelector("button").onclick = closeToast;
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(closeToast, duration);
  }
}

function openModal(modalId) {
  const modal = $(modalId);
  if (!modal) return;
  modal.classList.add("active");
  const firstInput = modal.querySelector("input:not([type=hidden])");
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 50);
  }
}

function closeModal(modalId) {
  const modal = $(modalId);
  if (!modal) return;
  modal.classList.remove("active");
}

document.addEventListener("click", e => {
  const closeBtn = e.target.closest("[data-modal-close]");
  if (closeBtn) {
    closeModal(closeBtn.dataset.modalClose);
  } else if (e.target.classList.contains("modal-backdrop")) {
    closeModal(e.target.id);
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-backdrop.active").forEach(m => closeModal(m.id));
    closeDetailDrawer();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    $("search-input")?.focus();
  }
});

/* ==========================================================================
   5. Authentication
   ========================================================================== */

function showAuthAlert(msg, type = "error") {
  const alertEl = $("auth-alert");
  if (!msg) {
    alertEl.className = "hidden";
    alertEl.textContent = "";
    return;
  }
  alertEl.textContent = msg;
  alertEl.className = type === "error"
    ? "p-3 rounded-lg text-xs border font-medium bg-red-50 text-error border-red-200 block"
    : "p-3 rounded-lg text-xs border font-medium bg-emerald-50 text-emerald-700 border-emerald-200 block";
}

$("btnLogin")?.addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
  showAuthAlert(null);

  if (!email) { showAuthAlert("Please enter your email.", "error"); return; }
  if (!password) { showAuthAlert("Please enter your password.", "error"); return; }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    showToast("Signed in successfully!", "success");
  } catch (err) {
    showAuthAlert(getErrorMessage(err), "error");
  }
});

$("btnSignup")?.addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
  showAuthAlert(null);

  if (!email) { showAuthAlert("Please enter your email.", "error"); return; }
  if (!password || password.length < 6) {
    showAuthAlert("Password must be at least 6 characters.", "error");
    return;
  }

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    showToast("Account created successfully!", "success");
  } catch (err) {
    showAuthAlert(getErrorMessage(err), "error");
  }
});

$("btnGoogle")?.addEventListener("click", async () => {
  showAuthAlert(null);
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    showToast("Signed in with Google!", "success");
  } catch (err) {
    if (err.code !== "auth/popup-closed-by-user") {
      showAuthAlert(getErrorMessage(err), "error");
    }
  }
});

$("btnForgot")?.addEventListener("click", () => {
  const currentEmail = $("email").value.trim();
  if (currentEmail) $("reset-email-input").value = currentEmail;
  openModal("modal-reset");
});

$("form-reset-password")?.addEventListener("submit", async e => {
  e.preventDefault();
  const resetEmail = $("reset-email-input").value.trim();
  if (!resetEmail) {
    showToast("Please enter your email address.", "error");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, resetEmail);
    closeModal("modal-reset");
    showToast(`Password reset link generated for ${resetEmail}. Check Auth Emulator UI.`, "success", 5000);
  } catch (err) {
    showToast(getErrorMessage(err), "error");
  }
});

$("btnOut")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    showToast("Signed out", "info");
  } catch (err) {
    showToast(getErrorMessage(err), "error");
  }
});

onAuthStateChanged(auth, u => {
  currentUser = u;
  currentPath = [];
  searchQuery = "";
  if ($("search-input")) $("search-input").value = "";
  if ($("search-clear")) $("search-clear").classList.add("hidden");
  closeDetailDrawer();

  const isSignedIn = !!u;
  $("auth-section").classList.toggle("hidden", isSignedIn);
  $("app-section").classList.toggle("hidden", !isSignedIn);

  if (isSignedIn) {
    const email = u.email || "Authenticated User";
    $("who").textContent = email;
    const namePart = email.split('@')[0];
    $("user-display-name").textContent = namePart;
    $("user-avatar").textContent = namePart.charAt(0).toUpperCase();

    render();
    updateStorageQuota();
  }
});

/* ==========================================================================
   6. Storage Path Helpers & Segmented Quota Calculation
   ========================================================================== */

const getStorageBasePath = () => ["users", currentUser.uid, ...currentPath].join("/");

async function updateStorageQuota() {
  if (!currentUser) return;
  try {
    let imgBytes = 0;
    let docBytes = 0;
    let otherBytes = 0;

    async function scan(prefixRef) {
      const res = await listAll(prefixRef);
      const metas = await Promise.all(res.items.map(i => getMetadata(i).catch(() => null)));
      for (const m of metas) {
        if (m && m.name !== ".keep") {
          const sz = m.size || 0;
          if (isImageFile(m.name)) {
            imgBytes += sz;
          } else if (isDocFile(m.name)) {
            docBytes += sz;
          } else {
            otherBytes += sz;
          }
        }
      }
      for (const p of res.prefixes) {
        await scan(p);
      }
    }

    await scan(ref(storage, `users/${currentUser.uid}`));
    const totalBytes = imgBytes + docBytes + otherBytes;

    const pct = Math.min(100, Math.round((totalBytes / STORAGE_QUOTA_TOTAL) * 100));
    const imgPct = totalBytes > 0 ? (imgBytes / STORAGE_QUOTA_TOTAL) * 100 : 0;
    const docPct = totalBytes > 0 ? (docBytes / STORAGE_QUOTA_TOTAL) * 100 : 0;
    const otherPct = totalBytes > 0 ? (otherBytes / STORAGE_QUOTA_TOTAL) * 100 : 0;

    $("bar-img").style.width = `${imgPct}%`;
    $("bar-doc").style.width = `${docPct}%`;
    $("bar-other").style.width = `${otherPct}%`;

    $("sidebar-quota-pct").textContent = `${pct}%`;
    $("sidebar-quota-text").textContent = `${formatBytes(totalBytes)} of ${formatBytes(STORAGE_QUOTA_TOTAL)} used`;

    $("pill-img-size").textContent = formatBytes(imgBytes);
    $("pill-doc-size").textContent = formatBytes(docBytes);
    $("pill-other-size").textContent = formatBytes(otherBytes);
  } catch (err) {
    console.warn("Storage quota calculation skipped:", err);
  }
}

/* ==========================================================================
   7. Directory Rendering & Views (Bento Grid vs. Table List)
   ========================================================================== */

function renderBreadcrumbs() {
  const crumbsContainer = $("crumbs");
  crumbsContainer.innerHTML = "";

  const rootItem = document.createElement("span");
  rootItem.className = "hover:text-primary cursor-pointer flex items-center gap-1";
  rootItem.innerHTML = `<span class="material-symbols-outlined text-[16px]">home</span> My Files`;
  rootItem.onclick = () => {
    if (currentPath.length > 0) {
      currentPath = [];
      closeDetailDrawer();
      render();
    }
  };
  crumbsContainer.appendChild(rootItem);

  currentPath.forEach((segment, idx) => {
    const sep = document.createElement("span");
    sep.className = "material-symbols-outlined text-[14px] text-outline";
    sep.textContent = "chevron_right";
    crumbsContainer.appendChild(sep);

    if (idx === currentPath.length - 1) {
      const current = document.createElement("span");
      current.className = "text-on-surface font-semibold";
      current.textContent = segment;
      crumbsContainer.appendChild(current);
    } else {
      const link = document.createElement("span");
      link.className = "hover:text-primary cursor-pointer";
      link.textContent = segment;
      link.onclick = () => {
        currentPath = currentPath.slice(0, idx + 1);
        closeDetailDrawer();
        render();
      };
      crumbsContainer.appendChild(link);
    }
  });
}

function showLoadingSkeletons() {
  const listEl = $("list");
  listEl.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      ${Array.from({ length: 4 }).map(() => `
        <div class="rounded-xl bg-surface-container-lowest border border-outline-variant/60 p-4 flex flex-col gap-3">
          <div class="w-full h-32 rounded-lg skeleton-shimmer"></div>
          <div class="h-4 w-3/4 rounded skeleton-shimmer"></div>
          <div class="h-3 w-1/2 rounded skeleton-shimmer"></div>
        </div>
      `).join("")}
    </div>
  `;
}

async function render() {
  renderBreadcrumbs();
  showLoadingSkeletons();

  try {
    const folderRef = ref(storage, getStorageBasePath());
    const res = await listAll(folderRef);

    // Folders
    const folderItems = res.prefixes.map(p => ({
      name: p.name,
      isFolder: true,
      ref: p
    }));

    // Files (excluding .keep marker)
    const fileRefs = res.items.filter(item => item.name !== ".keep");
    const metaResults = await Promise.all(
      fileRefs.map(f => getMetadata(f).catch(() => null))
    );

    const fileItems = fileRefs.map((f, i) => {
      const meta = metaResults[i];
      return {
        name: f.name,
        isFolder: false,
        ref: f,
        size: meta ? meta.size : 0,
        timeCreated: meta ? meta.timeCreated : null,
        updated: meta ? (meta.updated || meta.timeCreated) : null,
        contentType: meta ? meta.contentType : ""
      };
    });

    currentItems = { folders: folderItems, files: fileItems };

    // Update navigation badge
    $("nav-file-count").textContent = fileItems.length;
    $("folders-count").textContent = `(${folderItems.length})`;
    $("files-count").textContent = `(${fileItems.length})`;
    $("folder-stats-meta").textContent = `${fileItems.length} files, ${folderItems.length} folders • Synced just now`;

    applyFilterAndSort();
  } catch (err) {
    console.error("List error:", err);
    $("list").innerHTML = `
      <div class="text-center py-12 flex flex-col items-center gap-2">
        <span class="material-symbols-outlined text-error text-[36px]">error</span>
        <p class="text-sm font-semibold text-on-surface">Error loading files</p>
        <p class="text-xs text-outline">${esc(getErrorMessage(err))}</p>
        <button id="btn-retry" class="mt-3 px-3 py-1.5 rounded-lg bg-surface-container text-xs text-primary font-medium hover:bg-surface-container-high">Retry</button>
      </div>
    `;
    $("btn-retry")?.addEventListener("click", render);
  }
}

function applyFilterAndSort() {
  let { folders, files } = currentItems;

  // Filter files by search query
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    folders = folders.filter(f => f.name.toLowerCase().includes(q));
    files = files.filter(f => f.name.toLowerCase().includes(q));
  }

  // Filter files by category chip
  if (currentFilter === "images") {
    files = files.filter(f => isImageFile(f.name));
  } else if (currentFilter === "docs") {
    files = files.filter(f => isDocFile(f.name));
  }

  // Sort files
  files.sort((a, b) => {
    switch (currentSort) {
      case "name-asc": return a.name.localeCompare(b.name, undefined, { numeric: true });
      case "name-desc": return b.name.localeCompare(a.name, undefined, { numeric: true });
      case "date-desc": {
        const da = a.updated ? new Date(a.updated).getTime() : 0;
        const db = b.updated ? new Date(b.updated).getTime() : 0;
        return db - da;
      }
      case "date-asc": {
        const da = a.updated ? new Date(a.updated).getTime() : 0;
        const db = b.updated ? new Date(b.updated).getTime() : 0;
        return da - db;
      }
      case "size-desc": return b.size - a.size;
      case "size-asc": return a.size - b.size;
      default: return 0;
    }
  });

  // Render Folders Container
  const foldersContainer = $("folders-container");
  if (folders.length === 0) {
    $("folders-section").classList.add("hidden");
  } else {
    $("folders-section").classList.remove("hidden");
    foldersContainer.innerHTML = "";
    folders.forEach(f => {
      const card = document.createElement("div");
      card.className = "p-3.5 rounded-xl bg-surface-container-lowest border border-outline-variant hover:border-primary/40 hover:shadow-md transition-all group cursor-pointer flex items-center justify-between";
      card.innerHTML = `
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <div class="w-10 h-10 rounded-lg bg-surface-container text-primary flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">
            <span class="material-symbols-outlined material-symbols-fill text-[22px]">folder</span>
          </div>
          <div class="truncate">
            <h3 class="text-xs font-semibold text-on-surface truncate group-hover:text-primary transition-colors">${esc(f.name)}</h3>
            <span class="font-mono text-[10px] text-outline">Folder</span>
          </div>
        </div>
        <button class="p-1 rounded text-outline hover:text-error hover:bg-surface-container transition-colors ml-2" data-delete-folder="${esc(f.name)}" title="Delete Folder">
          <span class="material-symbols-outlined text-[18px]">delete</span>
        </button>
      `;

      card.querySelector(".min-w-0").onclick = () => {
        currentPath.push(f.name);
        searchQuery = "";
        if ($("search-input")) $("search-input").value = "";
        if ($("search-clear")) $("search-clear").classList.add("hidden");
        closeDetailDrawer();
        render();
      };

      card.querySelector("[data-delete-folder]").onclick = (e) => {
        e.stopPropagation();
        confirmDeleteItem({ name: f.name, isFolder: true, ref: f.ref });
      };

      foldersContainer.appendChild(card);
    });
  }

  // Render Files Container
  const listEl = $("list");

  if (files.length === 0 && folders.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-16 flex flex-col items-center gap-2 bg-surface-container-lowest rounded-xl border border-outline-variant/60">
        <div class="w-12 h-12 rounded-full bg-surface-container text-outline flex items-center justify-center mb-1">
          <span class="material-symbols-outlined text-[28px]">folder_open</span>
        </div>
        <p class="text-sm font-semibold text-on-surface">This folder is empty</p>
        <p class="text-xs text-outline max-w-sm">Drag and drop files here, or click "Upload" above to add files (up to 50 MB each).</p>
      </div>
    `;
    return;
  }

  if (files.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-8 text-xs text-outline">
        No files in this view. Check subfolders above or clear filters.
      </div>
    `;
    return;
  }

  if (viewMode === "grid") {
    // Bento Grid View
    listEl.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5" id="files-grid"></div>`;
    const grid = $("files-grid");

    files.forEach(file => {
      const isImg = isImageFile(file.name);
      const iconMeta = getFileIcon(file.name);
      const card = document.createElement("div");
      card.className = "group rounded-xl bg-surface-container-lowest border border-outline-variant hover:border-primary/40 hover:shadow-md transition-all flex flex-col overflow-hidden relative cursor-pointer";

      card.innerHTML = `
        <div class="w-full h-36 bg-surface-container-low flex flex-col items-center justify-center relative p-3 border-b border-outline-variant/40 overflow-hidden">
          ${isImg 
            ? `<img class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" data-img-for="${esc(file.name)}" alt="${esc(file.name)}"/>`
            : `<div class="w-12 h-12 rounded-xl ${iconMeta.bg} ${iconMeta.color} flex items-center justify-center mb-1">
                 <span class="material-symbols-outlined text-[28px]">${iconMeta.icon}</span>
               </div>
               <span class="font-mono text-[10px] ${iconMeta.color} font-medium px-2 py-0.5 rounded-full ${iconMeta.bg} border border-current/20">${iconMeta.label}</span>`
          }

          <!-- Floating Quick Actions -->
          <div class="absolute inset-0 bg-on-surface/30 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 z-10">
            <button class="p-1.5 rounded-lg bg-surface-container-lowest text-on-surface hover:text-primary shadow-sm" data-action="download" title="Download">
              <span class="material-symbols-outlined text-[18px]">download</span>
            </button>
            ${isImg ? `
            <button class="p-1.5 rounded-lg bg-surface-container-lowest text-on-surface hover:text-primary shadow-sm" data-action="preview" title="Full Preview">
              <span class="material-symbols-outlined text-[18px]">open_in_full</span>
            </button>` : ''}
            <button class="p-1.5 rounded-lg bg-surface-container-lowest text-on-surface hover:text-primary shadow-sm" data-action="details" title="Details">
              <span class="material-symbols-outlined text-[18px]">info</span>
            </button>
            <button class="p-1.5 rounded-lg bg-surface-container-lowest text-error hover:bg-red-50 shadow-sm" data-action="delete" title="Delete">
              <span class="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
        </div>

        <div class="p-3 flex flex-col justify-between flex-1">
          <div>
            <span class="text-xs font-semibold text-on-surface block truncate group-hover:text-primary transition-colors" title="${esc(file.name)}">
              ${esc(file.name)}
            </span>
            <div class="flex items-center justify-between mt-1 text-[11px] font-mono text-outline">
              <span>${formatBytes(file.size)}</span>
              <span>${formatDate(file.updated)}</span>
            </div>
          </div>
        </div>
      `;

      // Lazy load image previews
      if (isImg) {
        getDownloadURL(file.ref).then(url => {
          const img = card.querySelector(`[data-img-for="${CSS.escape(file.name)}"]`);
          if (img) img.src = url;
        }).catch(() => {});
      }

      // Card Click -> Open Detail Drawer
      card.onclick = (e) => {
        if (!e.target.closest("button")) {
          openDetailDrawer(file);
        }
      };

      card.querySelector('[data-action="download"]').onclick = (e) => {
        e.stopPropagation();
        downloadFile(file.ref, file.name);
      };

      if (isImg && card.querySelector('[data-action="preview"]')) {
        card.querySelector('[data-action="preview"]').onclick = (e) => {
          e.stopPropagation();
          openLightbox(file);
        };
      }

      card.querySelector('[data-action="details"]').onclick = (e) => {
        e.stopPropagation();
        openDetailDrawer(file);
      };

      card.querySelector('[data-action="delete"]').onclick = (e) => {
        e.stopPropagation();
        confirmDeleteItem(file);
      };

      grid.appendChild(card);
    });

  } else {
    // Table List View
    listEl.innerHTML = `
      <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden shadow-sm">
        <div class="grid grid-cols-12 px-4 py-2.5 bg-surface-container-low text-[11px] font-semibold uppercase tracking-wider text-outline border-b border-outline-variant">
          <div class="col-span-6 sm:col-span-5">Name</div>
          <div class="col-span-3 sm:col-span-3">Modified</div>
          <div class="col-span-3 sm:col-span-2 text-right">Size</div>
          <div class="hidden sm:block sm:col-span-2 text-right">Actions</div>
        </div>
        <div id="table-rows"></div>
      </div>
    `;
    const rowsContainer = $("table-rows");

    files.forEach(file => {
      const isImg = isImageFile(file.name);
      const iconMeta = getFileIcon(file.name);
      const row = document.createElement("div");
      row.className = "grid grid-cols-12 px-4 py-2.5 items-center border-b border-outline-variant/60 hover:bg-surface-container-low/60 transition-colors text-xs cursor-pointer";

      row.innerHTML = `
        <div class="col-span-6 sm:col-span-5 flex items-center gap-2.5 min-w-0 pr-2">
          <span class="material-symbols-outlined text-[20px] ${iconMeta.color}">${iconMeta.icon}</span>
          <span class="font-medium text-on-surface truncate" title="${esc(file.name)}">${esc(file.name)}</span>
        </div>
        <div class="col-span-3 sm:col-span-3 text-outline text-[11px] font-mono">${formatDate(file.updated)}</div>
        <div class="col-span-3 sm:col-span-2 text-right font-mono text-[11px] text-outline">${formatBytes(file.size)}</div>
        <div class="hidden sm:flex sm:col-span-2 items-center justify-end gap-1">
          <button class="p-1 rounded text-outline hover:text-primary hover:bg-surface-container" data-action="download" title="Download">
            <span class="material-symbols-outlined text-[18px]">download</span>
          </button>
          ${isImg ? `
          <button class="p-1 rounded text-outline hover:text-primary hover:bg-surface-container" data-action="preview" title="Full Preview">
            <span class="material-symbols-outlined text-[18px]">open_in_full</span>
          </button>` : ''}
          <button class="p-1 rounded text-outline hover:text-primary hover:bg-surface-container" data-action="details" title="Details">
            <span class="material-symbols-outlined text-[18px]">info</span>
          </button>
          <button class="p-1 rounded text-outline hover:text-error hover:bg-surface-container" data-action="delete" title="Delete">
            <span class="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      `;

      row.onclick = (e) => {
        if (!e.target.closest("button")) {
          openDetailDrawer(file);
        }
      };

      row.querySelector('[data-action="download"]').onclick = (e) => {
        e.stopPropagation();
        downloadFile(file.ref, file.name);
      };

      if (isImg && row.querySelector('[data-action="preview"]')) {
        row.querySelector('[data-action="preview"]').onclick = (e) => {
          e.stopPropagation();
          openLightbox(file);
        };
      }

      row.querySelector('[data-action="details"]').onclick = (e) => {
        e.stopPropagation();
        openDetailDrawer(file);
      };

      row.querySelector('[data-action="delete"]').onclick = (e) => {
        e.stopPropagation();
        confirmDeleteItem(file);
      };

      rowsContainer.appendChild(row);
    });
  }
}

/* ==========================================================================
   8. View Switcher, Filter Chips, Sorter & Sidebar Navigation
   ========================================================================== */

function setActiveNav(activeId) {
  const navIds = ["nav-all-files", "nav-photos", "nav-docs", "nav-recent"];
  navIds.forEach(id => {
    const btn = $(id);
    if (!btn) return;
    if (id === activeId) {
      btn.className = "w-full flex items-center justify-between px-3 py-2 rounded-lg bg-surface-container-high text-primary font-medium text-sm transition-all text-left shadow-xs";
    } else {
      btn.className = "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-on-surface-variant font-medium text-sm hover:text-on-surface hover:bg-surface-container-low transition-colors text-left";
    }
  });
}

function updateFilterChips(activeFilter) {
  document.querySelectorAll(".filter-chip").forEach(btn => {
    if (btn.dataset.filter === activeFilter) {
      btn.className = "filter-chip px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/30";
    } else {
      btn.className = "filter-chip px-2.5 py-1 rounded-full text-xs font-medium text-on-surface-variant hover:text-on-surface border border-outline-variant";
    }
  });
}

$("view-mode-grid")?.addEventListener("click", () => {
  viewMode = "grid";
  $("view-mode-grid").className = "p-1 rounded bg-surface-container-high text-primary";
  $("view-mode-list").className = "p-1 rounded text-outline hover:text-on-surface";
  applyFilterAndSort();
});

$("view-mode-list")?.addEventListener("click", () => {
  viewMode = "list";
  $("view-mode-list").className = "p-1 rounded bg-surface-container-high text-primary";
  $("view-mode-grid").className = "p-1 rounded text-outline hover:text-on-surface";
  applyFilterAndSort();
});

document.querySelectorAll(".filter-chip").forEach(btn => {
  btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter;
    updateFilterChips(currentFilter);
    applyFilterAndSort();
  });
});

$("sort-select")?.addEventListener("change", e => {
  currentSort = e.target.value;
  applyFilterAndSort();
});

$("search-input")?.addEventListener("input", e => {
  searchQuery = e.target.value;
  $("search-clear")?.classList.toggle("hidden", !searchQuery);
  applyFilterAndSort();
});

$("search-clear")?.addEventListener("click", () => {
  searchQuery = "";
  $("search-input").value = "";
  $("search-clear").classList.add("hidden");
  applyFilterAndSort();
});

// Left Navigation Category Shortcuts
$("nav-all-files")?.addEventListener("click", () => {
  setActiveNav("nav-all-files");
  currentPath = [];
  currentFilter = "all";
  updateFilterChips("all");
  closeDetailDrawer();
  render();
});

$("nav-photos")?.addEventListener("click", () => {
  setActiveNav("nav-photos");
  currentFilter = "images";
  updateFilterChips("images");
  applyFilterAndSort();
});

$("nav-docs")?.addEventListener("click", () => {
  setActiveNav("nav-docs");
  currentFilter = "docs";
  updateFilterChips("docs");
  applyFilterAndSort();
});

$("nav-recent")?.addEventListener("click", () => {
  setActiveNav("nav-recent");
  currentSort = "date-desc";
  if ($("sort-select")) $("sort-select").value = "date-desc";
  applyFilterAndSort();
});

/* ==========================================================================
   9. Right File Detail Drawer (Google Stitch Screen 2)
   ========================================================================== */

async function openDetailDrawer(file) {
  selectedFile = file;
  const drawer = $("file-detail-drawer");
  drawer.classList.remove("collapsed");

  $("drawer-title").textContent = file.name;
  $("drawer-filename").textContent = file.name;
  $("drawer-filesize").textContent = formatBytes(file.size);

  const iconMeta = getFileIcon(file.name);
  $("drawer-meta-type").textContent = iconMeta.label;
  $("drawer-meta-size").textContent = `${file.size.toLocaleString()} bytes (${formatBytes(file.size)})`;
  $("drawer-meta-path").textContent = `/${["My Files", ...currentPath, file.name].join("/")}`;
  $("drawer-meta-date").textContent = formatDate(file.updated);
  $("drawer-meta-owner").textContent = currentUser ? currentUser.uid : "owner";

  const imgEl = $("drawer-preview-img");
  const fallbackEl = $("drawer-preview-fallback");
  const isImg = isImageFile(file.name);

  if (isImg) {
    fallbackEl.classList.add("hidden");
    imgEl.classList.remove("hidden");
    imgEl.src = "";
    getDownloadURL(file.ref).then(url => {
      imgEl.src = url;
    }).catch(() => {
      imgEl.classList.add("hidden");
      fallbackEl.classList.remove("hidden");
    });
  } else {
    imgEl.classList.add("hidden");
    fallbackEl.classList.remove("hidden");
    fallbackEl.textContent = iconMeta.icon;
  }

  // Preview click -> Lightbox
  $("drawer-preview-wrap").onclick = () => {
    if (isImg) openLightbox(file);
  };

  // Wire Download Button
  $("drawer-btn-download").onclick = () => downloadFile(file.ref, file.name);

  // Wire Copy Signed Link
  $("drawer-btn-copy").onclick = async () => {
    try {
      showToast("Generating secure download URL...", "info", 1000);
      const url = await getDownloadURL(file.ref);
      const success = await copyToClipboard(url);
      if (success) {
        showToast("Download link copied to clipboard!", "success");
      } else {
        showToast("Link: " + url.substring(0, 40) + "...", "info", 5000);
      }
    } catch (err) {
      showToast("Could not generate link: " + getErrorMessage(err), "error");
    }
  };

  // Wire Rename Button
  $("drawer-btn-rename").onclick = () => {
    $("rename-input").value = file.name;
    openModal("modal-rename");
  };

  // Wire Full Preview Button
  $("drawer-btn-preview").onclick = () => {
    if (isImg) {
      openLightbox(file);
    } else {
      downloadFile(file.ref, file.name);
    }
  };

  // Wire Delete Button
  $("drawer-btn-delete").onclick = () => {
    closeDetailDrawer();
    confirmDeleteItem(file);
  };
}

function closeDetailDrawer() {
  selectedFile = null;
  $("file-detail-drawer")?.classList.add("collapsed");
}

$("drawer-close")?.addEventListener("click", closeDetailDrawer);

/* ==========================================================================
   10. Direct Downloads & Lightbox Preview
   ========================================================================== */

async function downloadFile(storageRef, fileName) {
  try {
    showToast(`Streaming "${fileName}" from Cloud Storage...`, "info", 1500);
    const downloadUrl = await getDownloadURL(storageRef);

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    console.error("Download failed:", err);
    showToast(`Download failed: ${getErrorMessage(err)}`, "error");
  }
}

async function openLightbox(file) {
  lightboxFile = file;
  $("lightbox-title").textContent = file.name;
  $("lightbox-meta").textContent = `${formatBytes(file.size)} • Last modified: ${formatDate(file.updated)}`;
  $("lightbox-img").src = "";
  
  openModal("modal-lightbox");
  
  try {
    const url = await getDownloadURL(file.ref);
    $("lightbox-img").src = url;
  } catch (err) {
    showToast("Failed to load image preview: " + getErrorMessage(err), "error");
  }
}

$("lightbox-dl")?.addEventListener("click", () => {
  if (lightboxFile) {
    downloadFile(lightboxFile.ref, lightboxFile.name);
  }
});

/* ==========================================================================
   11. Folder Creation (.keep marker convention)
   ========================================================================== */

$("btnFolder")?.addEventListener("click", () => {
  $("folder-name-input").value = "";
  openModal("modal-folder");
});

$("form-new-folder")?.addEventListener("submit", async e => {
  e.preventDefault();
  const rawName = $("folder-name-input").value;
  const safeName = sanitizeFolderName(rawName);

  if (!safeName) {
    showToast("Please enter a valid folder name.", "warning");
    return;
  }

  if (safeName === ".keep" || safeName === "." || safeName === "..") {
    showToast("This folder name is reserved. Please choose another.", "warning");
    return;
  }

  if (currentItems.folders.some(f => f.name.toLowerCase() === safeName.toLowerCase())) {
    showToast(`Folder "${safeName}" already exists here.`, "warning");
    return;
  }

  closeModal("modal-folder");
  showToast(`Creating folder "${safeName}"...`, "info", 1500);

  try {
    const keepRef = ref(storage, `${getStorageBasePath()}/${safeName}/.keep`);
    await uploadBytesResumable(keepRef, new Blob([""]));
    showToast(`Folder "${safeName}" created!`, "success");
    render();
  } catch (err) {
    console.error("Folder creation failed:", err);
    showToast(`Failed to create folder: ${getErrorMessage(err)}`, "error");
  }
});

/* ==========================================================================
   12. Rename File Feature
   ========================================================================== */

$("form-rename")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!selectedFile) return;

  const rawNewName = $("rename-input").value.trim();
  const safeNewName = rawNewName.replace(/[\\/]/g, "").trim();

  if (!safeNewName) {
    showToast("Please enter a valid filename.", "warning");
    return;
  }

  if (safeNewName === selectedFile.name) {
    closeModal("modal-rename");
    return;
  }

  if (currentItems.files.some(f => f.name.toLowerCase() === safeNewName.toLowerCase())) {
    showToast(`A file named "${safeNewName}" already exists in this folder.`, "warning");
    return;
  }

  closeModal("modal-rename");
  showToast(`Renaming "${selectedFile.name}" to "${safeNewName}"...`, "info", 2000);

  try {
    // 1. Fetch file bytes from current reference
    const downloadUrl = await getDownloadURL(selectedFile.ref);
    const response = await fetch(downloadUrl);
    const blob = await response.blob();

    // 2. Upload to new target path
    const targetRef = ref(storage, `${getStorageBasePath()}/${safeNewName}`);
    await uploadBytesResumable(targetRef, blob);

    // 3. Delete old object
    await deleteObject(selectedFile.ref);

    showToast(`File renamed to "${safeNewName}"!`, "success");
    closeDetailDrawer();
    render();
    updateStorageQuota();
  } catch (err) {
    console.error("Rename failed:", err);
    showToast(`Rename failed: ${getErrorMessage(err)}`, "error");
  }
});

/* ==========================================================================
   13. Recursive Deletion
   ========================================================================== */

let pendingDeleteItem = null;

function confirmDeleteItem(item) {
  pendingDeleteItem = item;
  const msgEl = $("modal-delete-msg");
  const submsgEl = $("modal-delete-submsg");

  if (item.isFolder) {
    msgEl.innerHTML = `Are you sure you want to delete the folder <strong>"${esc(item.name)}"</strong>?`;
    submsgEl.textContent = "Warning: This will recursively delete all files and subfolders contained within it!";
  } else {
    msgEl.innerHTML = `Are you sure you want to delete the file <strong>"${esc(item.name)}"</strong>?`;
    submsgEl.textContent = "This action cannot be undone.";
  }

  openModal("modal-delete");
}

$("btn-delete-confirm")?.addEventListener("click", async () => {
  if (!pendingDeleteItem) return;
  const item = pendingDeleteItem;
  closeModal("modal-delete");
  pendingDeleteItem = null;

  showToast(`Deleting "${item.name}"...`, "info", 2000);

  try {
    if (item.isFolder) {
      await deleteFolderRecursively(item.ref);
    } else {
      await deleteObject(item.ref);
    }
    showToast(`Deleted "${item.name}" successfully`, "success");
    closeDetailDrawer();
    render();
    updateStorageQuota();
  } catch (err) {
    console.error("Delete failed:", err);
    showToast(`Delete failed: ${getErrorMessage(err)}`, "error");
  }
});

async function deleteFolderRecursively(folderRef) {
  const res = await listAll(folderRef);
  const fileDeletes = res.items.map(itemRef => deleteObject(itemRef));
  const folderDeletes = res.prefixes.map(prefixRef => deleteFolderRecursively(prefixRef));
  await Promise.all([...fileDeletes, ...folderDeletes]);
}

/* ==========================================================================
   14. Resumable Chunked Uploads & 50MB Cap Validation
   ========================================================================== */

$("btnUpload")?.addEventListener("click", () => $("picker").click());

$("picker")?.addEventListener("change", e => {
  const files = [...e.target.files];
  files.forEach(handleFileUpload);
  e.target.value = "";
});

const dropZone = $("drop");

dropZone?.addEventListener("click", () => {
  $("picker").click();
});

["dragover", "dragenter"].forEach(ev => {
  dropZone?.addEventListener(ev, e => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("border-primary", "bg-surface-container-low");
  });
});

["dragleave", "drop"].forEach(ev => {
  dropZone?.addEventListener(ev, e => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("border-primary", "bg-surface-container-low");
  });
});

dropZone?.addEventListener("drop", e => {
  const files = [...e.dataTransfer.files];
  if (files.length > 0) files.forEach(handleFileUpload);
});

dropZone?.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("picker").click();
  }
});

function handleFileUpload(file) {
  // 1. Client-Side Size Validation (50 MB limit)
  if (file.size > MAX_FILE_SIZE) {
    showToast(
      `"${file.name}" exceeds the 50 MB limit (${formatBytes(file.size)}). CloudBox enforces a strict 50 MB cap.`,
      "error",
      5000
    );
    return;
  }

  // 2. Filename sanitization
  const safeFileName = file.name.replace(/[\\/]/g, "").trim();
  if (!safeFileName || safeFileName === ".keep") {
    showToast("Invalid filename. Upload skipped.", "warning");
    return;
  }

  // 3. Create upload progress banner
  const uploadId = "up-" + Math.random().toString(36).substring(2, 9);
  const uploadContainer = $("uploads");

  const card = document.createElement("div");
  card.className = "p-3 rounded-xl bg-surface-container-lowest border border-primary/40 shadow-sm flex items-center justify-between gap-4";
  card.id = uploadId;

  card.innerHTML = `
    <div class="flex items-center gap-3 min-w-0 flex-1">
      <div class="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
        <span class="material-symbols-outlined text-[20px]">upload_file</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between text-xs font-semibold text-on-surface mb-1">
          <span class="truncate">${esc(safeFileName)}</span>
          <span class="font-mono text-outline font-normal text-[11px]">${formatBytes(file.size)}</span>
        </div>
        <div class="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
          <div class="bg-primary-container h-full transition-all duration-200" style="width: 0%;"></div>
        </div>
        <div class="flex items-center justify-between mt-1 text-[10px] font-mono text-outline">
          <span class="upload-pct text-primary font-medium">0% uploaded</span>
          <span>Resumable streaming</span>
        </div>
      </div>
    </div>
    <button class="px-2.5 py-1 rounded-lg border border-outline-variant text-xs text-on-surface hover:bg-surface-container-low transition-colors font-medium flex-shrink-0" data-cancel-upload="${uploadId}">
      Cancel
    </button>
  `;
  uploadContainer.appendChild(card);

  // 4. Initiate Resumable Upload Task
  const fileTargetRef = ref(storage, `${getStorageBasePath()}/${safeFileName}`);
  const task = uploadBytesResumable(fileTargetRef, file);
  activeUploadTasks.set(uploadId, task);

  card.querySelector(`[data-cancel-upload="${uploadId}"]`).onclick = () => {
    if (activeUploadTasks.has(uploadId)) {
      task.cancel();
      activeUploadTasks.delete(uploadId);
      card.remove();
      showToast(`Upload of "${safeFileName}" was canceled.`, "warning");
    }
  };

  task.on(
    "state_changed",
    snapshot => {
      const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
      const bar = card.querySelector(".bg-primary-container");
      const pctEl = card.querySelector(".upload-pct");
      if (bar) bar.style.width = `${progress}%`;
      if (pctEl) pctEl.textContent = `${Math.round(progress)}% (${formatBytes(snapshot.bytesTransferred)} / ${formatBytes(snapshot.totalBytes)})`;
    },
    error => {
      activeUploadTasks.delete(uploadId);
      card.remove();
      if (error.code !== "storage/canceled") {
        console.error("Upload error:", error);
        showToast(`Upload failed for "${safeFileName}": ${getErrorMessage(error)}`, "error", 5000);
      }
    },
    () => {
      activeUploadTasks.delete(uploadId);
      card.remove();
      showToast(`Uploaded "${safeFileName}" successfully!`, "success");
      render();
      updateStorageQuota();
    }
  );
}
