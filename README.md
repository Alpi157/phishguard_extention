# PHISHGUARD KZ

**Anti-phishing and malicious link protection extension**  
**Version: 0.3.1**

---

## 📑 CONTENTS

1. [Purpose and Key Features](#1-purpose-and-key-features)  
2. [Quick Start Guide for End Users](#2-quick-start-guide-for-end-users)  
3. [Repository Structure](#3-repository-structure)  
4. [Technical Architecture](#4-technical-architecture)  
5. [Implementation Details of Subsystems](#5-implementation-details-of-subsystems)  
   - 5.1 Chrome / Edge Extension  
   - 5.2 Local Flask Server  
   - 5.3 ONNX Model: RuBERT tiny2 (fine-tuned on 82,000 examples)  
   - 5.4 GPT Risk Explanation (OpenAI API)  
   - 5.5 Static HTML / JS Analysis Module  
   - 5.6 Hybrid Analysis Sandbox  
   - 5.7 AdBlock (EasyList + Kazakhstani phishing domains)  
   - 5.8 SOC Dashboard and Centralized Incident Log  
   - 5.9 Advanced Scanning Page (VirusTotal + Hybrid Sandbox)  
6. [Privacy and On-Premises Deployment Features](#6-privacy-and-on-premises-deployment-features)  
7. [Roadmap and TODOs](#7-roadmap-and-todos)

---

## 1. Purpose and Key Features

PhishGuard KZ is a client-server solution designed to proactively protect Gmail and Outlook Web users from phishing, malicious links, and infected attachments.

### Distinctive advantages:
- ONNX model inference and initial analysis are performed locally
- Human-readable risk explanations powered by GPT
- Support for Russian and Kazakh languages

### Key Features:
- Local ML model (RuBERT tiny2) analyzes email text
- GPT-based explanations (up to 2,000 emails/month in Pro plan)
- Deep HTML / JS content analysis
- Local brand awareness (Kaspi, Halyk, eGov, etc.)
- QR code link detection and scanning
- Integration with VirusTotal and Hybrid Analysis
- Click-screening for suspicious links
- Dynamic AdBlock activation
- SOC dashboard with charts and AI-powered insights
- On-prem / Private Cloud deployment support

---

## PhishGuard KZ Compared to Alternatives

| Feature / Solution                             | PhishGuard KZ | Google Safe Browsing | Microsoft Defender | Proofpoint Essentials | ZeroFox / Cofense |
|------------------------------------------------|----------------|------------------------|---------------------|------------------------|--------------------|
| Support for Kazakhstani brands (Kaspi, Halyk…)| ✔              | ✖                      | ✖                   | ✖                      | ✖                  |
| Local ML model (offline inference)            | ✔              | ✖                      | ✖                   | ✖                      | ✖                  |
| GPT explanations (RU/KZ)                      | ✔              | ✖                      | ✖                   | ✖                      | ✖                  |
| HTML/JS website analysis                      | ✔              | ∼                      | ✖                   | ∼                      | ✔                  |
| Attachment analysis (PDF, DOCX, HTML…)        | ✔              | ✖                      | ∼                   | ✔                      | ✔                  |
| VirusTotal / Hybrid Analysis                  | ✔              | ∼                      | ✖                   | ✔                      | ✔                  |
| SOC dashboard, analytics                      | ✔ (Enterprise) | ✖                      | ✔                   | ✔                      | ✔                  |
| On-prem / Private Cloud support               | ✔              | ✖                      | ∼                   | ∼                      | ✔                  |
| Russian/Kazakh interface                      | ✔              | ∼                      | ∼                   | ✖                      | ✖                  |
| Gmail, Outlook integration                    | ✔              | ∼                      | ✖                   | ∼                      | ✖                  |

**Legend:**  
✔ — Full support  
∼ — Partial support  
✖ — No support


---


## 2. Quick Start for End Users

### Step 1 — Install the Extension in Your Browser
- Chrome / Edge: Enable Developer Mode → Load unpacked → Select the repository folder

### Step 2 — Start the Local Server
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

### Step 3 — Configure API Keys
- Enter your OpenAI API key (`sk-...`) in the extension popup
- Optionally set VirusTotal and Hybrid Analysis keys if needed

---

## 3. Repository Structure

- `assets/` — icons, logo  
- `libs/` — `jsqr.min.js` and other third-party scripts  
- `phishguard_model_onnx/` — ONNX files for RuBERT tiny2  
- `static/` — `dashboard.css`, `index.js` (scanner UI)  
- `templates/` — `dashboard.html`, `index.html`, `plans.html`  
- `uploads/` — temporary file storage for sandbox analysis  
- `background.js` — extension service worker  
- `content.js` — script running inside Gmail / Outlook tabs  
- `manifest.json` — extension manifest (MV3)  
- `popup.{html,css,js}` — popup UI and logic  
- `server.py` — unified Flask server (API + dashboard + scanner)  
- `filters.json` — EasyList + Kazakhstani phishing domains  
- `incidents.jsonl` — incident log (JSONL format, rotated via cron)

---

## 4. Technical Architecture

```
┌───────────┐ content.js ┌──────────────┐ HTTP/REST ┌───────────────┐
│  Gmail    │←──────────→│ background   │←─────────→│ Flask server  │
│  Outlook  │ postMessage│ service WK   │ 127.0.0.1 │  (server.py)  │
└───────────┘ └──────────────┘             └───────────────┘
       │ Local calls / Web Worker
       │
       │ ONNX runtime (web)
       └────── ML model: RuBERT tiny2 ─────┘
```

- ONNX inference is done in-browser (WebAssembly) or via the local server (CPU).
- `background.js` interacts with OpenAI API, Hybrid Analysis, and AdBlock.
- All external API calls (VT, HA, GPT) are routed through the service worker — fully Manifest V3 compliant.


---


## 5. Subsystem Details

### 5.1 Chrome / Edge / Firefox Extension
- Manifest V3, CSP: `script-src 'self'`
- Popup includes tabs: **"Email"**, **"URL"**, **"Settings"**
- `content.js` uses `MutationObserver` to monitor email content

### 5.2 Flask Server
- `/` — advanced scanning (`index.html`)
- `/dashboard` — SOC dashboard (charts via Chart.js)
- `/classify`, `/url` — ML model API endpoints
- `/api/*` — proxy to VirusTotal and Hybrid Analysis
- `/incidents`, `/incident` — interactions with `incidents.jsonl`

### 5.3 ONNX Model
- RuBERT tiny2 (93 MB)
- Fine-tuned on 92,000 emails
- Accuracy ≈ 0.95, threshold = 0.50

### 5.4 GPT Risk Explanation
- GPT-4o mini, temperature 0.2, max 200 tokens
- Returns strict JSON via system prompt
- Sensitive data is obfuscated before transmission

### 5.5 HTML/JS Analysis
- Loads HTML, scans for `<input>`, `iframe`, `eval`, and IP-based scripts
- Loads up to 3 external JS scripts (≤4 KB each)
- Metadata and snippets are analyzed via GPT auditor

### 5.6 Hybrid Analysis
- Env ID: 100 (Windows 10)
- `/submit/url`, `/submit/file` → `job_id` → polling for results
- File size limit: 25 MB

### 5.7 AdBlock
- `filters.json` contains ~18,000 rules (EasyList + ~2,000 Kazakh domains)
- Uses `updateDynamicRules` (limit: 30,000)

### 5.8 SOC Dashboard
- Four charts: risk level, daily count, weekly trends, top users
- GPT analyzes and highlights attack vectors
- Interactive drill-down by clicking charts

### 5.9 Advanced Scanner
- Built on `index.html` with Bootstrap 5
- Supports URL, domain, and file input (≤32 MB)
- Hybrid Analysis with deferred result polling
- Colored result borders: success, warning, danger

---

## 6. Privacy & On-Prem Deployment

- Full email texts **never** leave the local machine — GPT only receives an anonymized 1 KB summary.
- Full on-premises deployment supported:
```bash
docker compose up
```
- You can specify the `OPENAI_PROXY` variable or use your own Azure OpenAI endpoint.
- SOC dashboard supports internal deployment and can integrate with Syslog / Kafka for SIEM ingestion.

---

## 7. Development Roadmap

- Mobile SDK (Android Share Target + MLKit)
- Support for Thunderbird and Outlook Desktop extensions (MIP Add-ins)
- Vision + NLP models for analyzing embedded images
- IAM authentication for Scanner UI (OIDC / Azure AD)
- Phishing template support specific to the CIS region
- Auto-rotation of `incidents.jsonl` → S3 / MinIO (Parquet format)

---

## License

**MIT License**
