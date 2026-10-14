# CampusShield — Smart Campus Safety and Emergency Response System

CampusShield is a full-stack campus emergency-response and security command platform designed specifically for college campuses (Kongu Engineering College - KEC). It bridges the gap between students in distress and campus security personnel by providing instant one-tap SOS reporting, geolocation telemetry, real-time WebSocket incident dispatch, responder fleet tracking, and administrative governance.

---

## 1. Project Overview & System Architecture

```
                                  [ CAMPUSSHIELD CLIENTS ]
             ┌───────────────────────────────┬───────────────────────────────┐
             │                               │                               │
    [ Student Safety Portal ]    [ Security Command Center ]     [ Administrator Portal ]
       (Mobile/Web UI)            (Tactical Radar & CCTV)         (Governance & Audits)
             │                               │                               │
             └───────────────────────────────┼───────────────────────────────┘
                                             │ REST API (JSON) + Socket.IO (Authenticated)
                                             ▼
                               [ EXPRESS.JS BACKEND SERVER ]
                                 (Port 5000, Node.js ES Modules)
       ┌─────────────────────────────────────┼─────────────────────────────────────┐
       │                                     │                                     │
 [Security & Middleware]           [Controllers & Routes]                [Real-Time Engine]
  - Helmet & CORS                   - /api/auth                           - Socket.IO Rooms:
  - Rate Limiters                   - /api/incidents                        * role:security
  - JWT Authentication              - /api/responders                       * role:admin
  - RBAC Strict Guard               - /api/notifications                   * user:{id}
  - Tamper-Evident Audit            - /api/dashboard                      - Instant Broadcasts:
  - Central Error Handler           - /api/safewalk                         * incident:created
                                    - /api/admin                            * incident:updated
       └─────────────────────────────────────┼─────────────────────────────────────┘
                                             │ Mongoose ODM
                                             ▼
                                  [ MONGODB DATABASE ]
                              mongodb://127.0.0.1:27017/campusshield
                         (Collections: users, incidents, responders,
                          notifications, auditlogs, safewalksessions,
                          emergencycontacts)
```

---

## 2. Core Modules Implemented

- **Module A — Authentication & Role-Based Access Control (RBAC):**
  - Roles: `student`, `faculty`, `security`, `admin`.
  - Password hashing with `bcryptjs` (salt rounds: 10).
  - JWT tokens with HTTP bearer headers.
  - Server-side role enforcement preventing privilege escalation (no self-service admin signup).
  - Rate limiting on authentication (`5 requests / 15 mins`).

- **Module B & C — Student Safety Portal & Emergency SOS:**
  - One-tap SOS button with accidental-trigger confirmation modal.
  - Emergency categories: *Medical emergency, Harassment or personal safety concern, Accident, Theft, Fire, Suspicious activity, Other*.
  - Browser Geolocation API lock with manual landmark fallbacks (e.g. *Central Library, IT Block, Girls Hostel*).
  - Unique human-readable incident IDs: `CS-YYYY-XXXX` generated dynamically with atomic counters.
  - Full lifecycle tracking: `Submitted` → `Acknowledged` → `Assigned` → `Dispatched` → `On Scene` → `Resolved`.
  - Accidental cancellation permitted only while in `Submitted` state.

- **Module D — Security Personnel Command Center:**
  - High-contrast tactical UI (`#070a13` dark mode, glassmorphism, radar animations).
  - Real-time incident triage queue sorted by severity (`critical`, `high`, `medium`, `low`).
  - Emergency Dossier with reporter contact, coordinates, and status history timeline.
  - One-click incident acknowledgment and responder dispatch.
  - Security fleet status with call signs (e.g., `ALPHA-PATROL`, `MEDIC-DELTA`).
  - Clear labeling of simulated hardware feeds (`[SIMULATED SURVEILLANCE FEED - DEMO]`).

- **Module E — Campus Safety Map:**
  - Tactical Canvas map showing campus zones, checkpoints, and incident markers.
  - Direct coordinate mapping with real-time incident pins.

- **Module F — Incident Management & Lifecycle:**
  - Filter by status (`All`, `Active`, `Critical`, `Resolved`).
  - Search by Incident ID, reporter name, or campus location.
  - Audit logging of every lifecycle status transition and responder dispatch.

- **Module G — Real-Time WebSocket Notifications:**
  - Authenticated Socket.IO connections.
  - Role-scoped broadcast rooms (`role:security`, `role:admin`, `user:{id}`).
  - Instant sound/visual alerts upon new incoming emergencies.

- **Module H — Administrator Dashboard:**
  - System health telemetry (MongoDB connection status, server uptime, rate limiter metrics).
  - Metric cards calculated strictly from MongoDB data (Total, Active, Critical, Resolved, Avg Response Time).
  - Aggregated category and severity distribution charts.
  - User and role management (elevate roles, suspend/activate accounts).
  - Tamper-evident Audit Log inspector with actor attribution and metadata sanitization.

