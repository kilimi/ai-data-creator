#!/usr/bin/env python3
"""
Test a homography calibration by drawing on one image and watching the
strokes project live onto the other image.

Usage:
    python test_calibration.py <calibration.json>
    python test_calibration.py              # file picker dialogs

Controls:
  - Select which side to draw on with the radio buttons (A / B).
  - Left-click + drag to draw freehand strokes.
  - Right-click to erase all strokes.
  - [Clear Strokes]  – remove all drawn strokes.
  - [Load New Cal…]  – load a different calibration JSON without restarting.
"""

import sys
import json
import tkinter as tk
from tkinter import filedialog, messagebox
import numpy as np
import cv2
from PIL import Image, ImageTk

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

MAX_W = 720
MAX_H = 580
STROKE_COLOR_SRC = "#f38ba8"   # coral  – drawn side
STROKE_COLOR_DST = "#89b4fa"   # blue   – projected side
STROKE_WIDTH = 2


def load_image(path: str) -> np.ndarray:
    img = cv2.imread(path)
    if img is None:
        raise FileNotFoundError(f"Cannot load image: {path}")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def fit_image(img_rgb: np.ndarray, max_w: int, max_h: int):
    h, w = img_rgb.shape[:2]
    scale = min(max_w / w, max_h / h, 1.0)
    nw, nh = int(w * scale), int(h * scale)
    pil = Image.fromarray(img_rgb).resize((nw, nh), Image.LANCZOS)
    return ImageTk.PhotoImage(pil), scale


def apply_homography(H: np.ndarray, x: float, y: float):
    pt = np.array([[[x, y]]], dtype=np.float32)
    res = cv2.perspectiveTransform(pt, H)
    return float(res[0][0][0]), float(res[0][0][1])


def project_polyline(H: np.ndarray, points: list[tuple[float, float]]):
    """Project a list of (x, y) points through H."""
    return [apply_homography(H, x, y) for x, y in points]


# ──────────────────────────────────────────────────────────────────────────────
# App
# ──────────────────────────────────────────────────────────────────────────────

