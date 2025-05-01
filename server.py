import math
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import onnxruntime as ort
from transformers import AutoTokenizer
import torch
import re, requests, html

MODEL_DIR = "./phishguard_model_onnx"
PHISH_INDEX = 0
PHISH_THRESHOLD = 0.50


session    = ort.InferenceSession(f"{MODEL_DIR}/model.onnx")
tokenizer  = AutoTokenizer.from_pretrained(MODEL_DIR)

app = Flask(__name__)
CORS(app)              


def predict_proba(text: str) -> float:
    enc = tokenizer(
        text,
        truncation=True,
        padding="max_length",
        max_length=256,
        return_tensors="np",
    )

    ort_inputs = {
        "input_ids":      enc["input_ids"].astype("int64"),
        "attention_mask": enc["attention_mask"].astype("int64"),
        "token_type_ids": enc.get(
            "token_type_ids",
            np.zeros_like(enc["input_ids"])
        ).astype("int64"),
    }

    logits = session.run(None, ort_inputs)[0]   
    probs  = torch.softmax(torch.tensor(logits[0]), dim=-1)
    score  = float(probs[PHISH_INDEX])           

    return score

@app.route("/classify", methods=["POST"])
def classify():
    data = request.get_json(force=True)
    text = data.get("text", "")
    if not text.strip():
        return jsonify({"error": "empty text"}), 400

    score = predict_proba(text)
    is_phish = score >= PHISH_THRESHOLD

    return jsonify({"score": score, "phish": is_phish})


TAG_RE = re.compile(r"<[^>]+>")
KEYWORDS = re.compile(r"(login|password|verify|signin|bank|card|account)", re.I)

def url_score(url: str) -> float:
    """Скачиваем HTML как текст, отдаём его в ту же BERT-модель."""
    try:
        resp = requests.get(url, timeout=5, allow_redirects=True, headers={"User-Agent":"Mozilla"})
        html_text = html.unescape(resp.text)
    except Exception:
        return 1.0

    # огрублённая очистка
    text = TAG_RE.sub(" ", html_text)
    if KEYWORDS.search(text):
        text += " possible phishing keywords"

    return predict_proba(text)

@app.route("/url", methods=["POST"])
def url_endpoint():
    data = request.get_json(force=True)
    url  = data.get("url","").strip()
    if not url.startswith(("http://","https://")):
        return jsonify({"error":"bad url"}),400

    score = url_score(url)
    return jsonify({"score":score, "phish":score>=PHISH_THRESHOLD})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