- **Module I — Campus Safe Walk Companion:**
  - Night escort and safe-commute tracking sessions.
  - Live session tracking with "✓ Arrived Safely" and "🚨 Panic SOS" shortcuts.

- **Module J — Verified Campus Emergency Directory:**
  - Kongu Engineering College emergency helplines (Control Room, Health Centre, Chief Warden).
  - Admin CRUD management for campus contacts.

---

## 3. Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | HTML5, Tailwind CSS (CDN), Vanilla JavaScript (ES Modules), Canvas API, Socket.IO Client |
| **Backend** | Node.js (v24.x), Express.js (v4.21), ES Modules |
| **Database** | MongoDB (v7.x / Community Server), Mongoose (v8.9) |
| **Security** | Helmet, CORS, Express-Rate-Limit, bcryptjs, JSON Web Tokens (JWT) |
| **Testing** | Node.js Test Runner (`node:test`), Supertest, MongoDB Memory Server |

---

## 4. API Endpoints

### Health & Telemetry
- `GET /api/health` — System health, database connection state, and server uptime.

### Authentication & Profiles
- `POST /api/auth/register` — Register a student or faculty account.
- `POST /api/auth/login` — Sign in and receive JWT token.
- `POST /api/auth/logout` — Revoke token session.
- `GET /api/auth/me` — Retrieve authenticated user profile and permissions.
- `PATCH /api/auth/me` — Update phone number, emergency contacts, or preferences.

### Incidents
- `POST /api/incidents` — Submit emergency SOS or incident report.
- `GET /api/incidents` — List incidents (supports search, filter by status, category, severity).
- `GET /api/incidents/:id` — Get detailed incident dossier with status history.
- `GET /api/incidents/my` — Get incident history for the authenticated user.
- `PATCH /api/incidents/:id/status` — Advance status (`Acknowledged`, `Dispatched`, `On Scene`, `Resolved`, `Cancelled`).
- `PATCH /api/incidents/:id/assign` — Assign a patrol unit / responder.
- `PATCH /api/incidents/:id/location` — Update GPS telemetry during transit.
- `POST /api/incidents/:id/notes` — Add dispatch investigation notes.

### Responders
- `GET /api/responders` — List security patrol responders and current availability.
- `GET /api/responders/:id` — Get specific responder details.
- `PATCH /api/responders/:id/status` — Toggle availability (`available`, `busy`, `off_duty`).

### Notifications
- `GET /api/notifications` — Retrieve in-app notifications.
- `GET /api/notifications/unread-count` — Get count of unread notifications.
- `PATCH /api/notifications/:id/read` — Mark notification as read.
- `PATCH /api/notifications/read-all` — Mark all notifications as read.

### Safe Walk
- `POST /api/safewalk/start` — Start campus safe walk session.
- `GET /api/safewalk/my` — Get active safe walk session.
- `PATCH /api/safewalk/:id/end` — Mark safe arrival at destination.
- `POST /api/safewalk/:id/emergency` — Trigger panic alert from active walk session.

### Dashboard & Analytics
- `GET /api/dashboard/summary` — Aggregate metrics (total, active, avg response time, etc.).
- `GET /api/dashboard/incident-trends` — Category and severity aggregation distributions.
- `GET /api/dashboard/responders` — Fleet readiness overview.

### Administration & Audit Logs
- `GET /api/admin/users` — List campus users.
- `PATCH /api/admin/users/:id/role` — Update user role (admin only).
- `PATCH /api/admin/users/:id/status` — Suspend or activate user account.
- `GET /api/admin/audit-logs` — Tamper-evident audit log records.
- `GET /api/admin/contacts` — Public campus emergency directory.
- `POST /api/admin/contacts` — Add new emergency directory contact (admin only).
- `DELETE /api/admin/contacts/:id` — Delete directory contact (admin only).

---

## 5. MongoDB Database Design

The database name is `campusshield`. Collections created and indexed:

1. **`users`**
   - Fields: `name`, `email` (unique, lowercase), `passwordHash`, `identifier` (e.g. Roll No / Staff ID), `phone`, `department`, `role` (`student` | `faculty` | `security` | `admin`), `accountStatus`, `emergencyContact`.
   - Indexes: `{ email: 1 }`, `{ identifier: 1 }`.
