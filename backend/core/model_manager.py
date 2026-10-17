"""
YOLO Model Manager — handles loading, inference, and hot-swap of the
detection model. Supports both ONNX Runtime and Ultralytics PyTorch.
"""

import json
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any

import cv2
import numpy as np
from PIL import Image


def _iou(box: np.ndarray, boxes: np.ndarray) -> np.ndarray:
    """
    IoU between one xyxy box (shape (4,)) and an array of xyxy boxes
    (shape (N, 4)). Returns shape (N,).
    """
    if boxes.shape[0] == 0:
        return np.empty((0,), dtype=np.float32)

    x1 = np.maximum(box[0], boxes[:, 0])
    y1 = np.maximum(box[1], boxes[:, 1])
    x2 = np.minimum(box[2], boxes[:, 2])
    y2 = np.minimum(box[3], boxes[:, 3])

    inter_w = np.clip(x2 - x1, 0, None)
    inter_h = np.clip(y2 - y1, 0, None)
    intersection = inter_w * inter_h

    area_box = max(0.0, float(box[2] - box[0])) * max(0.0, float(box[3] - box[1]))
    area_boxes = np.clip(boxes[:, 2] - boxes[:, 0], 0, None) * np.clip(boxes[:, 3] - boxes[:, 1], 0, None)
    union = area_box + area_boxes - intersection

    return np.where(union > 0, intersection / union, 0.0)


