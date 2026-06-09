import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np


FINGERS = [
    ("thumb", "拇指", 4, 3),
    ("index", "食指", 8, 7),
    ("middle", "中指", 12, 11),
    ("ring", "无名指", 16, 15),
    ("pinky", "小指", 20, 19),
]


def load_yolo():
    try:
        from ultralytics import YOLO
    except Exception as exc:
        raise RuntimeError("缺少 ultralytics，无法加载 YOLOv8 指甲分割模型。请先安装 ultralytics。") from exc
    return YOLO


def normalize_points(raw):
    arr = np.array(raw, dtype=np.float32)
    arr = np.squeeze(arr)
    if arr.ndim != 2 or arr.shape[0] < 21 or arr.shape[1] < 2:
        return None
    return arr[:, :2]


def load_hands(hand_json_path):
    if not hand_json_path or not Path(hand_json_path).exists():
        return []
    data = json.loads(Path(hand_json_path).read_text(encoding="utf-8"))
    hands = []
    for index, hand in enumerate(data.get("hands", [])):
        points = normalize_points(hand.get("keypoints_2d", []))
        if points is None:
            continue
        bbox = hand.get("bbox") or []
        side = "right" if hand.get("is_right") else "left"
        cam_t = np.array(hand.get("cam_t") or [], dtype=np.float32).squeeze()
        cam_depth = float(cam_t[2]) if cam_t.ndim == 1 and cam_t.shape[0] >= 3 else None
        hands.append({
            "hand_index": index,
            "side": side,
            "side_label": "右手" if side == "right" else "左手",
            "image_side_label": "R" if side == "right" else "L",
            "bbox": bbox,
            "points": points,
            "cam_depth": cam_depth,
            "layer_rank": 0,
        })
    return hands


def point_to_segment_distance(point, start, end):
    point = np.array(point, dtype=np.float32)
    start = np.array(start, dtype=np.float32)
    end = np.array(end, dtype=np.float32)
    vec = end - start
    denom = float(np.dot(vec, vec))
    if denom <= 1e-6:
        return float(np.linalg.norm(point - end))
    t = max(0.0, min(1.0, float(np.dot(point - start, vec) / denom)))
    proj = start + t * vec
    return float(np.linalg.norm(point - proj))


def bbox_threshold(hand, image_shape):
    h, w = image_shape[:2]
    bbox = hand.get("bbox") or []
    if len(bbox) >= 4:
        bw = abs(float(bbox[2]) - float(bbox[0]))
        bh = abs(float(bbox[3]) - float(bbox[1]))
        return max(28.0, 0.12 * max(bw, bh))
    return max(28.0, 0.08 * max(w, h))


def point_in_bbox(point, bbox, padding=0.0):
    if len(bbox) < 4:
        return True
    x, y = point
    x1, y1, x2, y2 = [float(v) for v in bbox[:4]]
    bw = abs(x2 - x1)
    bh = abs(y2 - y1)
    pad = max(bw, bh) * padding
    return (min(x1, x2) - pad) <= x <= (max(x1, x2) + pad) and (min(y1, y2) - pad) <= y <= (max(y1, y2) + pad)


def terminal_segment_score(center, dip, tip):
    center = np.array(center, dtype=np.float32)
    dip = np.array(dip, dtype=np.float32)
    tip = np.array(tip, dtype=np.float32)
    vec = tip - dip
    denom = float(np.dot(vec, vec))
    if denom <= 1e-6:
        return float(np.linalg.norm(center - tip)), 0.0
    t = float(np.dot(center - dip, vec) / denom)
    t_clamped = max(0.0, min(1.0, t))
    proj = dip + t_clamped * vec
    distance = float(np.linalg.norm(center - proj))
    direction_penalty = 0.0
    if t < -0.35:
        direction_penalty = abs(t + 0.35) * 45.0
    elif t > 1.55:
        direction_penalty = abs(t - 1.55) * 45.0
    return distance + direction_penalty, t


