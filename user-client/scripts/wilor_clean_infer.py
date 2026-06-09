"""
Clean WiLoR inference runner.

This follows the official WiLoR demo flow:
1. detect hands with the YOLO hand detector
2. run WiLoR on padded hand crops
3. apply the left/right camera and geometry corrections
4. project 3D joints back to full-image 2D
5. optionally render the 3D MANO mesh overlay

The old service returns very large payloads by default and mixes API, drawing,
and rendering. This file keeps those concerns explicit.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import traceback
from pathlib import Path
from typing import Any

# Match the official Gradio demo. The existing container can inherit an osmesa
# value, which breaks rendering in this environment.
os.environ["PYOPENGL_PLATFORM"] = "egl"

import cv2
import numpy as np
import torch


LIGHT_PURPLE = (0.25098039, 0.274117647, 0.65882353)
HAND_MESH_COLORS = {
    "right": (1.0, 0.18, 0.18),
    "left": (0.18, 0.85, 0.25),
}
FINGER_CHAINS = {
    "thumb": [0, 1, 2, 3, 4],
    "index": [0, 5, 6, 7, 8],
    "middle": [0, 9, 10, 11, 12],
    "ring": [0, 13, 14, 15, 16],
    "pinky": [0, 17, 18, 19, 20],
}
FINGER_ORDER = {name: index for index, name in enumerate(FINGER_CHAINS)}
FINGER_TIPS = {
    "thumb": (3, 4),
    "index": (7, 8),
    "middle": (11, 12),
    "ring": (15, 16),
    "pinky": (19, 20),
}


def to_jsonable(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, dict):
        return {key: to_jsonable(val) for key, val in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    return value


def load_pipeline(model_root: str, device_name: str = "auto", verbose: bool = False):
    try:
        from wilor_mini.pipelines.wilor_hand_pose3d_estimation_pipeline import (
            WiLorHandPose3dEstimationPipeline,
        )
    except Exception as exc:
        raise RuntimeError(
            "找不到 wilor_mini。请在 nail-api 容器内运行，或安装 WiLoR-mini 依赖。"
        ) from exc

    if device_name == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(device_name)

    return WiLorHandPose3dEstimationPipeline(
        device=device,
        dtype=torch.float32,
        wilor_pretrained_dir=model_root,
        verbose=verbose,
    )


def run_wilor(image_bgr: np.ndarray, model_root: str, hand_conf: float, rescale_factor: float, device: str, verbose: bool):
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    pipeline = load_pipeline(model_root, device_name=device, verbose=verbose)
    return pipeline.predict(image_rgb, hand_conf=hand_conf, rescale_factor=rescale_factor)


def summarize_results(results: list[dict[str, Any]], include_vertices: bool = False) -> dict[str, Any]:
    hands = []
    for index, result in enumerate(results):
        preds = result.get("wilor_preds") or {}
        keypoints_2d = np.asarray(preds.get("pred_keypoints_2d", []), dtype=np.float32).squeeze()
        keypoints_3d = np.asarray(preds.get("pred_keypoints_3d", []), dtype=np.float32).squeeze()
        vertices = np.asarray(preds.get("pred_vertices", []), dtype=np.float32).squeeze()
        cam_t = np.asarray(preds.get("pred_cam_t_full", []), dtype=np.float32).squeeze()
        focal = float(np.asarray(preds.get("scaled_focal_length", 0.0)).squeeze()) if preds else None
        is_right = bool(result.get("is_right", 1))

        hand = {
            "hand_index": index,
            "is_right": is_right,
            "hand_side": "right" if is_right else "left",
            "hand_side_label": "右手" if is_right else "左手",
            "bbox": result.get("hand_bbox", []),
            "keypoints_2d": keypoints_2d.tolist() if keypoints_2d.size else None,
            "keypoints_3d": keypoints_3d.tolist() if keypoints_3d.size else None,
            "cam_t": cam_t.tolist() if cam_t.size else None,
            "focal_length": focal,
            "finger_axes": finger_axes_from_keypoints(keypoints_2d) if keypoints_2d.size else {},
        }
        if include_vertices:
            hand["vertices"] = vertices.tolist() if vertices.size else None
        hands.append(hand)

    return {"num_hands": len(hands), "hands": hands, "message": "Success"}


def finger_axes_from_keypoints(keypoints_2d: np.ndarray) -> dict[str, dict[str, Any]]:
    axes = {}
    if keypoints_2d.ndim != 2 or keypoints_2d.shape[0] < 21:
        return axes
    for name, (dip_idx, tip_idx) in FINGER_TIPS.items():
        dip = keypoints_2d[dip_idx]
        tip = keypoints_2d[tip_idx]
        vec = tip - dip
        length = float(np.linalg.norm(vec))
        if length <= 1e-6:
            continue
        axes[name] = {
            "from": int(dip_idx),
            "to": int(tip_idx),
            "vector": [round(float(vec[0]), 4), round(float(vec[1]), 4)],
            "angle": round(float(math.degrees(math.atan2(float(vec[1]), float(vec[0])))), 4),
            "length": round(length, 4),
        }
    return axes


def draw_keypoints(image_bgr: np.ndarray, summary: dict[str, Any]) -> np.ndarray:
    out = image_bgr.copy()
    colors = {
        "thumb": (80, 180, 255),
        "index": (80, 220, 120),
        "middle": (255, 180, 80),
        "ring": (180, 120, 255),
        "pinky": (255, 120, 180),
    }

    for hand in summary.get("hands", []):
        bbox = hand.get("bbox") or []
        side_code = "R" if hand.get("is_right") else "L"
        if len(bbox) >= 4:
            x1, y1, x2, y2 = [int(round(v)) for v in bbox[:4]]
            cv2.rectangle(out, (x1, y1), (x2, y2), (235, 235, 235), 2)
            cv2.putText(out, f"{hand['hand_index']} {side_code}", (x1 + 8, max(28, y1 + 28)), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 20, 20), 3)
            cv2.putText(out, f"{hand['hand_index']} {side_code}", (x1 + 8, max(28, y1 + 28)), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 1)

        points = np.asarray(hand.get("keypoints_2d") or [], dtype=np.float32)
        if points.ndim != 2 or points.shape[0] < 21:
            continue

        for name, chain in FINGER_CHAINS.items():
            color = colors[name]
            for a, b in zip(chain[:-1], chain[1:]):
                pa = tuple(np.round(points[a]).astype(int))
                pb = tuple(np.round(points[b]).astype(int))
                cv2.line(out, pa, pb, color, 3, cv2.LINE_AA)
            for idx in chain[1:]:
                point = tuple(np.round(points[idx]).astype(int))
                cv2.circle(out, point, 7, color, -1, cv2.LINE_AA)
                cv2.putText(out, str(idx), (point[0] + 6, point[1] - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 3)
                cv2.putText(out, str(idx), (point[0] + 6, point[1] - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

        wrist = tuple(np.round(points[0]).astype(int))
        cv2.circle(out, wrist, 8, (255, 255, 255), -1, cv2.LINE_AA)
        cv2.putText(out, f"{side_code}0", (wrist[0] + 7, wrist[1] - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(out, f"{side_code}0", (wrist[0] + 7, wrist[1] - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

    for crossing in summary.get("skeleton_crossings", []):
        point = crossing.get("point") or []
        if len(point) != 2:
            continue
        x, y = int(round(point[0])), int(round(point[1]))
        cv2.drawMarker(out, (x, y), (0, 0, 255), markerType=cv2.MARKER_CROSS, markerSize=18, thickness=2)

    return out


def get_mano_faces(model_root: str):
    from wilor_mini.models.wilor import WiLor

    tmp_model = WiLor(
        mano_model_path=str(Path(model_root) / "pretrained_models" / "MANO_RIGHT.pkl"),
        mano_mean_path=str(Path(model_root) / "pretrained_models" / "mano_mean_params.npz"),
    )
    faces_new = np.array([
        [92, 38, 234], [234, 38, 239], [38, 122, 239], [239, 122, 279],
        [122, 118, 279], [279, 118, 215], [118, 117, 215], [215, 117, 214],
        [117, 119, 214], [214, 119, 121], [119, 120, 121], [121, 120, 78],
        [120, 108, 78], [78, 108, 79],
    ])
    faces = np.concatenate([tmp_model.mano.faces, faces_new], axis=0)
    return faces, faces[:, [0, 2, 1]]


def render_mesh_overlay(image_bgr: np.ndarray, results: list[dict[str, Any]], model_root: str) -> np.ndarray:
    import pyrender
    import trimesh

    faces, faces_left = get_mano_faces(model_root)
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    img_h, img_w = image_bgr.shape[:2]
    scene = pyrender.Scene(bg_color=[1, 1, 1, 0.0], ambient_light=(0.3, 0.3, 0.3))
    focal_length = None

    for result in results:
        preds = result.get("wilor_preds") or {}
        vertices = np.asarray(preds.get("pred_vertices", []), dtype=np.float32).squeeze()
        cam_t = np.asarray(preds.get("pred_cam_t_full", []), dtype=np.float32).squeeze()
        if vertices.ndim != 2 or vertices.shape[1] != 3 or cam_t.shape[0] != 3:
            continue
        focal_length = float(np.asarray(preds.get("scaled_focal_length", 5000.0)).squeeze())
        is_right = bool(result.get("is_right", 1))
        vertex_colors = np.array([(*LIGHT_PURPLE, 1.0)] * vertices.shape[0])
        mesh = trimesh.Trimesh(vertices.copy() + cam_t, faces.copy() if is_right else faces_left.copy(), vertex_colors=vertex_colors)
        mesh.apply_transform(trimesh.transformations.rotation_matrix(np.radians(180), [1, 0, 0]))
        scene.add(pyrender.Mesh.from_trimesh(mesh))

    if focal_length is None:
        return image_bgr.copy()

    camera = pyrender.IntrinsicsCamera(fx=focal_length, fy=focal_length, cx=img_w / 2.0, cy=img_h / 2.0, zfar=1e12)
    scene.add_node(pyrender.Node(camera=camera, matrix=np.eye(4)))
    for pose in light_poses():
        scene.add_node(pyrender.Node(light=pyrender.DirectionalLight(color=np.ones(3), intensity=1.0), matrix=pose))

    renderer = pyrender.OffscreenRenderer(viewport_width=img_w, viewport_height=img_h, point_size=1.0)
    color, _ = renderer.render(scene, flags=pyrender.RenderFlags.RGBA)
    renderer.delete()
    color = color.astype(np.float32) / 255.0
    base = image_rgb.astype(np.float32) / 255.0
    alpha = color[:, :, 3:4]
    out_rgb = base * (1 - alpha) + color[:, :, :3] * alpha
    return cv2.cvtColor((out_rgb * 255).astype(np.uint8), cv2.COLOR_RGB2BGR)


def render_single_rgba(mesh, img_w: int, img_h: int, focal_length: float) -> np.ndarray:
    import pyrender

    scene = pyrender.Scene(bg_color=[1, 1, 1, 0.0], ambient_light=(0.3, 0.3, 0.3))
    scene.add(pyrender.Mesh.from_trimesh(mesh))
    camera = pyrender.IntrinsicsCamera(
        fx=focal_length,
        fy=focal_length,
        cx=img_w / 2.0,
        cy=img_h / 2.0,
        zfar=1e12,
    )
    scene.add_node(pyrender.Node(camera=camera, matrix=np.eye(4)))
    for pose in light_poses():
        scene.add_node(pyrender.Node(light=pyrender.DirectionalLight(color=np.ones(3), intensity=1.0), matrix=pose))

    renderer = pyrender.OffscreenRenderer(viewport_width=img_w, viewport_height=img_h, point_size=1.0)
    color, _ = renderer.render(scene, flags=pyrender.RenderFlags.RGBA)
    renderer.delete()
    return color.astype(np.float32) / 255.0


def render_mesh_overlay_visual_order(
    image_bgr: np.ndarray,
    results: list[dict[str, Any]],
    model_root: str,
    visual_layers: list[dict[str, Any]],
    render_plan: dict[str, Any] | None = None,
) -> np.ndarray:
    faces, faces_left = get_mano_faces(model_root)
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    img_h, img_w = image_bgr.shape[:2]
    base = image_rgb.astype(np.float32) / 255.0
    rgba_by_hand = {}

    for index, result in enumerate(results):
        preds = result.get("wilor_preds") or {}
        focal_length = float(np.asarray(preds.get("scaled_focal_length", 0.0)).squeeze()) if preds else 0.0
        mesh = result_mesh(result, faces, faces_left)
        if mesh is None or focal_length <= 0:
            continue
        rgba_by_hand[index] = render_single_rgba(mesh, img_w, img_h, focal_length)

    if not rgba_by_hand:
        return image_bgr.copy()

    if render_plan and render_plan.get("render_order_back_to_front"):
        render_order = render_plan["render_order_back_to_front"]
    elif visual_layers:
        # Composite from visually back to visually front. This intentionally
        # overrides cross-hand z-buffer depth while preserving each hand's own mesh depth.
        render_order = [item["hand_index"] for item in sorted(visual_layers, key=lambda item: item.get("layer_rank", 99), reverse=True)]
    else:
        render_order = list(rgba_by_hand.keys())

    out = base
    for hand_index in render_order:
        rgba = rgba_by_hand.get(hand_index)
        if rgba is None:
            continue
        alpha = rgba[:, :, 3:4]
        out = out * (1 - alpha) + rgba[:, :, :3] * alpha

    return cv2.cvtColor((out * 255).astype(np.uint8), cv2.COLOR_RGB2BGR)


def result_mesh(result: dict[str, Any], faces: np.ndarray, faces_left: np.ndarray, mesh_color=None):
    import trimesh

    preds = result.get("wilor_preds") or {}
    vertices = np.asarray(preds.get("pred_vertices", []), dtype=np.float32).squeeze()
    cam_t = np.asarray(preds.get("pred_cam_t_full", []), dtype=np.float32).squeeze()
    if vertices.ndim != 2 or vertices.shape[1] != 3 or cam_t.shape[0] != 3:
        return None

    is_right = bool(result.get("is_right", 1))
    if mesh_color is None:
        mesh_color = HAND_MESH_COLORS["right" if is_right else "left"]
    vertex_colors = np.array([(*mesh_color, 1.0)] * vertices.shape[0])
    mesh = trimesh.Trimesh(
        vertices.copy() + cam_t,
        faces.copy() if is_right else faces_left.copy(),
        vertex_colors=vertex_colors,
    )
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.radians(180), [1, 0, 0]))
    return mesh


def render_single_depth(mesh, img_w: int, img_h: int, focal_length: float) -> np.ndarray:
    import pyrender

    scene = pyrender.Scene(bg_color=[1, 1, 1, 0.0], ambient_light=(0.3, 0.3, 0.3))
    scene.add(pyrender.Mesh.from_trimesh(mesh))
    camera = pyrender.IntrinsicsCamera(
        fx=focal_length,
        fy=focal_length,
        cx=img_w / 2.0,
        cy=img_h / 2.0,
        zfar=1e12,
    )
    scene.add_node(pyrender.Node(camera=camera, matrix=np.eye(4)))
    for pose in light_poses():
        scene.add_node(pyrender.Node(light=pyrender.DirectionalLight(color=np.ones(3), intensity=1.0), matrix=pose))

    renderer = pyrender.OffscreenRenderer(viewport_width=img_w, viewport_height=img_h, point_size=1.0)
    _, depth = renderer.render(scene)
    renderer.delete()
    return depth.astype(np.float32)


def estimate_occlusion_layers(image_bgr: np.ndarray, results: list[dict[str, Any]], model_root: str) -> list[dict[str, Any]]:
    if len(results) < 2:
        return [], []

    faces, faces_left = get_mano_faces(model_root)
    img_h, img_w = image_bgr.shape[:2]
    rendered = []

    for index, result in enumerate(results):
        preds = result.get("wilor_preds") or {}
        focal_length = float(np.asarray(preds.get("scaled_focal_length", 0.0)).squeeze()) if preds else 0.0
        mesh = result_mesh(result, faces, faces_left)
        if mesh is None or focal_length <= 0:
            continue
        depth = render_single_depth(mesh, img_w, img_h, focal_length)
        mask = depth > 0
        rendered.append({
            "index": index,
            "depth": depth,
            "mask": mask,
            "visible_pixels": int(mask.sum()),
        })

    wins = {item["index"]: 0 for item in rendered}
    overlaps = {item["index"]: 0 for item in rendered}
    pairwise = []

    for left_i in range(len(rendered)):
        for right_i in range(left_i + 1, len(rendered)):
            a = rendered[left_i]
            b = rendered[right_i]
            overlap = a["mask"] & b["mask"]
            count = int(overlap.sum())
            if count == 0:
                pairwise.append({
                    "a": a["index"],
                    "b": b["index"],
                    "overlap_pixels": 0,
                    "front": None,
                    "confidence": 0.0,
                })
                continue

            a_front = a["depth"][overlap] < b["depth"][overlap]
            a_wins = int(a_front.sum())
            b_wins = count - a_wins
            front = a["index"] if a_wins >= b_wins else b["index"]
            confidence = max(a_wins, b_wins) / max(1, count)
            wins[front] += max(a_wins, b_wins)
            overlaps[a["index"]] += count
            overlaps[b["index"]] += count
            pairwise.append({
                "a": a["index"],
                "b": b["index"],
                "overlap_pixels": count,
                "front": front,
                "confidence": round(float(confidence), 4),
                "a_front_pixels": a_wins,
                "b_front_pixels": b_wins,
            })

    ordered = sorted(rendered, key=lambda item: (-wins[item["index"]], item["index"]))
    ranks = {item["index"]: rank for rank, item in enumerate(ordered)}

    layers = []
    for item in rendered:
        result = results[item["index"]]
        is_right = bool(result.get("is_right", 1))
        layers.append({
            "hand_index": item["index"],
            "is_right": is_right,
            "hand_side": "right" if is_right else "left",
            "hand_side_label": "右手" if is_right else "左手",
            "layer_rank": ranks[item["index"]],
            "front_pixels": int(wins[item["index"]]),
            "overlap_pixels": int(overlaps[item["index"]]),
            "visible_pixels": item["visible_pixels"],
        })

    return sorted(layers, key=lambda item: item["layer_rank"]), pairwise


def bbox_contains(point: np.ndarray, bbox: list[float], padding: float = 0.0) -> bool:
    if len(bbox) < 4:
        return False
    x1, y1, x2, y2 = [float(v) for v in bbox[:4]]
    bw = abs(x2 - x1)
    bh = abs(y2 - y1)
    pad = max(bw, bh) * padding
    x, y = float(point[0]), float(point[1])
    return min(x1, x2) - pad <= x <= max(x1, x2) + pad and min(y1, y2) - pad <= y <= max(y1, y2) + pad


def cross_2d(a: np.ndarray, b: np.ndarray) -> float:
    return float(a[0] * b[1] - a[1] * b[0])


def segment_intersection(p1: np.ndarray, p2: np.ndarray, q1: np.ndarray, q2: np.ndarray):
    r = p2 - p1
    s = q2 - q1
    denom = cross_2d(r, s)
    if abs(denom) < 1e-6:
        return None
    qp = q1 - p1
    t = cross_2d(qp, s) / denom
    u = cross_2d(qp, r) / denom
    if 0.0 <= t <= 1.0 and 0.0 <= u <= 1.0:
        point = p1 + t * r
        return point, float(t), float(u)
    return None


def hand_bone_segments(hand: dict[str, Any]) -> list[dict[str, Any]]:
    points = np.asarray(hand.get("keypoints_2d") or [], dtype=np.float32)
    if points.ndim != 2 or points.shape[0] < 21:
        return []
    segments = []
    for finger, chain in FINGER_CHAINS.items():
        for order, (a, b) in enumerate(zip(chain[:-1], chain[1:]), start=1):
            # The distal phalanx is strongest for nail/visual overlap decisions.
            distal_score = order + (1.5 if b in {4, 8, 12, 16, 20} else 0.0)
            segments.append({
                "hand_index": hand["hand_index"],
                "hand_side_label": hand.get("hand_side_label"),
                "finger": finger,
                "from": int(a),
                "to": int(b),
                "p1": points[a],
                "p2": points[b],
                "distal_score": float(distal_score),
            })
    return segments


def skeleton_crossings(summary: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[int, float]]:
    hands = summary.get("hands", [])
    segments_by_hand = {hand["hand_index"]: hand_bone_segments(hand) for hand in hands}
    scores = {hand["hand_index"]: 0.0 for hand in hands}
    crossings = []

    for i, hand_a in enumerate(hands):
        for hand_b in hands[i + 1:]:
            for seg_a in segments_by_hand.get(hand_a["hand_index"], []):
                for seg_b in segments_by_hand.get(hand_b["hand_index"], []):
                    hit = segment_intersection(seg_a["p1"], seg_a["p2"], seg_b["p1"], seg_b["p2"])
                    if hit is None:
                        continue
                    point, t_a, t_b = hit
                    front_candidate = None
                    if abs(seg_a["distal_score"] - seg_b["distal_score"]) >= 0.75:
                        front_candidate = seg_a["hand_index"] if seg_a["distal_score"] > seg_b["distal_score"] else seg_b["hand_index"]
                        scores[front_candidate] += max(seg_a["distal_score"], seg_b["distal_score"])
                    crossings.append({
                        "point": [round(float(point[0]), 2), round(float(point[1]), 2)],
                        "front_candidate": front_candidate,
                        "a": {
                            "hand_index": seg_a["hand_index"],
                            "hand_side_label": seg_a["hand_side_label"],
                            "finger": seg_a["finger"],
                            "from": seg_a["from"],
                            "to": seg_a["to"],
                            "t": round(t_a, 4),
                            "distal_score": round(seg_a["distal_score"], 2),
                        },
                        "b": {
                            "hand_index": seg_b["hand_index"],
                            "hand_side_label": seg_b["hand_side_label"],
                            "finger": seg_b["finger"],
                            "from": seg_b["from"],
                            "to": seg_b["to"],
                            "t": round(t_b, 4),
                            "distal_score": round(seg_b["distal_score"], 2),
                        },
                    })

    return crossings, scores


def estimate_visual_layers(summary: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Estimate the front hand as humans see it in the image plane.

    WiLoR's 3D depth can disagree with visual occlusion in crossed-hand photos.
    For UI click selection, visible 2D evidence is more important: when hand A's
    finger joints/fingertips are visible inside hand B's bbox, A should usually
    be treated as the visually upper hand in that overlap.
    """
    hands = summary.get("hands", [])
    if len(hands) < 2:
        return [], [], []

    tip_indices = {4, 8, 12, 16, 20}
    distal_indices = {3, 7, 11, 15, 19}
    scores = {hand["hand_index"]: 0.0 for hand in hands}
    overlaps = {hand["hand_index"]: 0 for hand in hands}
    occluded_by = {hand["hand_index"]: 0.0 for hand in hands}
    occludes = {hand["hand_index"]: 0.0 for hand in hands}
    evidence = []
    crossings, crossing_scores = skeleton_crossings(summary)
    for hand_index, score in crossing_scores.items():
        scores[hand_index] += score

    for hand in hands:
        points = np.asarray(hand.get("keypoints_2d") or [], dtype=np.float32)
        if points.ndim != 2 or points.shape[0] < 21:
            continue
        for other in hands:
            if other["hand_index"] == hand["hand_index"]:
                continue
            bbox = other.get("bbox") or []
            for idx in range(1, 21):
                if not bbox_contains(points[idx], bbox, padding=0.015):
                    continue
                weight = 3.0 if idx in tip_indices else 2.0 if idx in distal_indices else 1.0
                scores[hand["hand_index"]] += weight
                overlaps[hand["hand_index"]] += 1
                evidence.append({
                    "front_candidate": hand["hand_index"],
                    "behind_candidate": other["hand_index"],
                    "keypoint": idx,
                    "weight": weight,
                })
                occludes[hand["hand_index"]] += weight
                occluded_by[other["hand_index"]] += weight

    for crossing in crossings:
        front = crossing.get("front_candidate")
        a_hand = crossing.get("a", {}).get("hand_index")
        b_hand = crossing.get("b", {}).get("hand_index")
        if front is None or a_hand is None or b_hand is None:
            continue
        back = b_hand if front == a_hand else a_hand
        weight = max(
            float(crossing.get("a", {}).get("distal_score", 1.0)),
            float(crossing.get("b", {}).get("distal_score", 1.0)),
        )
        occludes[front] += weight
        occluded_by[back] += weight

    ordered = sorted(
        hands,
        key=lambda hand: (
            -scores.get(hand["hand_index"], 0.0),
            occluded_by.get(hand["hand_index"], 0.0),
            hand["hand_index"],
        ),
    )
    layers = []
    for rank, hand in enumerate(ordered):
        layers.append({
            "hand_index": hand["hand_index"],
            "is_right": bool(hand.get("is_right")),
            "hand_side": hand.get("hand_side"),
            "hand_side_label": hand.get("hand_side_label"),
            "layer_rank": rank,
            "visual_score": round(float(scores.get(hand["hand_index"], 0.0)), 4),
            "occludes_score": round(float(occludes.get(hand["hand_index"], 0.0)), 4),
            "occluded_by_score": round(float(occluded_by.get(hand["hand_index"], 0.0)), 4),
            "overlap_keypoints": int(overlaps.get(hand["hand_index"], 0)),
        })

    return layers, evidence, crossings