class ModelManager:
    """
    Thread-safe model manager that supports:
    - ONNX Runtime inference (default, 22% faster on CPU)
    - Ultralytics PyTorch fallback
    - Hot-swap model replacement without server restart
    - Automatic backup rotation (keeps last 3 versions)
    """

    def __init__(self, config: dict, base_dir: Path):
        self.config = config
        self.base_dir = base_dir
        self.model = None
        self.class_names: Dict[int, str] = {}
        self.class_count: int = 0
        self.lock = threading.Lock()
        self._use_onnx = False
        self._onnx_session = None

    def load(self) -> None:
        """Load the model and class names from config paths."""
        model_config = self.config["model"]
        model_path = self.base_dir / model_config["path"]
        classes_path = self.base_dir / model_config["classes_file"]

        # Load class name mapping
        with open(classes_path, "r", encoding="utf-8") as f:
            classes_data = json.load(f)

        # Support both {"0": "name"} and {"class_name_map": {"0": "name"}} formats
        if "class_name_map" in classes_data:
            raw_map = classes_data["class_name_map"]
        elif "all_classes" in classes_data:
            raw_map = classes_data["all_classes"]
        else:
            raw_map = classes_data

        self.class_names = {int(k): v for k, v in raw_map.items()}
        self.class_count = len(self.class_names)

        # Determine model type
        model_path_str = str(model_path)
        if model_path_str.endswith(".onnx"):
            self._load_onnx(model_path_str)
        else:
            self._load_ultralytics(model_path_str)

        print(f"  -> {self.class_count} classes loaded")

    def _load_onnx(self, model_path: str) -> None:
        """Load ONNX model using ONNX Runtime."""
        import onnxruntime as ort
        self._onnx_session = ort.InferenceSession(
            model_path,
            providers=["CPUExecutionProvider"],
        )
        self._use_onnx = True
        print(f"  -> ONNX Runtime model loaded from {model_path}")

    def _load_ultralytics(self, model_path: str) -> None:
        """Load PyTorch model using Ultralytics."""
        from ultralytics import YOLO
        device = self.config["model"].get("device", "cpu")
        self.model = YOLO(model_path)
        if device != "cpu":
            self.model.to(device)
        self._use_onnx = False
        print(f"  -> Ultralytics model loaded from {model_path}")

    def predict(self, image: Image.Image) -> List[Dict[str, Any]]:
        """
        Run inference on a PIL Image.
        Returns list of detections: [{"class_id", "name", "confidence", "bbox"}]
        """
        conf_threshold = self.config["model"].get("confidence_threshold", 0.65)
        input_size = self.config["model"].get("input_size", 640)

        with self.lock:
            if self._use_onnx:
                return self._predict_onnx(image, conf_threshold, input_size)
            else:
                return self._predict_ultralytics(image, conf_threshold)

    @staticmethod
    def _norm_label(name: str) -> str:
        return " ".join(name.lower().split())

    def _predict_ultralytics(self, image: Image.Image, conf_threshold: float) -> List[Dict[str, Any]]:
        """Run Ultralytics YOLO inference with canonical-name NMS deduplication."""
        results = self.model.predict(
            source=image,
            conf=conf_threshold,
            verbose=False,
        )

        raw_boxes = []
        raw_scores = []
        raw_cids = []
        raw_labels = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                class_id = int(box.cls[0].item())
                confidence = float(box.conf[0].item())
                bbox = box.xyxy[0].tolist()
                name = self.class_names.get(class_id, f"Unknown ({class_id})")
                raw_boxes.append(bbox)
                raw_scores.append(confidence)
                raw_cids.append(class_id)
                raw_labels.append(self._norm_label(name))

        if not raw_boxes:
            return []

        iou_threshold = self.config["model"].get("iou_threshold", 0.45)
        keep_idx = self._nms_per_class(
            np.array(raw_boxes, dtype=np.float32),
            np.array(raw_scores, dtype=np.float32),
            np.array(raw_labels),
            iou_threshold,
        )

        detections = []
        for i in keep_idx:
            cid = raw_cids[i]
            name = self.class_names.get(cid, f"Unknown ({cid})")
            detections.append({
                "class_id": cid,
                "name": name,
                "confidence": round(raw_scores[i], 4),
                "bbox": [round(c, 1) for c in raw_boxes[i]],
            })

        return detections

    def _predict_onnx(self, image: Image.Image, conf_threshold: float, input_size: int) -> List[Dict[str, Any]]:
        """Run ONNX Runtime inference with manual NMS grouped by canonical dish name."""
        # Preprocess: resize, normalize, transpose to NCHW
        img_np = np.array(image.convert("RGB"))
        orig_h, orig_w = img_np.shape[:2]
        img_resized = cv2.resize(img_np, (input_size, input_size))
        img_float = img_resized.astype(np.float32) / 255.0
        img_transposed = np.transpose(img_float, (2, 0, 1))  # HWC → CHW
        img_batch = np.expand_dims(img_transposed, axis=0)     # Add batch dim

        # Run inference
        input_name = self._onnx_session.get_inputs()[0].name
        outputs = self._onnx_session.run(None, {input_name: img_batch})

        # Parse YOLO output: shape (1, num_classes+4, num_detections)
        output = outputs[0]  # (1, 4+num_classes, N)
        if output.ndim == 3:
            output = output[0]  # (4+num_classes, N)

        # Transpose to (N, 4+num_classes)
        if output.shape[0] < output.shape[1]:
            output = output.T  # Now (N, 4+num_classes)

        # --- Vectorized candidate extraction ---
        # Pull the highest class score per detection, then filter by conf.
        boxes_cxcywh = output[:, :4]                  # (N, 4) center format
        class_scores = output[:, 4:]                  # (N, num_classes)
        max_score = class_scores.max(axis=1)          # (N,)
        class_ids = class_scores.argmax(axis=1)       # (N,)

        keep_mask = max_score >= conf_threshold
        boxes_cxcywh = boxes_cxcywh[keep_mask]
        max_score = max_score[keep_mask]
        class_ids = class_ids[keep_mask]

        if boxes_cxcywh.shape[0] == 0:
            return []

        # Convert center-format (cx, cy, w, h) → corner-format (x1, y1, x2, y2)
        # and scale from input_size back to original image pixels.
        scale_x = orig_w / input_size
        scale_y = orig_h / input_size
        cx, cy, w, h = boxes_cxcywh[:, 0], boxes_cxcywh[:, 1], boxes_cxcywh[:, 2], boxes_cxcywh[:, 3]
        boxes_xyxy = np.stack([
            (cx - w / 2) * scale_x,
            (cy - h / 2) * scale_y,
            (cx + w / 2) * scale_x,
            (cy + h / 2) * scale_y,
        ], axis=1)

        # Map integer class_ids to normalized canonical dish names so duplicate
        # YOLO class IDs (e.g. class 1 and class 105) suppress each other in NMS.
        norm_labels = np.array([
            self._norm_label(self.class_names.get(int(cid), f"Unknown ({int(cid)})"))
            for cid in class_ids
        ])

        iou_threshold = self.config["model"].get("iou_threshold", 0.45)
        keep_idx = self._nms_per_class(boxes_xyxy, max_score, norm_labels, iou_threshold)

        detections = []
        for i in keep_idx:
            cid = int(class_ids[i])
            name = self.class_names.get(cid, f"Unknown ({cid})")
            x1, y1, x2, y2 = boxes_xyxy[i]
            detections.append({
                "class_id": cid,
                "name": name,
                "confidence": round(float(max_score[i]), 4),
                "bbox": [round(float(x1), 1), round(float(y1), 1), round(float(x2), 1), round(float(y2), 1)],
            })

        return detections

    @staticmethod
    def _nms_per_class(
        boxes: np.ndarray,
        scores: np.ndarray,
        class_ids: np.ndarray,
        iou_threshold: float,
    ) -> List[int]:
        """
        Greedy per-class Non-Maximum Suppression.

        `class_ids` can be an array of integer IDs or normalized canonical
        dish name strings. Suppresses overlapping same-class boxes, keeping
        the highest-confidence one. Returns indices of kept boxes sorted by
        descending confidence.
        """
        if boxes.shape[0] == 0:
            return []

        order = np.argsort(-scores)               # highest confidence first
        kept: List[int] = []

        while order.size > 0:
            i = int(order[0])
            kept.append(i)
            if order.size == 1:
                break

            rest = order[1:]
            # Only suppress same-class boxes that overlap enough.
            same_class = class_ids[rest] == class_ids[i]
            ious = _iou(boxes[i], boxes[rest])
            # Keep a box iff it's a different class OR overlaps below threshold.
            survivors = ~same_class | (ious <= iou_threshold)
            order = rest[survivors]

        return kept

    def hot_swap(self, new_model_path: Path, new_version: str) -> Dict[str, Any]:
        """
        Replace the active model with a new one.
        1. Validate new model
        2. Backup current model
        3. Copy new model into place
        4. Reload in memory
        """
        model_config = self.config["model"]
        current_path = self.base_dir / model_config["path"]
        backup_dir = self.base_dir / self.config["backup"]["directory"]
        max_versions = self.config["backup"].get("max_versions", 3)

        # Validate new model by loading it
        test_manager = ModelManager(self.config, self.base_dir)
        try:
            if str(new_model_path).endswith(".onnx"):
                test_manager._load_onnx(str(new_model_path))
            else:
                test_manager._load_ultralytics(str(new_model_path))
        except Exception as e:
            raise ValueError(f"Invalid model file: {e}")

        # Backup current model
        backup_dir.mkdir(parents=True, exist_ok=True)
        current_version = model_config.get("version", "v0")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        suffix = current_path.suffix
        backup_name = f"best_{current_version}_{timestamp}{suffix}"
        backup_path = backup_dir / backup_name

        if current_path.exists():
            shutil.copy2(current_path, backup_path)

        # Rotate old backups (keep only max_versions)
        backups = sorted(backup_dir.glob(f"best_*{suffix}"), key=lambda p: p.stat().st_mtime)
        while len(backups) > max_versions:
            oldest = backups.pop(0)
            oldest.unlink()

        # Copy new model into place
        shutil.copy2(new_model_path, current_path)

        # Hot-reload model in memory
        with self.lock:
            if str(current_path).endswith(".onnx"):
                self._load_onnx(str(current_path))
            else:
                self._load_ultralytics(str(current_path))

        return {
            "status": "ok",
            "class_count": self.class_count,
            "version": new_version,
            "backup": str(backup_path),
        }