def assign_finger(center, hands, image_shape, use_layer=True):
    best = None
    candidates = []
    for hand in hands:
        points = hand["points"]
        threshold = bbox_threshold(hand, image_shape)
        in_hand_bbox = point_in_bbox(center, hand.get("bbox") or [], padding=0.06)
        bbox_penalty = 0.0 if in_hand_bbox else 85.0
        layer_penalty = float(hand.get("layer_rank", 0)) * 18.0 if use_layer else 0.0
        for finger_key, finger_label, tip_idx, dip_idx in FINGERS:
            tip = points[tip_idx]
            dip = points[dip_idx]
            dist_tip = float(np.linalg.norm(np.array(center, dtype=np.float32) - tip))
            dist_seg, projection = terminal_segment_score(center, dip, tip)
            distance = min(dist_tip, dist_seg)
            score = distance + bbox_penalty + layer_penalty
            item = {
                "score": score,
                "distance": distance,
                "projection": projection,
                "threshold": threshold,
                "in_hand_bbox": in_hand_bbox,
                "hand_index": hand["hand_index"],
                "hand_side": hand["side"],
                "hand_side_label": hand["side_label"],
                "image_side_label": hand["image_side_label"],
                "finger": finger_key,
                "finger_label": finger_label,
                "layer_rank": hand.get("layer_rank", 0),
            }
            candidates.append(item)
            if best is None or score < best["score"]:
                best = {
                    **item,
                    "threshold": threshold,
                }
    if not best:
        return None
    assigned = best["distance"] <= best["threshold"] and (best["in_hand_bbox"] or best["distance"] <= best["threshold"] * 0.55)
    candidates = sorted(candidates, key=lambda item: item["score"])[:3]
    return {
        "assigned": bool(assigned),
        "hand_index": best["hand_index"] if assigned else None,
        "hand_side": best["hand_side"] if assigned else None,
        "hand_side_label": best["hand_side_label"] if assigned else None,
        "image_side_label": best["image_side_label"] if assigned else None,
        "finger": best["finger"] if assigned else None,
        "finger_label": best["finger_label"] if assigned else None,
        "distance": round(float(best["distance"]), 2),
        "threshold": round(float(best["threshold"]), 2),
        "score": round(float(best["score"]), 2),
        "layer_rank": best["layer_rank"] if assigned else None,
        "candidates": [{
            "hand_index": item["hand_index"],
            "hand_side_label": item["hand_side_label"],
            "finger_label": item["finger_label"],
            "score": round(float(item["score"]), 2),
            "distance": round(float(item["distance"]), 2),
            "in_hand_bbox": bool(item["in_hand_bbox"]),
            "layer_rank": item["layer_rank"],
        } for item in candidates],
    }


def estimate_hand_layers(hands, detections, image_shape):
    if len(hands) < 2:
        return []

    phase_one = [
        assign_finger(item["center"], hands, image_shape, use_layer=False)
        for item in detections
    ]
    scores = {hand["hand_index"]: 0.0 for hand in hands}
    for item, assignment in zip(detections, phase_one):
        if not assignment or not assignment.get("assigned"):
            continue
        owner = assignment["hand_index"]
        for hand in hands:
            if hand["hand_index"] == owner:
                continue
            if point_in_bbox(item["center"], hand.get("bbox") or [], padding=0.02):
                scores[owner] += 1.0 + max(0.0, float(item.get("confidence", 0.0)))

    if all(score == 0 for score in scores.values()):
        for hand in hands:
            if hand.get("cam_depth") is not None:
                scores[hand["hand_index"]] = -float(hand["cam_depth"])

    ordered = sorted(hands, key=lambda hand: (-scores.get(hand["hand_index"], 0.0), hand["hand_index"]))
    for rank, hand in enumerate(ordered):
        hand["layer_rank"] = rank

    return [{
        "hand_index": hand["hand_index"],
        "hand_side": hand["side"],
        "hand_side_label": hand["side_label"],
        "layer_rank": hand["layer_rank"],
        "foreground_score": round(float(scores.get(hand["hand_index"], 0.0)), 4),
        "cam_depth": hand.get("cam_depth"),
    } for hand in sorted(hands, key=lambda item: item["layer_rank"])]


def polygon_from_mask(mask_xy):
    if mask_xy is None or len(mask_xy) == 0:
        return []
    polygon = np.array(mask_xy, dtype=np.float32)
    if polygon.ndim != 2 or polygon.shape[1] != 2:
        return []
    if len(polygon) > 80:
        step = math.ceil(len(polygon) / 80)
        polygon = polygon[::step]
    return [[round(float(x), 2), round(float(y), 2)] for x, y in polygon]