def infer_visual_occlusion_relations(summary: dict[str, Any]) -> list[dict[str, Any]]:
    hands = summary.get("hands", [])
    if len(hands) < 2:
        return []

    layers = summary.get("visual_layers") or summary.get("hand_layers") or []
    rank_by_hand = {item["hand_index"]: item.get("layer_rank", 99) for item in layers}
    evidence = summary.get("visual_overlap_evidence") or []
    crossings = summary.get("skeleton_crossings") or []
    relations = {}

    def ensure(front, back):
        key = (front, back)
        if key not in relations:
            relations[key] = {
                "occluding_hand": front,
                "occluded_hand": back,
                "score": 0.0,
                "evidence": [],
            }
        return relations[key]

    for item in evidence:
        front = item.get("front_candidate")
        back = item.get("behind_candidate")
        if front is None or back is None:
            continue
        rel = ensure(front, back)
        rel["score"] += float(item.get("weight", 1.0))
        rel["evidence"].append({
            "type": "keypoint_inside_other_bbox",
            "keypoint": item.get("keypoint"),
            "weight": item.get("weight"),
        })

    for item in crossings:
        front = item.get("front_candidate")
        a_hand = item.get("a", {}).get("hand_index")
        b_hand = item.get("b", {}).get("hand_index")
        if front is None or a_hand is None or b_hand is None:
            continue
        back = b_hand if front == a_hand else a_hand
        rel = ensure(front, back)
        score = max(float(item.get("a", {}).get("distal_score", 1.0)), float(item.get("b", {}).get("distal_score", 1.0)))
        rel["score"] += score
        rel["evidence"].append({
            "type": "skeleton_segment_crossing",
            "point": item.get("point"),
            "a": item.get("a"),
            "b": item.get("b"),
            "weight": round(score, 4),
        })

    for rel in relations.values():
        front = rel["occluding_hand"]
        back = rel["occluded_hand"]
        if rank_by_hand.get(front, 99) < rank_by_hand.get(back, 99):
            rel["score"] += 5.0
            rel["evidence"].append({"type": "visual_layer_rank", "weight": 5.0})

    hand_lookup = {hand["hand_index"]: hand for hand in hands}
    output = []
    for rel in sorted(relations.values(), key=lambda item: -item["score"]):
        front_hand = hand_lookup.get(rel["occluding_hand"], {})
        back_hand = hand_lookup.get(rel["occluded_hand"], {})
        output.append({
            "occluding_hand": rel["occluding_hand"],
            "occluding_side_label": front_hand.get("hand_side_label"),
            "occluded_hand": rel["occluded_hand"],
            "occluded_side_label": back_hand.get("hand_side_label"),
            "score": round(float(rel["score"]), 4),
            "evidence_count": len(rel["evidence"]),
            "evidence": rel["evidence"][:12],
        })
    return output