2. **`incidents`**
   - Fields: `incidentId` (unique, e.g. `CS-2026-0001`), `reporter` (ref: User), `category`, `description`, `severity` (`critical` | `high` | `medium` | `low`), `status` (`Submitted` | `Acknowledged` | `Assigned` | `Dispatched` | `On Scene` | `Resolved` | `Cancelled`), `location` (`campusLocation`, `coordinates: [longitude, latitude]`, `accuracy`), `assignedResponder` (ref: Responder), timestamps (`reportedAt`, `acknowledgedAt`, `dispatchedAt`, `arrivalAt`, `resolvedAt`), `statusHistory`, `notes`.
   - Indexes: `{ incidentId: 1 }`, `{ status: 1 }`, `{ reportedAt: -1 }`, `{ "location.coordinates": "2dsphere" }`.
3. **`responders`**
   - Fields: `user` (ref: User), `badgeNumber` (unique), `callSign`, `team`, `availabilityStatus` (`available` | `busy` | `off_duty`), `lastKnownLocation`, `activeIncidentCount`.
   - Indexes: `{ badgeNumber: 1 }`, `{ availabilityStatus: 1 }`.
4. **`notifications`**
   - Fields: `recipient` (ref: User), `incident` (ref: Incident), `type`, `title`, `message`, `read`, `readAt`.
   - Indexes: `{ recipient: 1, read: 1 }`, `{ createdAt: -1 }`.
5. **`auditlogs`**
   - Fields: `actor` (ref: User), `actorRole`, `actorName`, `action`, `entityType`, `entityId`, `metadata`, `ipAddress`, `timestamp`.
   - Indexes: `{ timestamp: -1 }`, `{ action: 1 }`, `{ actor: 1 }`.
6. **`safewalksessions`**
   - Fields: `user` (ref: User), `startLocation`, `destination`, `status` (`active` | `completed` | `emergency`), `startedAt`, `endedAt`.
   - Indexes: `{ user: 1, status: 1 }`.
7. **`emergencycontacts`**
   - Fields: `name`, `role`, `phone`, `email`, `location`, `priority`.
   - Indexes: `{ priority: 1 }`.

---

## 6. Windows Setup & Running Instructions

### Prerequisites
- **Node.js**: v18.x or v20+ (Node v24.14.1 is installed and verified on this machine).
- **MongoDB Community Server**: Local service or MongoDB Atlas cluster.
- **MongoDB Compass**: Graphical desktop client for database inspection.

---

### Step 1: Install & Start MongoDB on Windows

#### Option A: Running as a Windows Service (Default)
1. If installed as a Windows Service, open PowerShell as Administrator and run:
   ```powershell
   net start MongoDB
   ```
2. Verify that MongoDB is listening on port 27017:
   ```powershell
   Test-NetConnection -ComputerName 127.0.0.1 -Port 27017
   ```
   *(If `TcpTestSucceeded : True` is returned, MongoDB is running.)*

#### Option B: Running mongod Manually
If MongoDB is not installed as a service, start `mongod` pointing to a local data directory:
```powershell
md C:\data\db -ErrorAction SilentlyContinue
& "C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe" --dbpath="C:\data\db"
```

---

### Step 2: Configure Environment Variables
A configured `.env` file is ready under `backend/.env`.
```ini
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/campusshield
JWT_SECRET=campusshield_kec_secret_key_2026_super_secure
NODE_ENV=development
```

---

### Step 3: Seed Development Database
Populate initial Kongu Engineering College test accounts, responders, verified emergency directory contacts, and sample incidents:
```powershell
npm run seed
```

#### Pre-configured Test Accounts:
| Persona | Email | Password | Role |
|---|---|---|---|
| **Campus Security Officer** | `security.raman@campusshield.kec.edu` | `Password@123` | `security` |
| **Student** | `sumanth@kongu.edu` | `Password@123` | `student` |
| **Administrator** | `admin@campusshield.kec.edu` | `Password@123` | `admin` |
| **Faculty Member** | `faculty.sharma@kongu.edu` | `Password@123` | `faculty` |

*(The frontend also features an instantaneous **1-click Persona Switcher** on the top navigation bar for seamless evaluation without manual credential typing).*

---

### Step 4: Run the Application Server
Start the Express + Socket.IO server:
```powershell
npm start
```
Or with automatic restart during development:
```powershell
npm run dev
```