def oriented_box_from_polygon(polygon, fallback_bbox, scale=1.22):
    if polygon:
        pts = np.array(polygon, dtype=np.float32)
    else:
        x1, y1, x2, y2 = [float(v) for v in fallback_bbox[:4]]
        pts = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32)
    if pts.ndim != 2 or pts.shape[0] < 3 or pts.shape[1] != 2:
        x1, y1, x2, y2 = [float(v) for v in fallback_bbox[:4]]
        pts = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32)

    rect = cv2.minAreaRect(pts)
    (cx, cy), (width, height), angle = rect
    if width <= 0 or height <= 0:
        x1, y1, x2, y2 = [float(v) for v in fallback_bbox[:4]]
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        width, height = abs(x2 - x1), abs(y2 - y1)
        angle = 0.0

    # Make angle follow the nail's long axis. This gives the try-on layer a stable direction.
    if width < height:
        width, height = height, width
        angle += 90.0

    width *= scale
    height *= scale
    box = cv2.boxPoints(((cx, cy), (width, height), angle))
    return {
        "center": [round(float(cx), 2), round(float(cy), 2)],
        "width": round(float(width), 2),
        "height": round(float(height), 2),
        "angle": round(float(angle), 2),
        "points": [[round(float(x), 2), round(float(y), 2)] for x, y in box],
        "scale": scale,
    }


def oriented_box_from_axis(polygon, fallback_bbox, center, axis_angle, scale=1.28):
    if polygon:
        pts = np.array(polygon, dtype=np.float32)
    else:
        x1, y1, x2, y2 = [float(v) for v in fallback_bbox[:4]]
        pts = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32)
    if pts.ndim != 2 or pts.shape[0] < 3 or pts.shape[1] != 2:
        return oriented_box_from_polygon(polygon, fallback_bbox, scale=scale)

    cx, cy = [float(v) for v in center]
    rad = math.radians(float(axis_angle))
    axis = np.array([math.cos(rad), math.sin(rad)], dtype=np.float32)
    normal = np.array([-axis[1], axis[0]], dtype=np.float32)
    rel = pts - np.array([cx, cy], dtype=np.float32)
    along = rel @ axis
    across = rel @ normal
    length = max(8.0, float(along.max() - along.min())) * scale
    width = max(6.0, float(across.max() - across.min())) * scale
    box = cv2.boxPoints(((cx, cy), (length, width), float(axis_angle)))
    return {
        "center": [round(float(cx), 2), round(float(cy), 2)],
        "width": round(float(length), 2),
        "height": round(float(width), 2),
        "angle": round(float(axis_angle), 2),
        "points": [[round(float(x), 2), round(float(y), 2)] for x, y in box],
        "scale": scale,
        "source": "finger_axis",
    }


def finger_axis_angle(assignment, hands):
    if not assignment or not assignment.get("assigned"):
        return None
    hand_index = assignment.get("hand_index")
    finger_key = assignment.get("finger")
    finger = next((item for item in FINGERS if item[0] == finger_key), None)
    hand = next((item for item in hands if item["hand_index"] == hand_index), None)
    if not finger or not hand:
        return None
    _, _, tip_idx, dip_idx = finger
    points = hand["points"]
    dip = points[dip_idx]
    tip = points[tip_idx]
    vec = tip - dip
    if float(np.linalg.norm(vec)) <= 1e-6:
        return None
    return math.degrees(math.atan2(float(vec[1]), float(vec[0])))


def vector_from_angle(angle):
    if angle is None:
        return None
    rad = math.radians(float(angle))
    return [round(math.cos(rad), 4), round(math.sin(rad), 4)]


def draw_transparent_polygon(image, polygon, color):
    if not polygon:
        return
    pts = np.array(polygon, dtype=np.int32)
    overlay = image.copy()
    cv2.fillPoly(overlay, [pts], color)
    cv2.addWeighted(overlay, 0.28, image, 0.72, 0, dst=image)
    cv2.polylines(image, [pts], True, color, 2)