def build_instance_render_plan(summary: dict[str, Any]) -> dict[str, Any]:
    hands = summary.get("hands", [])
    hand_ids = [hand["hand_index"] for hand in hands]
    relations = summary.get("visual_occlusion_relations") or []
    layers = summary.get("visual_layers") or []
    layer_rank = {item["hand_index"]: item.get("layer_rank", 99) for item in layers}

    # Edge: occluded -> occluding. Rendering follows this order so the occluding
    # instance is composited later and appears visually on top.
    edges = {hand_id: set() for hand_id in hand_ids}
    indegree = {hand_id: 0 for hand_id in hand_ids}
    edge_details = []
    best_pair = {}
    for rel in relations:
        front = rel.get("occluding_hand")
        back = rel.get("occluded_hand")
        if front is None or back is None or front == back:
            continue
        pair_key = tuple(sorted([front, back]))
        if pair_key not in best_pair or float(rel.get("score", 0)) > float(best_pair[pair_key].get("score", 0)):
            best_pair[pair_key] = rel

    suppressed_edges = []
    for rel in relations:
        front = rel.get("occluding_hand")
        back = rel.get("occluded_hand")
        if front is None or back is None or front == back:
            continue
        pair_key = tuple(sorted([front, back]))
        if best_pair.get(pair_key) is not rel:
            suppressed_edges.append({
                "occluding_hand": front,
                "occluded_hand": back,
                "score": rel.get("score", 0),
                "reason": "weaker_reverse_relation",
            })

    for rel in best_pair.values():
        front = rel.get("occluding_hand")
        back = rel.get("occluded_hand")
        if front not in edges or back not in edges or front == back:
            continue
        if front not in edges[back]:
            edges[back].add(front)
            indegree[front] += 1
        edge_details.append({
            "from_occluded": back,
            "to_occluding": front,
            "score": rel.get("score", 0),
        })

    remaining = set(hand_ids)
    render_order = []
    cycle_breaks = []
    while remaining:
        available = [hand_id for hand_id in remaining if indegree.get(hand_id, 0) == 0]
        if not available:
            # Cycle or contradictory evidence. Fall back to current visual rank.
            current = max(remaining, key=lambda hand_id: (layer_rank.get(hand_id, 99), -hand_id))
            cycle_breaks.append(current)
        else:
            # Larger layer_rank means visually further back, so render it earlier.
            current = max(available, key=lambda hand_id: (layer_rank.get(hand_id, 99), -hand_id))
        remaining.remove(current)
        render_order.append(current)
        for nxt in edges.get(current, set()):
            indegree[nxt] -= 1

    return {
        "render_order_back_to_front": render_order,
        "edges": edge_details,
        "suppressed_edges": suppressed_edges,
        "cycle_breaks": cycle_breaks,
        "supports_multi_instance_same_side": True,
    }


