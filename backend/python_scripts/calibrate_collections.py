#!/usr/bin/env python3
"""
Calibrate two image collections (e.g. RGB and Thermal) by marking corresponding points.

Usage:
    python calibrate_collections.py <image_a> <image_b>
    python calibrate_collections.py  # prompts for files via dialog

Controls:
  - Click on the LEFT image to add a point in collection A.
  - Click on the RIGHT image to add a point in collection B.
  - Points are paired in order (1st click left  ↔ 1st click right, etc.).
  - [Calibrate]       – compute homography from current pairs (need ≥ 4 pairs).
  - [Clear Last Pair] – remove the last pair of points.
  - [Clear All]       – remove all pairs.
  - [Save JSON]       – save the homography + inverse to a JSON file.
  - After calibration: click any point on either image to see the corresponding
    point projected onto the other image (shown as a blue cross).
"""

import sys
import json
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import numpy as np
import cv2
from PIL import Image, ImageTk

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

COLORS = [
    "#e74c3c", "#2ecc71", "#3498db", "#f39c12", "#9b59b6",
    "#1abc9c", "#e67e22", "#34495e", "#e91e63", "#00bcd4",
]

POINT_RADIUS = 6
CROSS_SIZE = 14


def apply_homography(H: np.ndarray, x: float, y: float):
    """Apply a 3×3 homography to a single point."""
    pt = np.array([[[x, y]]], dtype=np.float32)
    result = cv2.perspectiveTransform(pt, H)
    return float(result[0][0][0]), float(result[0][0][1])


def load_image(path: str) -> np.ndarray:
    img = cv2.imread(path)
    if img is None:
        raise FileNotFoundError(f"Cannot load image: {path}")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def fit_image(img_rgb: np.ndarray, max_w: int, max_h: int):
    """Return a PIL ImageTk scaled to fit within max_w × max_h, plus the scale."""
    h, w = img_rgb.shape[:2]
    scale = min(max_w / w, max_h / h, 1.0)
    nw, nh = int(w * scale), int(h * scale)
    pil = Image.fromarray(img_rgb).resize((nw, nh), Image.LANCZOS)
    return ImageTk.PhotoImage(pil), scale, nw, nh


# ──────────────────────────────────────────────────────────────────────────────
# Main application
# ──────────────────────────────────────────────────────────────────────────────

