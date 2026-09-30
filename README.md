# CloudBox – Personal Cloud Storage (Dropbox Clone)

A modern, serverless personal cloud storage web application (Dropbox clone) built with vanilla web technologies, the Firebase Web SDK v10 (modular imports), and Cloud Storage for Firebase. Runs 100% locally with zero cloud costs using the Firebase Emulator Suite.

---

## 🏛️ System Architecture

```
                       ┌────────────────────────────────────────────────────────┐
                       │                   Web Browser Client                   │
                       │    (Vanilla HTML5, CSS3 Design System, ES6 Modules)    │
                       └───────────────────┬────────────────┬───────────────────┘
                                           │                │
                        1. Sign in / Auth  │                │ 2. Direct Chunked Upload
                           (Returns JWT)   │                │    & Direct Streaming Download
                                           ▼                ▼
                     ┌────────────────────────────┐   ┌─────────────────────────────┐
                     │   Firebase Authentication  │   │  Cloud Storage for Firebase │
                     │   (Email/Password, Google) │   │     (Google Cloud Storage)  │
                     │       Port: 9099           │   │         Port: 9199          │
                     └────────────────────────────┘   └──────────────┬──────────────┘
                                                                     │
                                                   3. Policy Check   │
                                                   Token UID == Path │
                                                                     ▼
                                                      ┌─────────────────────────────┐
                                                      │    Storage Security Rules   │
                                                      │  • Per-user data isolation  │
                                                      │  • Strict 50 MB file cap    │
                                                      └─────────────────────────────┘
```

### Architectural Highlights
- **Serverless & Direct-to-Storage**: There is no custom backend server or proxy. The client directly negotiates tokenized transfers with the storage bucket.
- **Client-Side Thin Layer**: All business logic, UI state, progress tracking, and client validations happen in standard ES6 JavaScript.
- **Enforced Isolation at the Cloud Layer**: Cloud Storage Security Rules ensure that no client can read, list, modify, or delete another user's files even if paths or tokens are tampered with.

