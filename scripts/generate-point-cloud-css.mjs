/**
 * 3D 点云活动指示器（12 套宽幅 + 紧凑动态装置）纯 CSS 关键帧生成器。
 *
 * 设计意图 (Why)：
 *   6 套 30×16px 宽幅装置（深海光鲸/律动星茧/无限管网/极光云网/双极星涡/跃迁螺旋）与
 *   6 套 18×18px 紧凑装置（鲸跃/翻滚环网/涌动云网/经纬点球/莫比乌斯/双极星涌）全部使用
 *   预烘焙 3D 透视投影关键帧（纯 transform + opacity），运行时零 JS 帧循环、零 <svg>、
 *   零硬编码色相，并自动计算带负 delay 共享轨道在壁钟 t=0 的静态 3D 分布，保证减弱动效下仍完整成网。
 *
 * 防范的历史坑 (Pitfall)：
 *   1. `torus-mesh` / `sphere-mesh` / `mobius-band` 同一环面上的粒子共享同一条关键帧、仅以负 `animation-delay` 错开相位；
 *      若静态回退位置一律用 t=0，关闭动效时会坍缩叠成 2~4 颗点！必须按 `t0 = ((-delay/dur) % 1 + 1) % 1` 采样静态坐标；
 *   2. 每条 `animation: ... infinite;` 声明必须附带 `gate-perf-allow` 注释，确保通过静态性能门禁。
 *
 * 约束与规则 (Rules)：
 *   - 幂等写入 `packages/ui/src/styles/conversation.css` 内的 GENERATED POINT-CLOUD 起止标记之间；
 *   - 粒子数量与类名 `.flux-pc-<code>-<i>` 必须与 `tokens/activityIndicator.ts` POINT_CLOUD_SPECS 1:1 一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const CONVERSATION_CSS = path.join(REPO_ROOT, 'packages/ui/src/styles/conversation.css');

const BEGIN_MARKER = '/* BEGIN GENERATED POINT-CLOUD INDICATORS (scripts/generate-point-cloud-css.mjs) */';
const END_MARKER = '/* END GENERATED POINT-CLOUD INDICATORS */';

const TAU = Math.PI * 2;
const fmt = (n) => {
  const s = n.toFixed(2).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};
const fmtDur = (n) => {
  const s = n.toFixed(3).replace(/\.?0+$/, '');
  return (s === '-0' ? '0' : s) + 's';
};

function rotX(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}
function rotY(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}
function rotZ(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function projectPoint(p, cx, cy, focal, rMax) {
  const depth = focal / (focal - p[2]);
  const x = cx + p[0] * depth;
  const y = cy + p[1] * depth;
  const zn = Math.max(0, Math.min(1, (p[2] + rMax) / (2 * rMax)));
  const scale = 0.56 + 0.62 * zn;
  const opacity = 0.14 + 0.86 * Math.pow(zn, 1.45);
  return { x, y, scale, opacity };
}

function formatTransform(pr) {
  return `transform: translate3d(${fmt(pr.x)}px, ${fmt(pr.y)}px, 0) scale(${fmt(pr.scale)}); opacity: ${fmt(pr.opacity)};`;
}

function buildKeyframeBlock(name, steps, cx, cy, focal, rMax, pointAt) {
  const frames = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pct = fmt(t * 100);
    const pr = projectPoint(pointAt(t), cx, cy, focal, rMax);
    frames.push(`${pct}% { ${formatTransform(pr)} }`);
  }
  return `@keyframes ${name} {\n  ${frames.join('\n  ')}\n}`;
}