class CalibrationApp:
    MAX_CANVAS_W = 720
    MAX_CANVAS_H = 580

    def __init__(self, root: tk.Tk, path_a: str, path_b: str):
        self.root = root
        self.root.title("Collection Calibration Tool")

        # Raw images
        self.img_a = load_image(path_a)
        self.img_b = load_image(path_b)
        self.path_a = path_a
        self.path_b = path_b

        # Point pairs  [(xa, ya), (xb, yb)]  – in ORIGINAL image pixels
        self.pairs: list[tuple[tuple[float, float], tuple[float, float]]] = []

        # Pending single clicks (waiting for the matching side)
        self.pending_a: tuple[float, float] | None = None
        self.pending_b: tuple[float, float] | None = None

        # Homography
        self.H: np.ndarray | None = None       # A → B
        self.H_inv: np.ndarray | None = None   # B → A

        # Cross-hair probe point (original image coords)
        self.probe_a: tuple[float, float] | None = None  # probe set on A
        self.probe_b: tuple[float, float] | None = None  # probe set on B

        self._build_ui()
        self._render_images()

    # ── UI construction ──────────────────────────────────────────────────────

    def _build_ui(self):
        root = self.root

        # ── top frame: canvases ──
        frame_imgs = tk.Frame(root, bg="#1e1e2e")
        frame_imgs.pack(fill=tk.BOTH, expand=True, padx=8, pady=(8, 0))

        # Label A
        tk.Label(frame_imgs, text="Collection A  (click to add point)",
                 bg="#1e1e2e", fg="#cdd6f4", font=("Segoe UI", 10, "bold")).grid(row=0, column=0, sticky="w", padx=4)
        tk.Label(frame_imgs, text="Collection B  (click to add point)",
                 bg="#1e1e2e", fg="#cdd6f4", font=("Segoe UI", 10, "bold")).grid(row=0, column=1, sticky="w", padx=4)

        # Canvas A
        self.canvas_a = tk.Canvas(frame_imgs, width=self.MAX_CANVAS_W,
                                  height=self.MAX_CANVAS_H, bg="#181825", cursor="crosshair",
                                  highlightthickness=1, highlightbackground="#585b70")
        self.canvas_a.grid(row=1, column=0, padx=4, pady=4)
        self.canvas_a.bind("<Button-1>", self._on_click_a)
        self.canvas_a.bind("<Motion>", lambda e: self._on_motion(e, "a"))

        # Canvas B
        self.canvas_b = tk.Canvas(frame_imgs, width=self.MAX_CANVAS_W,
                                  height=self.MAX_CANVAS_H, bg="#181825", cursor="crosshair",
                                  highlightthickness=1, highlightbackground="#585b70")
        self.canvas_b.grid(row=1, column=1, padx=4, pady=4)
        self.canvas_b.bind("<Button-1>", self._on_click_b)
        self.canvas_b.bind("<Motion>", lambda e: self._on_motion(e, "b"))

        # ── bottom frame: controls ──
        frame_ctrl = tk.Frame(root, bg="#181825")
        frame_ctrl.pack(fill=tk.X, padx=8, pady=6)

        btn_style = {"bg": "#313244", "fg": "#cdd6f4", "relief": tk.FLAT,
                     "font": ("Segoe UI", 9), "padx": 14, "pady": 6, "cursor": "hand2",
                     "activebackground": "#45475a", "activeforeground": "#cdd6f4"}

        self.btn_calibrate = tk.Button(frame_ctrl, text="⚡ Calibrate",
                                       command=self._calibrate,
                                       bg="#89b4fa", fg="#1e1e2e",
                                       relief=tk.FLAT, font=("Segoe UI", 9, "bold"),
                                       padx=14, pady=6, cursor="hand2",
                                       activebackground="#74c7ec", activeforeground="#1e1e2e")
        self.btn_calibrate.pack(side=tk.LEFT, padx=(0, 6))

        tk.Button(frame_ctrl, text="✕ Clear Last Pair",
                  command=self._clear_last, **btn_style).pack(side=tk.LEFT, padx=3)
        tk.Button(frame_ctrl, text="🗑 Clear All",
                  command=self._clear_all, **btn_style).pack(side=tk.LEFT, padx=3)
        tk.Button(frame_ctrl, text="💾 Save JSON",
                  command=self._save_json, **btn_style).pack(side=tk.LEFT, padx=3)

        self.status_var = tk.StringVar(value="Click corresponding points on both images.")
        tk.Label(frame_ctrl, textvariable=self.status_var,
                 bg="#181825", fg="#a6e3a1",
                 font=("Segoe UI", 9)).pack(side=tk.RIGHT, padx=8)

        # ── pair count label ──
        self.pair_count_var = tk.StringVar(value="Pairs: 0")
        tk.Label(frame_ctrl, textvariable=self.pair_count_var,
                 bg="#181825", fg="#fab387",
                 font=("Segoe UI", 9, "bold")).pack(side=tk.RIGHT, padx=4)

        # Instructions below canvases
        info = ("After calibrating: click anywhere on either image to project the point onto the other image.")
        tk.Label(root, text=info, bg="#1e1e2e", fg="#585b70",
                 font=("Segoe UI", 8)).pack(padx=8, pady=(0, 6))

    # ── Image rendering ───────────────────────────────────────────────────────

    def _render_images(self):
        # Resize images to fit canvases
        self._tk_a, self.scale_a, self.disp_w_a, self.disp_h_a = fit_image(
            self.img_a, self.MAX_CANVAS_W, self.MAX_CANVAS_H)
        self._tk_b, self.scale_b, self.disp_w_b, self.disp_h_b = fit_image(
            self.img_b, self.MAX_CANVAS_W, self.MAX_CANVAS_H)

        self.canvas_a.config(width=self.disp_w_a, height=self.disp_h_a)
        self.canvas_b.config(width=self.disp_w_b, height=self.disp_h_b)

        self._redraw()

    def _redraw(self):
        self._draw_canvas(self.canvas_a, self._tk_a, side="a")
        self._draw_canvas(self.canvas_b, self._tk_b, side="b")
        self._update_pair_count()

    def _draw_canvas(self, canvas: tk.Canvas, tk_img, side: str):
        canvas.delete("all")
        canvas.create_image(0, 0, anchor=tk.NW, image=tk_img)

        scale = self.scale_a if side == "a" else self.scale_b

        # Draw completed pairs
        for i, (pa, pb) in enumerate(self.pairs):
            color = COLORS[i % len(COLORS)]
            p = pa if side == "a" else pb
            cx, cy = p[0] * scale, p[1] * scale
            canvas.create_oval(cx - POINT_RADIUS, cy - POINT_RADIUS,
                                cx + POINT_RADIUS, cy + POINT_RADIUS,
                                fill=color, outline="white", width=1.5)
            canvas.create_text(cx + POINT_RADIUS + 4, cy - POINT_RADIUS,
                                text=str(i + 1), fill=color,
                                font=("Segoe UI", 8, "bold"), anchor=tk.W)

        # Draw pending point (grey)
        pending = self.pending_a if side == "a" else self.pending_b
        if pending:
            cx, cy = pending[0] * scale, pending[1] * scale
            canvas.create_oval(cx - POINT_RADIUS, cy - POINT_RADIUS,
                                cx + POINT_RADIUS, cy + POINT_RADIUS,
                                fill="#585b70", outline="white", width=1.5, dash=(3, 2))

        # Draw probe cross (+)
        probe = self.probe_a if side == "a" else self.probe_b
        if probe:
            cx, cy = probe[0] * scale, probe[1] * scale
            s = CROSS_SIZE
            canvas.create_line(cx - s, cy, cx + s, cy, fill="#89dceb", width=2)
            canvas.create_line(cx, cy - s, cx, cy + s, fill="#89dceb", width=2)
            canvas.create_oval(cx - 4, cy - 4, cx + 4, cy + 4,
                                outline="#89dceb", width=2)

    # ── Click handlers ────────────────────────────────────────────────────────

    def _on_click_a(self, event):
        orig_x = event.x / self.scale_a
        orig_y = event.y / self.scale_a

        if self.H is not None:
            # Probe mode: project point onto B
            self.probe_a = (orig_x, orig_y)
            bx, by = apply_homography(self.H, orig_x, orig_y)
            self.probe_b = (bx, by)
            self._redraw()
            self.status_var.set(f"A({orig_x:.1f}, {orig_y:.1f})  →  B({bx:.1f}, {by:.1f})")
            return

        # Pairing mode
        if self.pending_b is not None:
            # We already have a pending B click — form a pair
            self.pairs.append(((orig_x, orig_y), self.pending_b))
            self.pending_b = None
        else:
            self.pending_a = (orig_x, orig_y)

        self._redraw()
        self._update_status()

    def _on_click_b(self, event):
        orig_x = event.x / self.scale_b
        orig_y = event.y / self.scale_b

        if self.H is not None:
            # Probe mode: project point onto A
            self.probe_b = (orig_x, orig_y)
            ax, ay = apply_homography(self.H_inv, orig_x, orig_y)
            self.probe_a = (ax, ay)
            self._redraw()
            self.status_var.set(f"B({orig_x:.1f}, {orig_y:.1f})  →  A({ax:.1f}, {ay:.1f})")
            return

        if self.pending_a is not None:
            self.pairs.append((self.pending_a, (orig_x, orig_y)))
            self.pending_a = None
        else:
            self.pending_b = (orig_x, orig_y)

        self._redraw()
        self._update_status()

    def _on_motion(self, event, side: str):
        if self.H is None:
            return  # Only show projection after calibration

        scale = self.scale_a if side == "a" else self.scale_b
        ox, oy = event.x / scale, event.y / scale

        if side == "a":
            bx, by = apply_homography(self.H, ox, oy)
            self.probe_a = (ox, oy)
            self.probe_b = (bx, by)
        else:
            ax, ay = apply_homography(self.H_inv, ox, oy)
            self.probe_b = (ox, oy)
            self.probe_a = (ax, ay)

        self._redraw()

    # ── Calibration ───────────────────────────────────────────────────────────

    def _calibrate(self):
        if len(self.pairs) < 4:
            messagebox.showwarning("Not enough points",
                                   "Add at least 4 corresponding point pairs before calibrating.")
            return

        pts_a = np.array([[p[0], p[1]] for p, _ in self.pairs], dtype=np.float32)
        pts_b = np.array([[p[0], p[1]] for _, p in self.pairs], dtype=np.float32)

        H, mask = cv2.findHomography(pts_a, pts_b, cv2.RANSAC, ransacReprojThreshold=5.0)
        if H is None:
            messagebox.showerror("Calibration failed",
                                 "Could not compute homography. Try adding more / better-spread points.")
            return

        H_inv = np.linalg.inv(H)
        self.H = H
        self.H_inv = H_inv

        # Compute reprojection error
        inliers = int(mask.sum()) if mask is not None else len(self.pairs)
        errors = []
        for (pa, pb), m in zip(self.pairs, mask.ravel() if mask is not None else [1]*len(self.pairs)):
            if m:
                pb_proj = apply_homography(H, pa[0], pa[1])
                errors.append(np.hypot(pb_proj[0] - pb[0], pb_proj[1] - pb[1]))

        mean_err = float(np.mean(errors)) if errors else 0.0
        quality = "Excellent" if mean_err < 5 else "Good" if mean_err < 15 else "Fair" if mean_err < 30 else "Poor"

        self.status_var.set(
            f"✅ Calibrated  |  Pairs: {len(self.pairs)}  Inliers: {inliers}  "
            f"Mean error: {mean_err:.1f}px  Quality: {quality}  "
            f"— hover/click to project points"
        )
        self._redraw()

    # ── Point management ──────────────────────────────────────────────────────

    def _clear_last(self):
        if self.pairs:
            self.pairs.pop()
        self.pending_a = None
        self.pending_b = None
        self._redraw()
        self._update_status()

    def _clear_all(self):
        self.pairs.clear()
        self.pending_a = None
        self.pending_b = None
        self.H = None
        self.H_inv = None
        self.probe_a = None
        self.probe_b = None
        self.status_var.set("All cleared. Click corresponding points on both images.")
        self._redraw()

    # ── Save ──────────────────────────────────────────────────────────────────

    def _save_json(self):
        if self.H is None:
            messagebox.showwarning("Not calibrated", "Run calibration first before saving.")
            return

        path = filedialog.asksaveasfilename(
            title="Save calibration JSON",
            defaultextension=".json",
            filetypes=[("JSON", "*.json"), ("All files", "*.*")],
            initialfile="calibration.json",
        )
        if not path:
            return

        data = {
            "image_a": self.path_a,
            "image_b": self.path_b,
            "num_pairs": len(self.pairs),
            "point_pairs": [
                {"a": list(pa), "b": list(pb)} for pa, pb in self.pairs
            ],
            "homography_a_to_b": self.H.tolist(),
            "homography_b_to_a": self.H_inv.tolist(),
        }
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        messagebox.showinfo("Saved", f"Calibration saved to:\n{path}")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _update_pair_count(self):
        pending = int(self.pending_a is not None) + int(self.pending_b is not None)
        self.pair_count_var.set(f"Pairs: {len(self.pairs)}  (pending: {pending})")

    def _update_status(self):
        total = len(self.pairs)
        pending_a = self.pending_a is not None
        pending_b = self.pending_b is not None

        if pending_a:
            self.status_var.set(f"{total} pairs  — now click the matching point on Collection B.")
        elif pending_b:
            self.status_var.set(f"{total} pairs  — now click the matching point on Collection A.")
        else:
            needed = max(0, 4 - total)
            if needed:
                self.status_var.set(f"{total} pairs  — need {needed} more pair(s) to calibrate.")
            else:
                self.status_var.set(f"{total} pairs  — click [Calibrate] when ready.")


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

def pick_file(title: str) -> str:
    root = tk.Tk()
    root.withdraw()
    path = filedialog.askopenfilename(
        title=title,
        filetypes=[("Images", "*.png *.jpg *.jpeg *.tif *.tiff *.bmp *.webp"), ("All files", "*.*")]
    )
    root.destroy()
    if not path:
        print("No file selected, exiting.")
        sys.exit(0)
    return path


def main():
    if len(sys.argv) == 3:
        path_a = sys.argv[1]
        path_b = sys.argv[2]
    else:
        print("Select Collection A image...")
        path_a = pick_file("Select Collection A image (e.g. RGB)")
        print("Select Collection B image...")
        path_b = pick_file("Select Collection B image (e.g. Thermal)")

    root = tk.Tk()
    root.configure(bg="#1e1e2e")
    try:
        app = CalibrationApp(root, path_a, path_b)
        root.mainloop()
    except FileNotFoundError as e:
        messagebox.showerror("Error", str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
