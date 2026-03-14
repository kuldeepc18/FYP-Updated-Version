# Project Setup Guide

This project has three components that need to run simultaneously:

| Component | Tech | Port |
|---|---|---|
| ML Backend | Python / FastAPI | 8000 |
| Admin API | Node.js / Express | 3000 |
| Frontend | Vite + React + TypeScript | 5173 |

---

## Prerequisites

Install the following before starting:

- **Python 3.10+** — https://www.python.org/downloads/
- **Node.js 18+** — https://nodejs.org/

Verify installs:
```bash
python --version
node --version
npm --version
```

---

## Folder Structure

```
new/
├── .venv/                              ← Python virtual environment (you create this)
├── models-20260313T125452Z-1-001/      ← ML Backend
│   ├── app.py
│   ├── predictor_service.py
│   ├── requirements.txt
│   ├── layering.csv
│   ├── spoofing.csv
│   └── models/
│       ├── manipulation_detector.pkl
│       └── feature_cols.pkl
└── FYP-Updated-Version/
    ├── backend/
    │   └── admin-api/                  ← Admin API (Node.js)
    │       ├── server.js
    │       └── package.json
    └── frontend_admin/
        └── sentinel-console-main/      ← Frontend (React)
            ├── src/
            ├── .env
            └── package.json
```

---

## Step 1 — ML Backend (FastAPI)

Open a terminal in the `new/` root folder.

**First time only:**
```bash
# Create virtual environment
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Install dependencies
pip install -r models-20260313T125452Z-1-001/requirements.txt
```

**Every time:**
```bash
# Activate virtual environment (if not already active)
.venv\Scripts\activate

# Start the server
cd models-20260313T125452Z-1-001
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

**Verify:** Open http://127.0.0.1:8000/health — should return `{"status":"ok"}`

You can also open http://127.0.0.1:8000/ for a browser-based upload test page.

---

## Step 2 — Admin API (Node.js)

Open a **new** terminal.

**First time only:**
```bash
cd FYP-Updated-Version\backend\admin-api
npm install
```

**Every time:**
```bash
cd FYP-Updated-Version\backend\admin-api
npm start
```

**Verify:** Open http://localhost:3000/api/admin/health — should return `{"status":"ok"}`

---

## Step 3 — Frontend (React)

Open a **new** terminal.

**First time only:**
```bash
cd FYP-Updated-Version\frontend_admin\sentinel-console-main
npm install
```

**Every time:**
```bash
cd FYP-Updated-Version\frontend_admin\sentinel-console-main
npx vite --host 127.0.0.1 --port 5173
```

**Verify:** Open http://127.0.0.1:5173/

---

## Step 4 — Log In

Go to http://127.0.0.1:5173/ and log in with:

| Field | Value |
|---|---|
| Email | `admin@sentinel.com` |
| Password | `admin123` |

---

## Step 5 — Use the ML Model Page

1. After logging in, navigate to **Admin → ML Model** (or go to `/admin/ml-model`)
2. Upload a CSV file (`layering.csv` or `spoofing.csv` from the `models-20260313T125452Z-1-001/` folder are good test files)
3. Choose output format: `xlsx`, `csv`, or `json`
4. Click **Predict** — results will appear below with a download button
5. Use the **Combined** tab to upload both layering and spoofing CSVs together

---

## Environment Variables

The frontend reads from `FYP-Updated-Version/frontend_admin/sentinel-console-main/.env`:

```env
VITE_API_URL=http://localhost:3000/api/admin
VITE_ML_API_URL=http://127.0.0.1:8000
VITE_WS_URL=ws://localhost:3000
```

These default values work as-is. Only change them if you're running on a different host or port.

---

## Notes

- All 3 processes must be running simultaneously — use 3 separate terminal windows.
- Steps marked **"First time only"** can be skipped on subsequent runs.
- The **Market Data**, **Surveillance**, and **Orders** dashboards require QuestDB running at port `9000`. The **ML Model page works without QuestDB**.
- On macOS/Linux, activate the virtual environment with `source .venv/bin/activate` instead of `.venv\Scripts\activate`.