The application will be live at:
- **Security Personnel Command Center:** [http://localhost:5000/](http://localhost:5000/)
- **Student Safety Portal:** [http://localhost:5000/student](http://localhost:5000/student)
- **Administration & Governance Portal:** [http://localhost:5000/admin](http://localhost:5000/admin)
- **API Health Telemetry Check:** [http://localhost:5000/api/health](http://localhost:5000/api/health)

---

### Step 5: Connecting MongoDB Compass

1. Launch **MongoDB Compass** on Windows.
2. In the connection window, enter the connection URI:
   ```
   mongodb://127.0.0.1:27017/campusshield
   ```
3. Click **Connect**.
4. In the left navigation tree, select the **`campusshield`** database.
5. You can view all collections:
   - `incidents`: Inspect newly reported SOS alerts with coordinates, timestamps, and status history.
   - `users`: View registered students, security staff, and administrators.
   - `responders`: View active patrol units and their availability status.
   - `auditlogs`: View tamper-evident records of security dispatches and role updates.

---

## 7. Automated Test Suite Execution

The repository contains an automated integration test suite validating the entire 15-step core requirement specification using `node:test`, `supertest`, and `mongodb-memory-server` (runs completely self-contained without requiring an external database).

Run the tests:
```powershell
npm test
```

### Verified Test Results (15/15 Passed):
```
✔ Test 1: A student registers and signs in (249ms)
✔ Test 2: A student submits an SOS report (39ms)
✔ Test 3: The incident receives a unique ID and is persisted in MongoDB (3ms)
✔ Test 4: Authorized security personnel see the incident in the queue (18ms)
✔ Test 5: Security acknowledges the incident (24ms)
✔ Test 6: Security assigns an available responder (34ms)
✔ Test 7: The incident status history records every lifecycle change (17ms)
✔ Test 8: The reporter receives permitted in-app updates and notifications (17ms)
✔ Test 9: Security resolves the incident (24ms)
✔ Test 10: The resolved incident remains available in historical records (20ms)
✔ Test 11: Unauthorized users cannot access restricted records or administrative endpoints (26ms)
✔ Test 12: Invalid requests and validation errors produce meaningful error responses (14ms)
✔ Test 13: Dashboard metrics are derived from actual stored database records (23ms)
✔ Test 14: Safe Walk workflow functions properly (23ms)
✔ Test 15: Public Health Check reports real system and database status (5ms)

15 passed, 0 failed
```

---

## 8. End-to-End Emergency Workflow Demonstration

To test the system end-to-end:
1. Open [http://localhost:5000/student](http://localhost:5000/student) in one browser window.
2. Open [http://localhost:5000/](http://localhost:5000/) in a second window side-by-side.
3. In the student window, click the red **ONE-TAP SOS** button.
4. Review the confirmation dialog (safeguard against false alarms) and click **"YES, SEND SOS NOW"**.
5. Observe the live update:
   - The student UI updates immediately with the generated Incident ID (e.g. `CS-2026-0004`) and step 1 of the Live Stepper.
   - The Security Command Center instantly receives a real-time WebSocket alert and displays the incident at the top of the Critical triage queue.
6. In the Security Command Center, click **"Acknowledge Incident"**.
7. In the responder selector, assign **"ALPHA-PATROL (Quick Response Unit)"** and click **"Dispatch Patrol"**.
8. Notice that the student's window automatically updates to Step 3 (*"Patrol Dispatched - Assigned Unit: ALPHA-PATROL"*).
9. Once the situation is handled, click **"Resolve Incident"** in the Command Center and enter resolution notes.
10. The case moves to the *Resolved* historical archive, and the student receives a resolved confirmation notice.

---

## 9. Hardware & Future IoT Integration Architecture

The project documents describe physical IoT safety poles, CCTV feeds, and ESP32 hardware buttons. To ensure absolute transparency and engineering rigor, physical hardware is not fabricated as "operational" when physical devices are not connected. Instead, clear interfaces and REST/WebSocket gateways are defined:

1. **IoT Safety Poles & Physical SOS Buttons (ESP32 / Arduino):**
   - The backend includes an authenticated endpoint `POST /api/incidents` compatible with microcontrollers via Wi-Fi/HTTP.
   - ESP32 hardware can send a JSON payload with an assigned device API Key:
     ```json
     {
       "category": "Emergency",
       "campusLocation": "Safety Pole #04 - Science Block",
       "latitude": 11.2743,
       "longitude": 77.6068,
       "severity": "critical",
       "description": "Hardware panic button triggered on Pole #04."
     }
     ```
2. **CCTV Surveillance Feeds:**
   - The Command Center layout features an authentic CCTV tactical HUD with FPS and timestamp counter, explicitly labeled `[SIMULATED SURVEILLANCE FEED - DEMO]`.
   - When campus RTSP/HLS IP cameras are deployed, video streams can be embedded directly into the dedicated video viewport containers.
3. **SMS / GSM Gateways:**
   - Designed to hook into Twilio or national SMS gateways via notification hooks in `backend/controllers/notificationController.js`.

---

## 10. Contributors

- **Sumanth S** (25ITR146) — Full-Stack Architecture & Security
- **Sangavi S** (25ITR125) — UI Design & Frontend Workflows
- **Thirukumaran S** — Database & Geolocation Telemetry
- **Yazhini S** — Administrative Governance & Audit Systems
- **Department of Information Technology**, Kongu Engineering College (KEC)
