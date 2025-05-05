import os
import time
import base64
import json
import math
import numpy as np
import requests
import onnxruntime as ort
import torch
import re
import html
from datetime import datetime
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from transformers import AutoTokenizer
from urllib.parse import urlparse
from werkzeug.utils import secure_filename

MODEL_DIR = "./phishguard_model_onnx"
PHISH_INDEX = 0
PHISH_THRESHOLD = 0.50
INCIDENTS_FILE = "incidents.jsonl"
UPLOAD_FOLDER = "uploads"
MAX_HYBRID_FILE_SIZE = 25 * 1024 * 1024

app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static"
)
CORS(app)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

from dotenv import load_dotenv
load_dotenv()
VT_KEY = os.getenv('VT_API_KEY')
if not VT_KEY:
    raise RuntimeError("VT_API_KEY не задана в .env")
HYBRID_KEY = os.getenv('HYBRID_API_KEY')
if not HYBRID_KEY:
    raise RuntimeError("HYBRID_API_KEY не задана в .env")
HYBRID_BASE_URL = os.getenv('HYBRID_BASE_URL', 'https://www.hybrid-analysis.com/api/v2')
HYBRID_HEADERS = {
    'User-Agent': 'FalconSandboxScript/1.0',
    'api-key':    HYBRID_KEY,
}

session = ort.InferenceSession(f"{MODEL_DIR}/model.onnx")
tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
TAG_RE = re.compile(r"<[^>]+>")
KEYWORDS = re.compile(r"(login|password|verify|signin|bank|card|account)", re.I)


def predict_proba(text: str) -> float:
    enc = tokenizer(
        text,
        truncation=True,
        padding="max_length",
        max_length=256,
        return_tensors="np",
    )
    ort_inputs = {
        "input_ids": enc["input_ids"].astype('int64'),
        "attention_mask": enc["attention_mask"].astype('int64'),
        "token_type_ids": enc.get("token_type_ids", np.zeros_like(enc["input_ids"]))
                              .astype('int64'),
    }
    logits = session.run(None, ort_inputs)[0]
    probs = torch.softmax(torch.tensor(logits[0]), dim=-1)
    return float(probs[PHISH_INDEX])

def is_valid_url(url: str) -> bool:
    p = urlparse(url)
    return p.scheme in ('http', 'https') and p.netloc and '.' in p.netloc


def scan_url_virustotal(url: str) -> dict:
    import base64 as _b64
    url_id = _b64.urlsafe_b64encode(url.encode()).decode().rstrip('=')
    resp = requests.get(f'https://www.virustotal.com/api/v3/urls/{url_id}',
                        headers={'x-apikey': VT_KEY})
    resp.raise_for_status()
    return resp.json()

def scan_domain_virustotal(domain: str) -> dict:
    resp = requests.get(f'https://www.virustotal.com/api/v3/domains/{domain}',
                        headers={'x-apikey': VT_KEY})
    resp.raise_for_status()
    return resp.json()

def scan_file_virustotal(path: str) -> dict:
    with open(path, 'rb') as f:
        upload = requests.post('https://www.virustotal.com/api/v3/files',
                               headers={'x-apikey': VT_KEY},
                               files={'file': (os.path.basename(path), f)})
    upload.raise_for_status()
    data_id = upload.json()['data']['id']
    decoded = base64.b64decode(data_id).decode()
    sha256 = decoded.split(':', 1)[0]
    stat = requests.get(f'https://www.virustotal.com/api/v3/files/{sha256}',
                        headers={'x-apikey': VT_KEY})
    stat.raise_for_status()
    return stat.json()


def hybrid_submit_url(url: str) -> str:
    resp = requests.post(f"{HYBRID_BASE_URL}/submit/url",
                         headers=HYBRID_HEADERS,
                         data={'url': url, 'environment_id': 100})
    resp.raise_for_status()
    job_id = resp.json().get('job_id')
    if not job_id:
        raise RuntimeError(f"Hybrid Analysis: нет job_id: {resp.json()}")
    return job_id

def hybrid_submit_file(path: str) -> str:
    with open(path, 'rb') as f:
        resp = requests.post(f"{HYBRID_BASE_URL}/submit/file",
                             headers=HYBRID_HEADERS,
                             files={'file': (os.path.basename(path), f)},
                             data={'environment_id':100})
    resp.raise_for_status()
    job_id = resp.json().get('job_id')
    if not job_id:
        raise RuntimeError(f"Hybrid Analysis: нет job_id: {resp.json()}")
    return job_id

def hybrid_wait_for_summary(job_id: str, timeout: int = 300, interval: int = 5) -> dict:
    candidates = [
        f"{HYBRID_BASE_URL}/reports/{job_id}/summary",
        f"{HYBRID_BASE_URL}/report/{job_id}/summary"
    ]
    deadline = time.time() + timeout
    while time.time() < deadline:
        for url in candidates:
            resp = requests.get(url, headers=HYBRID_HEADERS)
            if resp.status_code == 410:
                raise RuntimeError("Hybrid: архивы не поддерживаются")
            if resp.status_code == 404:
                continue
            resp.raise_for_status()
            summary = resp.json()
            if summary.get('state') == 'ERROR':
                return summary
            if summary.get('av_detect') is not None or summary.get('verdict'):
                return summary
        time.sleep(interval)
    raise TimeoutError(f"Hybrid timeout {timeout}s")