### 🎨 Google Stitch UI/UX Integration (MCP Export)
The visual interface and user experience were designed in **Google Stitch** (`projects/9291053589025518685` – *"UI UX Design Enhancement"*).
Using the **Stitch MCP Server** (`@_davideast/stitch-mcp`) configured in [`.agents/mcp_config.json`](file:///c:/Users/AMITHAB/OneDrive/Desktop/Personal%20Colud%20Storage/.agents/mcp_config.json), the design assets were directly integrated:
- **Design Tokens**: Material 3 color system (`primary` `#004ac6`, `primary-container` `#2563eb`, `surface` `#faf8ff`), `Geist` typography, and `Material Symbols Outlined`.
- **Bento Grid & Table Views**: Responsive multi-column layout with real-time thumbnail previews and quick hover actions.
- **Interactive File Detail Drawer**: Sliding inspector drawer revealing file format, dimensions, size, path, timestamp, owner UID, and download links.
- **Segmented Linear Storage Meter**: Visual breakdown of storage by category (Images, Documents, Others) against the 500 MB quota.

---

## ⚡ Quick Start: Running the Project Locally

The project is designed to run completely offline without billing, credit cards, or an active Google Cloud account using the Firebase Emulator Suite (`demo-cloudbox`).

### Prerequisites
1. **Node.js**: v18+ installed (`node -v`)
2. **Java**: JRE 11+ installed (`java -version`, required by Firebase Emulators)
3. **Firebase CLI**: Installed globally or executed via `npx`

### Exact Commands to Run

#### Option A: Using `npx` (No global install needed)
```bash
# In the project root directory:
npx firebase-tools emulators:start
```

#### Option B: Global Firebase CLI
```bash
npm install -g firebase-tools
firebase emulators:start
```

### Accessing the App & Emulators
Once the emulators are running:
- 🌐 **CloudBox Web Application**: [http://localhost:5000](http://localhost:5000)
- 🎛️ **Firebase Emulator Suite UI**: [http://localhost:4000](http://localhost:4000)
  - Inspect registered accounts: [http://localhost:4000/auth](http://localhost:4000/auth)
  - Inspect storage bucket & objects: [http://localhost:4000/storage](http://localhost:4000/storage)

*(Optional) To preserve uploaded files and test users between emulator restarts:*
```bash
npx firebase-tools emulators:start --import=./emu-data --export-on-exit
```

---

## 🔒 Secure Authorization Flow

1. **Authentication**: The user logs in via Email/Password or Google Sign-In. Firebase Authentication issues a signed cryptographic JSON Web Token (JWT / ID token).
2. **Path Convention**: Every user's files and folders are isolated under their own UID prefix:
   ```
   users/<uid>/document.pdf
   users/<uid>/Photos/vacation.jpg
   users/<uid>/Photos/.keep       ← Zero-byte marker object establishing the virtual folder
   ```
3. **Token Attachment**: The Firebase SDK automatically attaches the authenticated user's ID token to every HTTP/gRPC request sent to Cloud Storage.
4. **Security Rules Enforcement (`storage.rules`)**:
   ```javascript
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /users/{userId}/{allPaths=**} {
         allow read, delete: if request.auth != null && request.auth.uid == userId;
         allow create, update: if request.auth != null
                               && request.auth.uid == userId
                               && request.resource.size < 50 * 1024 * 1024; // 50 MB limit
       }
     }
   }
   ```
   - **Isolation**: If User B attempts to access `users/<UserA-UID>/...`, `request.auth.uid == userId` evaluates to `false`, and the request is rejected with HTTP 403 Forbidden.
   - **File Size Cap**: Any upload exceeding 50 MB is automatically denied by the rules engine.

---

## 🚀 Scalable File Streaming (Chunking & Direct Downloads)

- **Resumable Chunked Uploads (`uploadBytesResumable`)**:
  - Files are uploaded directly from the browser to Cloud Storage in byte chunks.
  - Exposes real-time progress callbacks (`snapshot.bytesTransferred / snapshot.totalBytes`).
  - Supports pause/resume and full client-side cancellation via `task.cancel()`.
- **Direct-to-Client Downloads (`getDownloadURL`)**:
  - The client requests a cryptographically signed, tokenized HTTPS download URL.
  - The browser streams file bytes directly from the storage edge, bypassing any intermediary servers.

---

## ⚔️ Cloud Provider Architecture Comparison (Firebase vs. AWS)

For interviews and architecture reviews comparing Google Cloud / Firebase to Amazon Web Services:

| CloudBox Layer | Firebase / Google Cloud Architecture | AWS Equivalent Architecture |
|---|---|---|
| **Identity & Authentication** | Firebase Authentication (Email/Password, Google OAuth) | **Amazon Cognito User Pools** (User Directory) + **Identity Pools** (Federated Credentials) |
| **Object / Blob Storage** | Cloud Storage for Firebase (Google Cloud Storage Bucket) | **Amazon S3** (Simple Storage Service) |
| **Access Control & Authorization** | Storage Security Rules (`request.auth.uid == userId`) | **AWS IAM Policies** scoped via `${cognito-identity.amazonaws.com:sub}` prefix condition |
| **Direct File Uploads** | `uploadBytesResumable` directly to GCS endpoint | **S3 Presigned URLs** (`s3:PutObject`) or S3 Multipart Upload |
| **Direct Streaming Downloads**| `getDownloadURL` with secure token | **S3 Presigned URLs** (`s3:GetObject`) or **CloudFront Signed URLs** |
| **Static Web Hosting & CDN** | Firebase Hosting (Global SSD Edge CDN) | **Amazon S3 Static Website Hosting** behind **Amazon CloudFront** |

---

## 📋 Internship Review Demo Checklist

When demonstrating CloudBox to your internship evaluator:

- [ ] **1. Clean Startup**: Run `npx firebase-tools emulators:start` and open `http://localhost:5000`.
- [ ] **2. Auth & Password Reset**:
  - Create account `alice@example.com`.
  - Demonstrate friendly error handling (e.g. invalid password, duplicate account).
  - Open "Forgot Password" modal and generate a reset link.
- [ ] **3. Folder Structure & Skeletons**:
  - Click "+ New Folder" and create `Documents`. Show that the `.keep` marker object is created behind the scenes while hidden in the UI.
  - Open the folder and show the updated breadcrumb (`My Files / Documents`).
- [ ] **4. Resumable Upload & Cancellation**:
  - Drag and drop a file or upload multiple files.
  - Show the live progress bar and byte counter.
  - Click **Cancel** on an in-progress upload to demonstrate `task.cancel()`.
- [ ] **5. Client-Side Size Validation (50 MB Limit)**:
  - Select a file > 50 MB. Demonstrate the client-side warning toast preventing wasted bandwidth.
- [ ] **6. Search & Sorting**:
  - Type in the search box to filter files in real-time.
  - Sort by Name, Date Modified, and Size.
- [ ] **7. Image Thumbnails & Lightbox**:
  - Upload an image (`.png` / `.jpg`). Show the rendered thumbnail and click to open the full-screen lightbox preview.
- [ ] **8. Multi-Tenant Security Isolation (Crucial!)**:
  - Open an Incognito window and sign in as `bob@example.com`.
  - Confirm Bob's files list is empty and cannot see Alice's files.
  - Open Developer Console as Bob and attempt to fetch `users/<alice-uid>/notes.txt`: demonstrate that the Storage Security Rules return `403 Forbidden` (`storage/unauthorized`).
- [ ] **9. Recursive Deletion**:
  - Delete a folder containing subfiles. Confirm the modal warning appears and that both `.keep`, nested files, and sub-prefixes are deleted cleanly.

---

## 💡 Talking Points for Your Review

1. **True Serverless Architecture**:
   > *"CloudBox eliminates the traditional backend API layer entirely. By pairing Firebase Authentication's signed JWTs with Cloud Storage Security Rules, authorization happens securely at the storage layer, reducing latency, server maintenance overhead, and operational costs."*

2. **Defense-in-Depth Security**:
   > *"Security is never left solely to client code. Even if a user alters the frontend JavaScript, the serverless rules engine verifies `request.auth.uid == userId` and enforces the strict 50 MB ceiling on every single packet."*

3. **Flat Object Hierarchy vs. Virtual Directories**:
   > *"Object stores are fundamentally key-value systems with no native concept of nested directories. CloudBox implements virtual folders through key prefixes and 0-byte `.keep` markers, mirroring how AWS S3 and GCS manage directory trees."*

4. **Zero-Egress Direct Streaming**:
   > *"By leveraging `getDownloadURL` and `uploadBytesResumable`, files are uploaded and downloaded directly between the browser and storage endpoints. An application server never buffers or proxies multi-megabyte payloads, preventing server bottlenecking."*

5. **Local-First Development & Cloud Agility**:
   > *"The entire cloud environment is emulated locally without incurring AWS/GCP bills. The application is completely decoupled from cloud provider locks: switching to Amazon S3/Cognito simply requires mapping the storage and auth primitives to their AWS SDK counterparts."*

---

## 📸 Screenshots

*(Place your demo screenshots here for documentation)*

| Sign In & Auth Screen | File Manager & Storage Quota |
|---|---|
| ![Auth Screen Placeholder](docs/screenshots/auth.png) | ![App Screen Placeholder](docs/screenshots/app.png) |

| Image Lightbox Preview | Delete Confirmation Modal |
|---|---|
| ![Lightbox Placeholder](docs/screenshots/lightbox.png) | ![Delete Modal Placeholder](docs/screenshots/delete.png) |