def light_poses():
    poses = [np.eye(4)]
    for theta in np.pi * np.array([1 / 6, 1 / 6, 1 / 6]):
        for phi in np.pi * np.array([0.0, 2 / 3, 4 / 3]):
            z = np.array([np.sin(theta) * np.cos(phi), np.sin(theta) * np.sin(phi), np.cos(theta)])
            z = z / np.linalg.norm(z)
            x = np.array([-z[1], z[0], 0.0])
            if np.linalg.norm(x) == 0:
                x = np.array([1.0, 0.0, 0.0])
            x = x / np.linalg.norm(x)
            y = np.cross(z, x)
            matrix = np.eye(4)
            matrix[:3, :3] = np.c_[x, y, z]
            poses.append(matrix)
    return poses


def save_combined(left_bgr: np.ndarray, right_bgr: np.ndarray, out_path: str):
    height = max(left_bgr.shape[0], right_bgr.shape[0])

    def fit(image):
        scale = height / image.shape[0]
        return cv2.resize(image, (int(image.shape[1] * scale), height), interpolation=cv2.INTER_AREA)

    sep = np.full((height, 16, 3), 255, dtype=np.uint8)
    cv2.imwrite(out_path, np.hstack([fit(left_bgr), sep, fit(right_bgr)]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--model-root", default=os.environ.get("WILOR_MODEL_ROOT", "/app"))
    parser.add_argument("--json-output")
    parser.add_argument("--keypoints-output")
    parser.add_argument("--mesh-output")
    parser.add_argument("--combined-output")
    parser.add_argument("--hand-conf", type=float, default=0.3)
    parser.add_argument("--rescale-factor", type=float, default=2.5)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--include-vertices", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    image_bgr = cv2.imread(args.image)
    if image_bgr is None:
        raise RuntimeError(f"无法读取图片：{args.image}")

    results = run_wilor(image_bgr, args.model_root, args.hand_conf, args.rescale_factor, args.device, args.verbose)
    summary = summarize_results(results, include_vertices=args.include_vertices)
    layers, pairwise_occlusion = estimate_occlusion_layers(image_bgr, results, args.model_root)
    visual_layers, visual_evidence, visual_crossings = estimate_visual_layers(summary)
    summary["3d_depth_layers"] = layers
    summary["3d_depth_pairs"] = pairwise_occlusion
    summary["visual_layers"] = visual_layers
    summary["visual_overlap_evidence"] = visual_evidence
    summary["skeleton_crossings"] = visual_crossings
    summary["hand_layers"] = visual_layers or layers
    summary["visual_occlusion_relations"] = infer_visual_occlusion_relations(summary)
    summary["render_plan"] = build_instance_render_plan(summary)

    if args.json_output:
        Path(args.json_output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_output).write_text(json.dumps(to_jsonable(summary), ensure_ascii=False, indent=2), encoding="utf-8")

    keypoints_img = draw_keypoints(image_bgr, summary)
    if args.keypoints_output:
        Path(args.keypoints_output).parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(args.keypoints_output, keypoints_img)

    mesh_img = None
    if args.mesh_output or args.combined_output:
        mesh_img = render_mesh_overlay_visual_order(
            image_bgr,
            results,
            args.model_root,
            summary.get("visual_layers") or [],
            summary.get("render_plan"),
        )
        if args.mesh_output:
            Path(args.mesh_output).parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(args.mesh_output, mesh_img)

    if args.combined_output:
        Path(args.combined_output).parent.mkdir(parents=True, exist_ok=True)
        save_combined(keypoints_img, mesh_img if mesh_img is not None else image_bgr, args.combined_output)

    print(json.dumps({"num_hands": summary["num_hands"], "message": summary["message"]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
