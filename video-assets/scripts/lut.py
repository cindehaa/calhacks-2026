#!/usr/bin/env python3
"""Writes grade/artifice-frost-fire.cube, a 33-point 3D LUT for the overly serious trailer grade:
cool frost-blue shadows, warm firelight highlights, a firm S-curve and slightly held-back
saturation, after the game's warmth-and-frost palette (meta/aesthetics.md). Apply it to the
gameplay and the face footage alike so the two cut together; pull its strength down to taste.

    python3 scripts/lut.py
"""
import os

N = 33
SHADOW = (-0.035, 0.0, 0.045)  # pushed into the shadows: frost blue (#0d1020 world)
HIGHLIGHT = (0.05, 0.018, -0.04)  # pushed into the highlights: firelight amber (#ffb02e)
CONTRAST = 0.22
SATURATION = 0.9


def s_curve(x):
    # Smoothstep blended with the identity: deeper blacks, brighter tops, mids held.
    s = x * x * (3 - 2 * x)
    return x + (s - x) * CONTRAST * 4 * 0.5


def grade(r, g, b):
    r, g, b = s_curve(r), s_curve(g), s_curve(b)
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    r, g, b = (luma + (c - luma) * SATURATION for c in (r, g, b))
    shadow = (1 - luma) ** 2
    light = luma ** 2
    out = [c + SHADOW[i] * shadow + HIGHLIGHT[i] * light for i, c in enumerate((r, g, b))]
    return [min(1.0, max(0.0, c)) for c in out]


root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
path = os.path.join(root, 'grade', 'artifice-frost-fire.cube')
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w') as f:
    f.write('TITLE "Artifice frost and fire"\n')
    f.write(f'LUT_3D_SIZE {N}\n')
    # .cube order: red changes fastest, then green, then blue.
    for bi in range(N):
        for gi in range(N):
            for ri in range(N):
                r, g, b = grade(ri / (N - 1), gi / (N - 1), bi / (N - 1))
                f.write(f'{r:.6f} {g:.6f} {b:.6f}\n')
print(f'wrote {os.path.relpath(path, root)}')