function buildVariants() {
  const sections = [];

  const registerVariant = (header, code, builder) => {
    const tracks = new Map();
    const dotRules = [];
    let dotIdx = 0;
    const addDot = ({ kf, steps, cx, cy, focal, rMax, dur, delay, pointAt }) => {
      if (!tracks.has(kf)) {
        tracks.set(kf, { kf, css: buildKeyframeBlock(kf, steps, cx, cy, focal, rMax, pointAt), pointAt, cx, cy, focal, rMax });
      }
      const tr = tracks.get(kf);
      const t0 = ((delay === 0 ? 0 : (-delay / dur) % 1) + 1) % 1;
      const pr0 = projectPoint(tr.pointAt(t0), tr.cx, tr.cy, tr.focal, tr.rMax);
      dotRules.push(
        `.flux-pc-${code}-${dotIdx} { ${formatTransform(pr0)} animation: ${kf} ${fmtDur(dur)} linear ${fmtDur(delay)} infinite; } /* gate-perf-allow: 3D点云纯合成层 */`,
      );
      dotIdx += 1;
    };

    builder(addDot);
    sections.push(
      `/* ${header} */\n${dotRules.join('\n')}\n${[...tracks.values()].map((t) => t.css).join('\n')}`,
    );
  };

  // G. abyss-whale (wide 30x16, 26 dots)
  registerVariant('G. abyss-whale（深海光鲸 · 30x16 · 26 点）', 'g', (addDot) => {
    const dur = 6.6;
    const stations = [
      { u: -0.92, rx: 1.4, rz: 1.3, n: 3 },
      { u: -0.52, rx: 2.7, rz: 2.8, n: 5 },
      { u: -0.08, rx: 2.5, rz: 2.6, n: 5 },
      { u:  0.34, rx: 1.8, rz: 1.9, n: 4 },
      { u:  0.72, rx: 1.0, rz: 1.1, n: 3 },
    ];
    const applyWhale = (xBase, yLocal, zLocal, u, t) => {
      const phase = t * TAU;
      const tailWeight = Math.pow((u + 1) / 2, 1.15);
      const swimY = (0.55 + 1.55 * tailWeight) * Math.sin(u * 2.5 - phase * 2);
      const swimZ = 0.45 * Math.cos(u * 1.9 - phase);
      const cr = Math.cos(phase), sr = Math.sin(phase);
      const ry = yLocal * cr - zLocal * sr;
      const rz = yLocal * sr + zLocal * cr;
      let p = [xBase, ry + swimY, rz + swimZ];
      p = rotY(p, 0.34 * Math.sin(phase) + 0.14);
      p = rotX(p, 0.28 * Math.cos(phase) + 0.16);
      p = rotZ(p, -0.10 + 0.12 * Math.sin(phase));
      return p;
    };
    let idx = 0;
    stations.forEach((st, si) => {
      const xBase = st.u * 11.4;
      for (let k = 0; k < st.n; k++) {
        const ang = (k * TAU) / st.n + si * 0.35;
        const y0 = st.rx * Math.cos(ang);
        const z0 = st.rz * Math.sin(ang);
        addDot({ kf: `fluxPcG${idx++}`, steps: 24, cx: 15, cy: 8, focal: 46, rMax: 7.6, dur, delay: 0, pointAt: (t) => applyWhale(xBase, y0, z0, st.u, t) });
      }
    });
    [-1, 1].forEach((side) => {
      addDot({
        kf: `fluxPcG${idx++}`,
        steps: 24, cx: 15, cy: 8, focal: 46, rMax: 7.6, dur, delay: 0,
        pointAt: (t) => {
          const flap = 0.75 * Math.sin(t * TAU * 2 - 0.8);
          return applyWhale(-3.6, -1.1 + flap, side * 4.7, -0.32, t);
        },
      });
    });
    [
      { u: 0.96, y: 0, z: -2.9 },
      { u: 0.96, y: 0, z:  2.9 },
      { u: 0.88, y: 0.2, z: -1.4 },
      { u: 0.88, y: -0.2, z: 1.4 },
    ].forEach((fl) => {
      addDot({
        kf: `fluxPcG${idx++}`,
        steps: 24, cx: 15, cy: 8, focal: 46, rMax: 7.6, dur, delay: 0,
        pointAt: (t) => applyWhale(fl.u * 11.6, fl.y, fl.z, fl.u, t),
      });
    });
  });

  // H. prolate-lattice (wide 30x16, 28 dots)
  registerVariant('H. prolate-lattice（律动星茧 · 30x16 · 28 点）', 'h', (addDot) => {
    const dur = 6.2;
    const rings = [
      { u: -0.84, r: 2.1, n: 4, off: 0.2 },
      { u: -0.44, r: 3.7, n: 6, off: 0.0 },
      { u:  0.00, r: 4.3, n: 8, off: 0.2 },
      { u:  0.44, r: 3.7, n: 6, off: 0.0 },
      { u:  0.84, r: 2.1, n: 4, off: 0.2 },
    ];
    let idx = 0;
    rings.forEach((rg) => {
      for (let k = 0; k < rg.n; k++) {
        const theta0 = (k * TAU) / rg.n + rg.off;
        addDot({
          kf: `fluxPcH${idx++}`,
          steps: 24, cx: 15, cy: 8, focal: 46, rMax: 7.6, dur, delay: 0,
          pointAt: (t) => {
            const phase = t * TAU;
            const breath = 1 + 0.22 * Math.sin(rg.u * 2.8 - phase * 2);
            const twist = 0.78 * Math.sin(rg.u * 2.2 + phase);
            const a = theta0 + phase + twist;
            const rad = rg.r * breath;
            const x0 = rg.u * 11.6 + 0.55 * Math.cos(rg.u * 2.5 - phase * 2);
            let p = [x0, rad * Math.cos(a), rad * Math.sin(a)];
            p = rotY(p, 0.34 * Math.sin(phase));
            p = rotX(p, 0.36 + 0.20 * Math.cos(phase));
            p = rotZ(p, -0.10 + 0.10 * Math.sin(phase));
            return p;
          },
        });
      }
    });
  });

  // I. infinity-knot (wide 30x16, 26 dots)
  registerVariant('I. infinity-knot（无限管网 · 30x16 · 26 点）', 'i', (addDot) => {
    const dur = 6.8;
    const centerAt = (u) => [10.8 * Math.sin(u), 3.4 * Math.sin(u) * Math.cos(u), 2.6 * Math.sin(2 * u)];
    let idx = 0;
    for (let s = 0; s < 2; s++) {
      for (let k = 0; k < 13; k++) {
        const u0 = (k * TAU) / 13 + s * 0.14;
        addDot({
          kf: `fluxPcI${idx++}`,
          steps: 26, cx: 15, cy: 8, focal: 46, rMax: 7.6, dur, delay: 0,
          pointAt: (t) => {
            const phase = t * TAU;
            const u = u0 + phase;
            const c = centerAt(u);
            const c2 = centerAt(u + 0.02);
            const T = norm3([c2[0] - c[0], c2[1] - c[1], c2[2] - c[2]]);
            const N = norm3(cross3(T, [0, 0, 1]));
            const B = cross3(T, N);
            const v = s * Math.PI + u * 3;
            const rTube = 1.65 + 0.35 * Math.cos(u * 2);
            let p = [
              c[0] + rTube * (Math.cos(v) * N[0] + Math.sin(v) * B[0]),
              c[1] + rTube * (Math.cos(v) * N[1] + Math.sin(v) * B[1]),
              c[2] + rTube * (Math.cos(v) * N[2] + Math.sin(v) * B[2]),
            ];
            p = rotX(p, 0.44 + 0.28 * Math.sin(phase));
            p = rotY(p, 0.32 * Math.cos(phase));
            p = rotZ(p, 0.08 * Math.sin(phase));
            return p;
          },
        });
      }
    }
  });

  // J. surf-ribbon (wide 30x16, 24 dots)
  registerVariant('J. surf-ribbon（极光云网 · 30x16 · 24 点）', 'j', (addDot) => {
    const dur = 6.4;
    let idx = 0;
    for (let ix = 0; ix < 8; ix++) {
      const u = -1 + (2 * ix) / 7;
      const xBase = u * 11.4;
      for (let iv = 0; iv < 3; iv++) {
        const v = iv - 1;
        addDot({
          kf: `fluxPcJ${idx++}`,
          steps: 24, cx: 15, cy: 8, focal: 46, rMax: 7.6, dur, delay: 0,
          pointAt: (t) => {
            const phase = t * TAU;
            const swell = 2.05 * Math.sin(u * 2.5 - phase * 2) + 0.85 * Math.cos(u * 3.8 + phase);
            const ribTwist = u * 1.35 + phase + 0.45 * Math.sin(u * 1.8 - phase);
            const halfW = 3.1 * (0.72 + 0.28 * Math.cos(u * 1.2));
            let p = [xBase, v * halfW * Math.cos(ribTwist) + 0.55 * swell, v * halfW * Math.sin(ribTwist) + swell];
            p = rotX(p, 0.50 + 0.20 * Math.sin(phase));
            p = rotY(p, 0.30 * Math.cos(phase));
            return p;
          },
        });
      }
    }
  });

  // K. twin-vortex (wide 30x16, 26 dots)
  registerVariant('K. twin-vortex（双极星涡 · 30x16 · 26 点）', 'k', (addDot) => {
    const dur = 6.0;
    const centerAt = (u) => {
      const s = Math.sin(u), c = Math.cos(u);
      const d = 1 + s * s;
      return [(10.2 * c) / d, (3.8 * s * c) / d, 2.4 * Math.sin(2 * u)];
    };
    let idx = 0;
    for (let st = 0; st < 2; st++) {
      for (let k = 0; k < 13; k++) {
        const u0 = (k * TAU) / 13;
        addDot({
          kf: `fluxPcK${idx++}`,
          steps: 26, cx: 15, cy: 8, focal: 46, rMax: 7.6, dur, delay: 0,
          pointAt: (t) => {
            const phase = t * TAU;
            const u = u0 + phase;
            const c = centerAt(u);
            const c2 = centerAt(u + 0.02);
            const T = norm3([c2[0] - c[0], c2[1] - c[1], c2[2] - c[2]]);
            const Nv = norm3(cross3(T, [0, 0, 1]));
            const Bv = cross3(T, Nv);
            const lobeBulge = 0.85 + 2.05 * Math.abs(Math.cos(u));
            const v = st * Math.PI + u * 4 - phase;
            let p = [
              c[0] + lobeBulge * (Math.cos(v) * Nv[0] + Math.sin(v) * Bv[0]),
              c[1] + lobeBulge * (Math.cos(v) * Nv[1] + Math.sin(v) * Bv[1]),
              c[2] + lobeBulge * (Math.cos(v) * Nv[2] + Math.sin(v) * Bv[2]),
            ];
            p = rotX(p, 0.56 + 0.22 * Math.sin(phase));
            p = rotY(p, 0.34 * Math.cos(phase));
            return p;
          },
        });
      }
    }
  });

  // L. kinetic-helix (wide 30x16, 24 dots)
  registerVariant('L. kinetic-helix（跃迁螺旋 · 30x16 · 24 点）', 'l', (addDot) => {
    const dur = 5.8;
    let idx = 0;
    for (let s = 0; s < 3; s++) {
      for (let k = 0; k < 8; k++) {
        const frac = k / 7;
        const u = -1 + 2 * frac;
        const env = 0.34 + 0.66 * Math.sin(Math.PI * frac);
        addDot({
          kf: `fluxPcL${idx++}`,
          steps: 24, cx: 15, cy: 8, focal: 46, rMax: 7.6, dur, delay: 0,
          pointAt: (t) => {
            const phase = t * TAU;
            const x = u * 11.2 + 1.05 * Math.sin(u * 2.4 - phase * 2);
            const spineY = 1.45 * Math.sin(u * 2.1 - phase);
            const spineZ = 1.35 * Math.cos(u * 2.1 - phase);
            const ang = (s * TAU) / 3 + u * 3.3 - phase * 2;
            const rad = 3.45 * env;
            let p = [x, spineY + rad * Math.cos(ang), spineZ + rad * Math.sin(ang)];
            p = rotX(p, 0.32 + 0.18 * Math.sin(phase));
            p = rotY(p, 0.26 * Math.cos(phase));
            return p;
          },
        });
      }
    }
  });

  // A. whale-compact (sq 18x18, 18 dots)
  registerVariant('A. whale-compact（鲸跃点云 · 18x18 · 18 点）', 'a', (addDot) => {
    const dur = 5.6;
    let idx = 0;
    for (let iu = 0; iu < 6; iu++) {
      const u = -1 + (2 * iu) / 5;
      const s = (u + 1) / 2;
      const radius = 0.7 + 2.65 * Math.sin(Math.PI * Math.pow(s, 0.72));
      const xBase = u * 6.4;
      for (let iv = 0; iv < 3; iv++) {
        const phi0 = (iv * TAU) / 3 + iu * 0.22;
        addDot({
          kf: `fluxPcA${idx++}`,
          steps: 20, cx: 9, cy: 9, focal: 34, rMax: 6.8, dur, delay: 0,
          pointAt: (t) => {
            const phase = t * TAU;
            const waveY = 1.9 * Math.sin(u * 2.5 - phase);
            const phi = phi0 + phase;
            let p = [xBase, waveY + radius * Math.cos(phi) * 0.85, radius * Math.sin(phi)];
            p = rotY(p, 0.45 * Math.sin(phase) + 0.35);
            p = rotX(p, 0.38 * Math.cos(phase) + 0.22);
            p = rotZ(p, -0.25 + 0.18 * Math.sin(phase));
            return p;
          },
        });
      }
    }
  });

  // B. torus-mesh (sq 18x18, 20 dots via 4 shared braid tracks)
  registerVariant('B. torus-mesh（翻滚环网 · 18x18 · 20 点）', 'b', (addDot) => {
    const R = 4.5, r = 2.35, dur = 6.2;
    for (let b = 0; b < 4; b++) {
      const vOffset = (b * TAU) / 4;
      const pointAt = (t) => {
        const u = t * TAU, v = vOffset + t * TAU;
        let p = [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];
        p = rotX(p, 1.02); p = rotY(p, 0.36); p = rotZ(p, -0.32);
        return p;
      };
      for (let k = 0; k < 5; k++) {
        addDot({ kf: `fluxPcB${b}`, steps: 24, cx: 9, cy: 9, focal: 34, rMax: 7.2, dur, delay: -(k / 5) * dur, pointAt });
      }
    }
  });

  // C. wave-net (sq 18x18, 16 dots)
  registerVariant('C. wave-net（涌动云网 · 18x18 · 16 点）', 'c', (addDot) => {
    const dur = 6.8;
    let idx = 0;
    for (let ix = 0; ix < 4; ix++) {
      for (let iy = 0; iy < 4; iy++) {
        const gx = (ix - 1.5) * 3.1, gy = (iy - 1.5) * 3.1;
        addDot({
          kf: `fluxPcC${idx++}`,
          steps: 20, cx: 9, cy: 9, focal: 34, rMax: 7.4, dur, delay: 0,
          pointAt: (t) => {
            const phase = t * TAU;
            let p = [gx, gy, 2.05 * Math.sin(ix * 1.05 + iy * 0.75 - phase * 2)];
            p = rotZ(p, phase); p = rotX(p, 1.04 + 0.14 * Math.sin(phase)); p = rotY(p, 0.18 * Math.cos(phase));
            return p;
          },
        });
      }
    }
  });

  // D. sphere-mesh (sq 18x18, 20 dots via 3 shared latitude ring tracks)
  registerVariant('D. sphere-mesh（经纬点球 · 18x18 · 20 点）', 'd', (addDot) => {
    const R = 6.4, dur = 5.8;
    [
      { lat: 0.66, count: 6, shift: 0.25 },
      { lat: 0.0,  count: 8, shift: 0 },
      { lat: -0.66, count: 6, shift: 0.55 },
    ].forEach((rg, ri) => {
      const y0 = R * Math.sin(rg.lat), rr = R * Math.cos(rg.lat);
      const pointAt = (t) => {
        const a = t * TAU;
        let p = [rr * Math.cos(a), y0, rr * Math.sin(a)];
        p = rotX(p, 0.46); p = rotZ(p, -0.34);
        return p;
      };
      for (let k = 0; k < rg.count; k++) {
        addDot({
          kf: `fluxPcD${ri}`,
          steps: 24, cx: 9, cy: 9, focal: 34, rMax: 6.8, dur,
          delay: -((k / rg.count + rg.shift) % 1) * dur,
          pointAt,
        });
      }
    });
  });

  // E. mobius-band (sq 18x18, 18 dots via 2 shared tracks)
  registerVariant('E. mobius-band（莫比乌斯 · 18x18 · 18 点）', 'e', (addDot) => {
    const R = 4.9, W = 2.05, durEdge = 7.4, durMid = 3.7;
    const edgePointAt = (t) => {
      const u = t * TAU * 2, h = u / 2;
      let p = [(R + W * Math.cos(h)) * Math.cos(u), (R + W * Math.cos(h)) * Math.sin(u), W * Math.sin(h)];
      p = rotX(p, 0.96); p = rotY(p, 0.42);
      return p;
    };
    for (let k = 0; k < 12; k++) {
      addDot({
        kf: 'fluxPcEEdge',
        steps: 32, cx: 9, cy: 9, focal: 34, rMax: 7.2, dur: durEdge, delay: -(k / 12) * durEdge,
        pointAt: edgePointAt,
      });
    }
    const midPointAt = (t) => {
      const u = t * TAU;
      let p = [R * Math.cos(u), R * Math.sin(u), 0];
      p = rotX(p, 0.96); p = rotY(p, 0.42);
      return p;
    };
    for (let k = 0; k < 6; k++) {
      addDot({
        kf: 'fluxPcEMid',
        steps: 20, cx: 9, cy: 9, focal: 34, rMax: 7.2, dur: durMid, delay: -(k / 6) * durMid,
        pointAt: midPointAt,
      });
    }
  });

  // F. dipole-vortex (sq 18x18, 18 dots)
  registerVariant('F. dipole-vortex（双极星涌 · 18x18 · 18 点）', 'f', (addDot) => {
    const dur = 5.4;
    let idx = 0;
    for (let l = 0; l < 3; l++) {
      const az0 = (l * TAU) / 3;
      for (let k = 0; k < 6; k++) {
        const p0 = (k * TAU) / 6;
        addDot({
          kf: `fluxPcF${idx++}`,
          steps: 20, cx: 9, cy: 9, focal: 34, rMax: 7.2, dur, delay: 0,
          pointAt: (t) => {
            const phase = t * TAU, a = p0 + phase;
            const rad = 3.2 + 3.0 * Math.cos(a), y = 5.2 * Math.sin(a), az = az0 + phase;
            let p = [rad * Math.cos(az), y, rad * Math.sin(az)];
            p = rotX(p, 0.48); p = rotZ(p, -0.28);
            return p;
          },
        });
      }
    }
  });

  return sections.join('\n\n');
}