def append_incident(record: dict):
    with open(INCIDENTS_FILE, 'a', encoding='utf-8') as f:
        json.dump(record, f, ensure_ascii=False)
        f.write('\n')


@app.route('/classify', methods=['POST'])
def classify():
    data = request.get_json(force=True)
    text = data.get('text','').strip()
    if not text:
        return jsonify({'error':'empty text'}),400
    score = predict_proba(text)
    return jsonify({'score':score,'phish':score>=PHISH_THRESHOLD})

@app.route('/url', methods=['POST'])
def url_endpoint():
    data = request.get_json(force=True)
    url  = data.get('url','').strip()
    if not url.startswith(('http://','https://')):
        return jsonify({'error':'bad url'}),400
    try:
        resp = requests.get(url, timeout=5, headers={'User-Agent':'Mozilla'})
        txt = html.unescape(resp.text)
    except:
        score = 1.0
    else:
        txt = TAG_RE.sub(' ', txt)
        if KEYWORDS.search(txt): txt += ' possible phishing keywords'
        score = predict_proba(txt)
    return jsonify({'score':score,'phish':score>=PHISH_THRESHOLD})


@app.route('/incident', methods=['POST'])
def report_incident():
    data = request.get_json(force=True)
    for k in ('user','risk','text','explanation'):
        if k not in data:
            return jsonify({'error':f'missing field {k}'}),400
    data.setdefault('timestamp',datetime.utcnow().isoformat()+'Z')
    append_incident(data)
    return jsonify({'ok':True}),201

@app.route('/incidents', methods=['GET'])
def list_incidents():
    limit = int(request.args.get('limit',100))
    out = []
    if os.path.exists(INCIDENTS_FILE):
        lines = open(INCIDENTS_FILE, encoding='utf-8').read().splitlines()[-limit:]
        for ln in lines:
            try: out.append(json.loads(ln))
            except: pass
    return jsonify(out)


@app.route('/')
def index():
    return render_template('dashboard.html')

@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')

@app.route('/plans')
def plans():
    return render_template('plans.html')

@app.route('/scanner')
def scanner():
    return render_template('index.html')

@app.route('/api/scan_url', methods=['POST'])
def api_scan_url():
    url = (request.json or {}).get('url')
    if not url:
        return jsonify({'error':'URL not provided'}),400
    try:
        return jsonify(scan_url_virustotal(url))
    except Exception as e:
        return jsonify({'error':str(e)}),400

@app.route('/api/scan_domain', methods=['POST'])
def api_scan_domain():
    dom = (request.json or {}).get('domain')
    if not dom:
        return jsonify({'error':'Domain not provided'}),400
    try:
        return jsonify(scan_domain_virustotal(dom))
    except Exception as e:
        return jsonify({'error':str(e)}),400

@app.route('/api/scan_file', methods=['POST'])
def api_scan_file():
    if 'file' not in request.files:
        return jsonify({'error':'No file uploaded'}),400
    f = request.files['file']
    fn = secure_filename(f.filename)
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    path = os.path.join(UPLOAD_FOLDER, fn)
    f.save(path)
    try:
        return jsonify(scan_file_virustotal(path))
    except Exception as e:
        return jsonify({'error':str(e)}),400

@app.route('/api/hybrid/url', methods=['POST'])
def api_hybrid_url():
    url = (request.json or {}).get('url')
    if not url or not is_valid_url(url):
        return jsonify({'error':'Invalid URL'}),400
    try:
        jid = hybrid_submit_url(url)
        summ = hybrid_wait_for_summary(jid)
        return jsonify(summ)
    except Exception as e:
        return jsonify({'error':str(e)}),400

@app.route('/api/hybrid/file', methods=['POST'])
def api_hybrid_file():
    if 'file' not in request.files:
        return jsonify({'error':'No file uploaded'}),400
    f = request.files['file']
    fn = secure_filename(f.filename)
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    path = os.path.join(UPLOAD_FOLDER, fn)
    f.save(path)
    if os.path.getsize(path) > MAX_HYBRID_FILE_SIZE:
        return jsonify({'error':'File too large'}),400
    try:
        jid = hybrid_submit_file(path)
        summ = hybrid_wait_for_summary(jid)
        return jsonify(summ)
    except Exception as e:
        return jsonify({'error':str(e)}),400


if __name__ == '__main__':
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    if not os.path.exists(INCIDENTS_FILE):
        open(INCIDENTS_FILE,'w',encoding='utf-8').close()
    app.run(host='0.0.0.0', port=8000, debug=True)
