import math
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import onnxruntime as ort
from transformers import AutoTokenizer
import torch

MODEL_DIR = "./phishguard_model_onnx"
PHISH_INDEX = 0        
PHISH_THRESHOLD = 0.80


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

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