export function generatePointCloudBlock() {
  const baseCss = [
    '.flux-pc-canvas { position: relative; display: inline-block; flex-shrink: 0; pointer-events: none; }',
    '.flux-pc-canvas--wide { width: 30px; height: 16px; }',
    '.flux-pc-canvas--sq { width: 18px; height: 18px; }',
    '.flux-pc-dot { position: absolute; left: 0; top: 0; width: 1.45px; height: 1.45px; margin-left: -0.725px; margin-top: -0.725px; border-radius: var(--radius-pill, 9999px); background: var(--flux-activity-ink); will-change: transform, opacity; pointer-events: none; }',
    '.flux-pc-done { position: relative; width: 18px; height: 16px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }',
    '.flux-pc-done-ring { width: 11px; height: 11px; border-radius: var(--radius-pill, 9999px); border: 1.2px solid var(--flux-activity-ink-done); background: var(--flux-activity-ink-soft); display: flex; align-items: center; justify-content: center; }',
    '.flux-pc-done-tick { width: 5px; height: 2.8px; border-left: 1.35px solid var(--flux-activity-ink-done); border-bottom: 1.35px solid var(--flux-activity-ink-done); transform: rotate(-45deg) translate(0.35px, -0.35px); }',
    '.flux-pc-done-spark { position: absolute; width: 1.6px; height: 1.6px; border-radius: var(--radius-pill, 9999px); background: var(--flux-activity-ink-done); opacity: 0.65; pointer-events: none; }',
    '.flux-pc-done-spark--a { left: 50%; top: 0.5px; margin-left: -0.8px; }',
    '.flux-pc-done-spark--b { right: 1px; bottom: 2px; }',
    '.flux-pc-done-spark--c { left: 1px; bottom: 2px; }',
    '.flux-cloud-indicator--unread[data-transition="just-completed"] .flux-pc-done-ring { animation: fluxCloudCheckArrive 460ms var(--ease-spring) 1 both; }',
    '.flux-cloud-indicator--unread[data-transition="just-completed"] .flux-pc-done-spark { animation: fluxSynapseNodeSettle 460ms var(--ease-spring) 1 both; }',
  ].join('\n');

  return `${BEGIN_MARKER}\n${baseCss}\n\n${buildVariants()}\n${END_MARKER}`;
}

function main() {
  const src = fs.readFileSync(CONVERSATION_CSS, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const block = generatePointCloudBlock().replace(/\r?\n/g, eol);

  const beginIdx = src.indexOf(BEGIN_MARKER);
  const endIdx = src.indexOf(END_MARKER);
  let next;
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    next = src.slice(0, beginIdx) + block + src.slice(endIdx + END_MARKER.length);
  } else {
    const anchor = '/* 全变体页面隐藏节能与无障碍降级统一挂接 */';
    const anchorIdx = src.indexOf(anchor);
    if (anchorIdx === -1) {
      throw new Error(`未找到锚点注释: ${anchor}`);
    }
    next = src.slice(0, anchorIdx) + block + eol + eol + src.slice(anchorIdx);
  }

  if (next !== src) {
    fs.writeFileSync(CONVERSATION_CSS, next, 'utf8');
    console.log(`Updated ${path.relative(REPO_ROOT, CONVERSATION_CSS)} (${Buffer.byteLength(block, 'utf8')} bytes generated)`);
  } else {
    console.log('No changes needed (already up to date)');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(HERE, 'generate-point-cloud-css.mjs')) {
  main();
}