def draw_oriented_box(image, oriented_box, color):
    points = oriented_box.get("points") or []
    if len(points) < 4:
        return
    pts = np.array(points, dtype=np.int32)
    cv2.polylines(image, [pts], True, color, 2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--json-output", required=True)
    parser.add_argument("--hand-json")
    parser.add_argument("--conf", type=float, default=0.25)
    args = parser.parse_args()

    YOLO = load_yolo()
    image = cv2.imread(args.image)
    if image is None:
        raise RuntimeError(f"无法读取图片：{args.image}")

    hands = load_hands(args.hand_json)
    model = YOLO(args.model)
    result = model(image, conf=args.conf, verbose=False)[0]

    detections = []
    names = getattr(result, "names", {}) or {}
    masks_xy = result.masks.xy if result.masks is not None else []
    boxes = result.boxes

    for index, box in enumerate(boxes):
        xyxy = box.xyxy[0].detach().cpu().numpy().astype(float).tolist()
        conf = float(box.conf[0].detach().cpu().item()) if box.conf is not None else 0.0
        cls_id = int(box.cls[0].detach().cpu().item()) if box.cls is not None else 0
        x1, y1, x2, y2 = xyxy
        center = [(x1 + x2) / 2, (y1 + y2) / 2]
        polygon = polygon_from_mask(masks_xy[index] if index < len(masks_xy) else None)
        oriented_box = oriented_box_from_polygon(polygon, xyxy)
        detections.append({
            "id": index + 1,
            "class_id": cls_id,
            "class_name": names.get(cls_id, str(cls_id)) if isinstance(names, dict) else str(cls_id),
            "confidence": round(conf, 4),
            "bbox": [round(float(v), 2) for v in xyxy],
            "center": oriented_box["center"],
            "polygon": polygon,
            "oriented_box": oriented_box,
        })

    hand_layers = estimate_hand_layers(hands, detections, image.shape)

    for item in detections:
        x1, y1, x2, y2 = item["bbox"]
        center = item["center"]
        polygon = item["polygon"]
        assignment = assign_finger(center, hands, image.shape)
        axis_angle = finger_axis_angle(assignment, hands)
        oriented_box = oriented_box_from_axis(polygon, item["bbox"], center, axis_angle) if axis_angle is not None else item["oriented_box"]
        item["oriented_box"] = oriented_box
        item["finger_axis_angle"] = round(float(axis_angle), 2) if axis_angle is not None else None
        item["long_axis_vector"] = vector_from_angle(axis_angle)
        item["ai_orientation"] = {
            "center": oriented_box.get("center"),
            "oriented_box_points": oriented_box.get("points") or [],
            "angle_degrees": item["finger_axis_angle"],
            "long_axis_vector": item["long_axis_vector"],
            "instruction": "Only use this metadata for nail-art alignment. Do not draw labels, arrows, or overlays on the nail."
        }

        color = (68, 154, 139)
        if polygon:
            cv2.polylines(image, [np.array(polygon, dtype=np.int32)], True, color, 2)
        cv2.rectangle(image, (int(x1), int(y1)), (int(x2), int(y2)), (120, 120, 120), 1)
        draw_oriented_box(image, oriented_box, (217, 79, 85))
        item["assignment"] = assignment

    ai_orientation_payload = [{
        "nail_id": item.get("id"),
        "finger": (item.get("assignment") or {}).get("finger"),
        "finger_label": (item.get("assignment") or {}).get("finger_label"),
        "hand_side": (item.get("assignment") or {}).get("hand_side"),
        "hand_side_label": (item.get("assignment") or {}).get("hand_side_label"),
        **item.get("ai_orientation", {})
    } for item in detections]

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.json_output).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(args.output, image)
    Path(args.json_output).write_text(json.dumps({
        "num_nails": len(detections),
        "detections": detections,
        "ai_orientation_payload": ai_orientation_payload,
        "ai_orientation_note": "Use ai_orientation_payload to align nail art. Keep the uploaded hand photo unchanged except the nail surfaces; never render these boxes, labels, arrows, or metadata in the final image.",
        "hand_count": len(hands),
        "hand_layers": hand_layers,
        "message": "Success",
    }, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