class TestCalibrationApp:

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Test Calibration – Draw & Project")
        self.root.configure(bg="#1e1e2e")

        self.img_a: np.ndarray | None = None
        self.img_b: np.ndarray | None = None
        self.H: np.ndarray | None = None       # A → B
        self.H_inv: np.ndarray | None = None   # B → A
        self.scale_a: float = 1.0
        self.scale_b: float = 1.0
        self._tk_a = None
        self._tk_b = None

        # Strokes: list of lists of (orig_x, orig_y) in the *source* image coords
        # Each stroke is always stored in the space of the image it was drawn on.
        self.strokes_a: list[list[tuple[float, float]]] = []  # drawn on A
        self.strokes_b: list[list[tuple[float, float]]] = []  # drawn on B
        self._current_stroke: list[tuple[float, float]] = []

        # Which side is the user drawing on?
        self.draw_side = tk.StringVar(value="a")

        self._build_ui()

    # ── UI ────────────────────────────────────────────────────────────────────

    def _build_ui(self):
        root = self.root

        # ── toolbar ──
        toolbar = tk.Frame(root, bg="#181825", pady=6)
        toolbar.pack(fill=tk.X, padx=8)

        btn_kw = dict(bg="#313244", fg="#cdd6f4", relief=tk.FLAT,
                      font=("Segoe UI", 9), padx=12, pady=5, cursor="hand2",
                      activebackground="#45475a", activeforeground="#cdd6f4")

        tk.Button(toolbar, text="📂 Load calibration…",
                  command=self._load_calibration_dialog, **btn_kw).pack(side=tk.LEFT, padx=(0, 6))
        tk.Button(toolbar, text="🗑 Clear strokes",
                  command=self._clear_strokes, **btn_kw).pack(side=tk.LEFT, padx=3)

        tk.Label(toolbar, text="  Draw on:", bg="#181825", fg="#a6adc8",
                 font=("Segoe UI", 9)).pack(side=tk.LEFT, padx=(12, 4))
        for val, txt in (("a", "Collection A"), ("b", "Collection B")):
            tk.Radiobutton(toolbar, text=txt, variable=self.draw_side, value=val,
                           bg="#181825", fg="#cdd6f4", selectcolor="#313244",
                           activebackground="#181825", activeforeground="#89b4fa",
                           font=("Segoe UI", 9)).pack(side=tk.LEFT, padx=4)

        self.status_var = tk.StringVar(value="Load a calibration JSON to start.")
        tk.Label(toolbar, textvariable=self.status_var,
                 bg="#181825", fg="#a6e3a1",
                 font=("Segoe UI", 9)).pack(side=tk.RIGHT, padx=8)

        # ── canvas frame ──
        frame_imgs = tk.Frame(root, bg="#1e1e2e")
        frame_imgs.pack(fill=tk.BOTH, expand=True, padx=8, pady=(4, 8))

        self.label_a = tk.Label(frame_imgs, text="Collection A",
                                bg="#1e1e2e", fg="#cdd6f4", font=("Segoe UI", 10, "bold"))
        self.label_a.grid(row=0, column=0, sticky="w", padx=4)

        self.label_b = tk.Label(frame_imgs, text="Collection B",
                                bg="#1e1e2e", fg="#cdd6f4", font=("Segoe UI", 10, "bold"))
        self.label_b.grid(row=0, column=1, sticky="w", padx=4)

        self.canvas_a = tk.Canvas(frame_imgs, width=MAX_W, height=MAX_H,
                                  bg="#181825", highlightthickness=1,
                                  highlightbackground="#585b70")
        self.canvas_a.grid(row=1, column=0, padx=4, pady=4)

        self.canvas_b = tk.Canvas(frame_imgs, width=MAX_W, height=MAX_H,
                                  bg="#181825", highlightthickness=1,
                                  highlightbackground="#585b70")
        self.canvas_b.grid(row=1, column=1, padx=4, pady=4)

        for canvas in (self.canvas_a, self.canvas_b):
            canvas.bind("<ButtonPress-1>", self._on_press)
            canvas.bind("<B1-Motion>", self._on_drag)
            canvas.bind("<ButtonRelease-1>", self._on_release)
            canvas.bind("<Button-3>", lambda _e: self._clear_strokes())

        # Hint
        tk.Label(root, text="Left-drag to draw  ·  Right-click to clear  ·  Coral = drawn side   Blue = projected",
                 bg="#1e1e2e", fg="#585b70", font=("Segoe UI", 8)).pack(pady=(0, 4))

    # ── Load calibration ──────────────────────────────────────────────────────

    def _load_calibration_dialog(self):
        path = filedialog.askopenfilename(
            title="Select calibration JSON",
            filetypes=[("JSON", "*.json"), ("All files", "*.*")]
        )
        if not path:
            return
        self._load_calibration(path)

    def _load_calibration(self, path: str):
        try:
            with open(path) as f:
                data = json.load(f)
        except Exception as e:
            messagebox.showerror("Load error", str(e))
            return

        try:
            self.H = np.array(data["homography_a_to_b"], dtype=np.float64)
            self.H_inv = np.array(data["homography_b_to_a"], dtype=np.float64)
            path_a = data["image_a"]
            path_b = data["image_b"]
        except KeyError as e:
            messagebox.showerror("Invalid calibration file", f"Missing key: {e}")
            return

        try:
            self.img_a = load_image(path_a)
            self.img_b = load_image(path_b)
        except FileNotFoundError:
            # Images may have moved – let user locate them
            messagebox.showwarning(
                "Images not found",
                f"Could not find:\n  {path_a}\n  {path_b}\n\nPlease select them manually."
            )
            path_a = filedialog.askopenfilename(title="Locate Collection A image")
            if not path_a:
                return
            path_b = filedialog.askopenfilename(title="Locate Collection B image")
            if not path_b:
                return
            try:
                self.img_a = load_image(path_a)
                self.img_b = load_image(path_b)
            except FileNotFoundError as e:
                messagebox.showerror("Error", str(e))
                return

        self._clear_strokes()
        self._render_images()

        num_pairs = data.get("num_pairs", "?")
        self.label_a.config(text=f"Collection A  ({path_a.split('/')[-1].split(chr(92))[-1]})")
        self.label_b.config(text=f"Collection B  ({path_b.split('/')[-1].split(chr(92))[-1]})")
        self.status_var.set(f"Calibration loaded  ·  {num_pairs} point pairs  ·  Draw on either image")

    # ── Image rendering ───────────────────────────────────────────────────────

    def _render_images(self):
        if self.img_a is None or self.img_b is None:
            return
        self._tk_a, self.scale_a = fit_image(self.img_a, MAX_W, MAX_H)
        self._tk_b, self.scale_b = fit_image(self.img_b, MAX_W, MAX_H)

        h_a, w_a = self.img_a.shape[:2]
        h_b, w_b = self.img_b.shape[:2]
        self.canvas_a.config(width=int(w_a * self.scale_a), height=int(h_a * self.scale_a))
        self.canvas_b.config(width=int(w_b * self.scale_b), height=int(h_b * self.scale_b))

        self._redraw()

    def _redraw(self):
        self._draw_side(self.canvas_a, self._tk_a, "a")
        self._draw_side(self.canvas_b, self._tk_b, "b")

    def _draw_side(self, canvas: tk.Canvas, tk_img, side: str):
        canvas.delete("all")
        if tk_img is None:
            canvas.create_text(MAX_W // 2, MAX_H // 2,
                                text="Load a calibration JSON to see images",
                                fill="#585b70", font=("Segoe UI", 11))
            return

        canvas.create_image(0, 0, anchor=tk.NW, image=tk_img)
        scale = self.scale_a if side == "a" else self.scale_b

        # Draw strokes that originated on THIS side (coral)
        own_strokes = self.strokes_a if side == "a" else self.strokes_b
        for stroke in own_strokes:
            if len(stroke) < 2:
                continue
            pts = [(x * scale, y * scale) for x, y in stroke]
            self._draw_polyline(canvas, pts, STROKE_COLOR_SRC, STROKE_WIDTH)

        # Draw projected strokes from the OTHER side (blue)
        if self.H is not None:
            other_strokes = self.strokes_b if side == "a" else self.strokes_a
            H_use = self.H_inv if side == "a" else self.H
            for stroke in other_strokes:
                if len(stroke) < 2:
                    continue
                proj = project_polyline(H_use, stroke)
                pts = [(x * scale, y * scale) for x, y in proj]
                self._draw_polyline(canvas, pts, STROKE_COLOR_DST, STROKE_WIDTH, dash=(4, 3))

    @staticmethod
    def _draw_polyline(canvas: tk.Canvas, pts, color: str, width: int, dash=None):
        for i in range(1, len(pts)):
            x0, y0 = pts[i - 1]
            x1, y1 = pts[i]
            kw = dict(fill=color, width=width, capstyle=tk.ROUND, joinstyle=tk.ROUND)
            if dash:
                kw["dash"] = dash
            canvas.create_line(x0, y0, x1, y1, **kw)

    # ── Drawing interaction ───────────────────────────────────────────────────

    def _canvas_side(self, widget) -> str:
        return "a" if widget is self.canvas_a else "b"

    def _screen_to_orig(self, x: float, y: float, side: str):
        scale = self.scale_a if side == "a" else self.scale_b
        return x / scale, y / scale

    def _on_press(self, event):
        if self.img_a is None:
            return
        side = self._canvas_side(event.widget)
        ox, oy = self._screen_to_orig(event.x, event.y, side)
        self._current_stroke = [(ox, oy)]
        self._active_side = side

    def _on_drag(self, event):
        if not self._current_stroke:
            return
        side = self._canvas_side(event.widget)
        if side != self._active_side:
            return
        ox, oy = self._screen_to_orig(event.x, event.y, side)
        self._current_stroke.append((ox, oy))

        # Live redraw only the active canvas for performance, plus project to other
        self._redraw_live(side)

    def _on_release(self, event):
        if not self._current_stroke:
            return
        side = self._active_side
        if side == "a":
            self.strokes_a.append(list(self._current_stroke))
        else:
            self.strokes_b.append(list(self._current_stroke))
        self._current_stroke = []
        self._redraw()

    def _redraw_live(self, drawing_side: str):
        """Fast redraw during drag: update both canvases with current stroke."""
        # Redraw drawing side with current stroke included
        canvas_src = self.canvas_a if drawing_side == "a" else self.canvas_b
        canvas_dst = self.canvas_b if drawing_side == "a" else self.canvas_a
        tk_src = self._tk_a if drawing_side == "a" else self._tk_b
        tk_dst = self._tk_b if drawing_side == "a" else self._tk_a
        scale_src = self.scale_a if drawing_side == "a" else self.scale_b
        scale_dst = self.scale_b if drawing_side == "a" else self.scale_a

        # Temporarily add current stroke to the right list
        if drawing_side == "a":
            self.strokes_a.append(self._current_stroke)
        else:
            self.strokes_b.append(self._current_stroke)

        self._draw_side(canvas_src, tk_src, drawing_side)
        self._draw_side(canvas_dst, tk_dst, "b" if drawing_side == "a" else "a")

        # Remove the temporary stroke
        if drawing_side == "a":
            self.strokes_a.pop()
        else:
            self.strokes_b.pop()

    # ── Strokes management ────────────────────────────────────────────────────

    def _clear_strokes(self):
        self.strokes_a.clear()
        self.strokes_b.clear()
        self._current_stroke = []
        self._redraw()


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

def main():
    root = tk.Tk()
    app = TestCalibrationApp(root)

    cal_path = sys.argv[1] if len(sys.argv) >= 2 else None
    if cal_path:
        root.after(100, lambda: app._load_calibration(cal_path))
    else:
        root.after(100, app._load_calibration_dialog)

    root.mainloop()


if __name__ == "__main__":
    main()
