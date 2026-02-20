import * as THREE from "three";
import { clamp, getModelTierMeta } from "./runtimeConfig.js";

const COLOR_SLOTS = 4;
const DEFAULT_TRANSITION_MS = 2600;
const TARGET_FPS = 50;

const BOT_MOODS = {
  route_chat: {
    label: "Контекст: Чаты",
    description: "Рабочий фон диалогов",
    palette: ["#120a24", "#271543", "#43206b", "#6a329a"],
    speed: 0.36,
    energy: 0.43,
    warp: 0.56,
    pulse: 0.52,
    grain: 0.15,
  },
  route_plugins: {
    label: "Контекст: Маркетплейс",
    description: "Исследование и каталог плагинов",
    palette: ["#08131c", "#123140", "#1e5c70", "#2b90a6"],
    speed: 0.29,
    energy: 0.34,
    warp: 0.39,
    pulse: 0.44,
    grain: 0.13,
  },
  route_settings: {
    label: "Контекст: Настройки",
    description: "Спокойный фон управления конфигурацией",
    palette: ["#0c1020", "#1b2740", "#2b3c63", "#40588a"],
    speed: 0.2,
    energy: 0.22,
    warp: 0.23,
    pulse: 0.28,
    grain: 0.09,
  },
  neutral: {
    label: "Нейтрально",
    description: "Готов к работе",
    palette: ["#130924", "#241240", "#341d57", "#4a2b77"],
    speed: 0.28,
    energy: 0.34,
    warp: 0.32,
    pulse: 0.34,
    grain: 0.12,
  },
  thinking: {
    label: "Размышление",
    description: "Анализ запроса",
    palette: ["#1a1508", "#47381a", "#7d6324", "#b58b34"],
    speed: 0.24,
    energy: 0.31,
    warp: 0.28,
    pulse: 0.39,
    grain: 0.12,
  },
  waiting: {
    label: "Ожидание",
    description: "Ожидание ответа",
    palette: ["#151007", "#3a2b11", "#6f501d", "#c0892e"],
    speed: 0.2,
    energy: 0.27,
    warp: 0.24,
    pulse: 0.46,
    grain: 0.11,
  },
  success: {
    label: "Успех",
    description: "Успешное выполнение",
    palette: ["#07130d", "#0f2f1f", "#1b5f3a", "#2ea35f"],
    speed: 0.33,
    energy: 0.41,
    warp: 0.4,
    pulse: 0.54,
    grain: 0.13,
  },
  friendly: {
    label: "Дружелюбно",
    description: "Спокойный дружелюбный тон",
    palette: ["#081313", "#13312c", "#196a57", "#3db49c"],
    speed: 0.27,
    energy: 0.35,
    warp: 0.34,
    pulse: 0.48,
    grain: 0.13,
  },
  planning: {
    label: "Планирование",
    description: "Структурирование шагов",
    palette: ["#0a1325", "#163457", "#275a8a", "#3d81c6"],
    speed: 0.24,
    energy: 0.32,
    warp: 0.33,
    pulse: 0.42,
    grain: 0.12,
  },
  coding: {
    label: "Кодинг",
    description: "Активная инженерная работа",
    palette: ["#071125", "#0f2a56", "#1a4f9a", "#2f74de"],
    speed: 0.39,
    energy: 0.48,
    warp: 0.52,
    pulse: 0.57,
    grain: 0.17,
  },
  researching: {
    label: "Исследование",
    description: "Поиск и анализ источников",
    palette: ["#07171b", "#114151", "#1b7089", "#2aa9ca"],
    speed: 0.31,
    energy: 0.38,
    warp: 0.43,
    pulse: 0.46,
    grain: 0.14,
  },
  warning: {
    label: "Предупреждение",
    description: "Риск или спорная зона",
    palette: ["#1a1106", "#4a2f0f", "#8b5818", "#d7922a"],
    speed: 0.36,
    energy: 0.46,
    warp: 0.49,
    pulse: 0.58,
    grain: 0.16,
  },
  offline: {
    label: "Офлайн",
    description: "Сервер недоступен",
    palette: ["#0d0e12", "#1d222d", "#323b49", "#505d6e"],
    speed: 0.12,
    energy: 0.14,
    warp: 0.14,
    pulse: 0.2,
    grain: 0.08,
  },
  creative: {
    label: "Креатив",
    description: "Генерация идей и концептов",
    palette: ["#130a1d", "#3a184f", "#6c2482", "#a63bc0"],
    speed: 0.42,
    energy: 0.5,
    warp: 0.57,
    pulse: 0.62,
    grain: 0.2,
  },
  error: {
    label: "Ошибка",
    description: "Ошибка или сбой",
    palette: ["#170809", "#3a0f14", "#6d1722", "#b92a34"],
    speed: 0.44,
    energy: 0.55,
    warp: 0.58,
    pulse: 0.63,
    grain: 0.2,
  },
  aggression: {
    label: "Агрессия",
    description: "Жёсткая реакция",
    palette: ["#150607", "#300a0e", "#5a1019", "#8f1723"],
    speed: 0.56,
    energy: 0.63,
    warp: 0.64,
    pulse: 0.68,
    grain: 0.22,
  },
};

const VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uEnergy;
  uniform float uWarp;
  uniform float uPulse;
  uniform float uGrain;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uColor4;

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;

    for (int i = 0; i < 4; i++) {
      value += amp * noise(p);
      p = p * 2.0 + vec2(11.3, 7.1);
      amp *= 0.5;
    }

    return value;
  }

  void main() {
    vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    vec2 p = (vUv - 0.5) * aspect;
    float t = uTime * (0.22 + uSpeed);
    float pulse = 0.5 + 0.5 * sin(t * (0.75 + uPulse * 2.2));

    vec2 drift = vec2(
      fbm(p * (1.0 + uWarp * 0.35) + vec2(t * (0.15 + uWarp * 0.14), -t * (0.11 + uWarp * 0.09))),
      fbm(p * (1.24 + uWarp * 0.28) + vec2(-t * (0.1 + uWarp * 0.12), t * (0.14 + uWarp * 0.07)))
    ) - 0.5;

    vec2 swirl = vec2(
      sin((p.y + t * 0.8) * (1.3 + uWarp * 1.8)),
      cos((p.x - t * 0.6) * (1.2 + uWarp * 1.6))
    );

    p += drift * (0.2 + uEnergy * 0.32 + pulse * 0.08 * uWarp);
    p += swirl * (0.015 + 0.055 * uWarp);

    float m1 = smoothstep(0.11, 0.9, fbm(p * (1.05 + uWarp * 0.45) + t * (0.06 + uPulse * 0.05)));
    float m2 = smoothstep(0.08, 0.92, fbm(p * (1.35 + uWarp * 0.38) - t * (0.04 + uPulse * 0.05) + 2.7));
    float m3 = smoothstep(0.09, 0.91, fbm(p * (0.88 + uWarp * 0.32) + t * (0.03 + uPulse * 0.04) + 8.2));

    vec3 toneA = mix(uColor1, uColor2, m1);
    vec3 toneB = mix(uColor3, uColor4, m2);
    vec3 color = mix(toneA, toneB, m3);

    float glow = fbm(p * (1.7 + uWarp * 0.7) - t * 0.03 + pulse * 0.9);
    color = mix(color, mix(uColor2, uColor3, glow), (0.15 + 0.1 * pulse) * uEnergy);

    float grain = (hash(vUv * uResolution + vec2(t * 57.3, -t * 33.7)) - 0.5) * (0.045 * uGrain);
    color += grain;

    float vignette = smoothstep(1.06, 0.2, length((vUv - 0.5) * aspect * 1.05));
    color *= mix(0.82, 1.1, vignette);
    color = pow(clamp(color, 0.0, 1.0), vec3(0.94));

    gl_FragColor = vec4(color, 1.0);
  }
`;

const easeInOutCubic = (value) => (
  value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2
);

function hexToVector(hex) {
  const color = new THREE.Color(hex);
  return new THREE.Vector3(color.r, color.g, color.b);
}

function normalizePalette(palette) {
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new Error("Палитра должна быть непустым массивом.");
  }

  const result = [];
  for (let index = 0; index < COLOR_SLOTS; index += 1) {
    result.push(palette[index % palette.length]);
  }
  return result;
}

function sanitizeMoodConfig(name, config) {
  if (!config || !Array.isArray(config.palette) || config.palette.length === 0) {
    throw new Error(`Состояние "${name}" должно содержать палитру.`);
  }

  return {
    label: config.label || name,
    description: config.description || "Пользовательское состояние",
    palette: normalizePalette(config.palette),
    speed: clamp(Number(config.speed ?? 0.3), 0.05, 1.2),
    energy: clamp(Number(config.energy ?? 0.35), 0.05, 1.2),
    warp: clamp(Number(config.warp ?? 0.35), 0.0, 1.2),
    pulse: clamp(Number(config.pulse ?? 0.4), 0.0, 1.2),
    grain: clamp(Number(config.grain ?? 0.1), 0.0, 1.0),
  };
}

export class StatefulLiquidBackground {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.moods = new Map();
    Object.entries(BOT_MOODS).forEach(([name, mood]) => {
      this.moods.set(name, sanitizeMoodConfig(name, mood));
    });

    this.onMoodChange = options.onMoodChange || (() => {});
    this.onStats = options.onStats || (() => {});

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });

    this.baseMaxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.baseMinPixelRatio = 0.6;
    this.maxPixelRatio = this.baseMaxPixelRatio;
    this.minPixelRatio = 0.75;
    this.currentPixelRatio = Math.max(this.minPixelRatio, this.maxPixelRatio - 0.2);
    this.renderer.setPixelRatio(this.currentPixelRatio);

    this.currentMoodName = "neutral";
    this.transition = null;
    this.lastFrameTime = 0;
    this.frameAccumulator = 0;
    this.frameDeltaAverage = 20;
    this.qualitySampleCounter = 0;
    this.targetFps = TARGET_FPS;
    this.frameBudgetMs = 1000 / this.targetFps;
    this.qualityHighThresholdMs = 26;
    this.qualityLowThresholdMs = 18;
    this.qualityDownStep = 0.08;
    this.qualityUpStep = 0.05;
    this.motionEnabled = true;

    const initialMood = this.moods.get(this.currentMoodName);

    this.uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uSpeed: { value: initialMood.speed },
      uEnergy: { value: initialMood.energy },
      uWarp: { value: initialMood.warp },
      uPulse: { value: initialMood.pulse },
      uGrain: { value: initialMood.grain },
      uColor1: { value: hexToVector(initialMood.palette[0]) },
      uColor2: { value: hexToVector(initialMood.palette[1]) },
      uColor3: { value: hexToVector(initialMood.palette[2]) },
      uColor4: { value: hexToVector(initialMood.palette[3]) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);
  }

  mount() {
    this.onResize();
    window.addEventListener("resize", this.onResize);
    this.lastFrameTime = performance.now();
    this.tick(this.lastFrameTime);
  }

  onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(this.currentPixelRatio);
    this.renderer.setSize(width, height, false);
    this.uniforms.uResolution.value.set(width, height);
  };

  getStates() {
    return [...this.moods.keys()];
  }

  getMood(name) {
    return this.moods.get(name) || this.moods.get("neutral");
  }

  hasMood(name) {
    return this.moods.has(String(name || "").trim().toLowerCase());
  }

  getCurrentMood() {
    return {
      name: this.currentMoodName,
      ...this.getMood(this.currentMoodName),
    };
  }

  registerMood(name, config) {
    const safeName = String(name || "").trim().toLowerCase();
    if (!safeName) {
      throw new Error("Название состояния обязательно.");
    }

    this.moods.set(safeName, sanitizeMoodConfig(safeName, config));
    return safeName;
  }

  getUniformColors() {
    return [
      this.uniforms.uColor1.value.clone(),
      this.uniforms.uColor2.value.clone(),
      this.uniforms.uColor3.value.clone(),
      this.uniforms.uColor4.value.clone(),
    ];
  }

  applyColors(colors) {
    this.uniforms.uColor1.value.copy(colors[0]);
    this.uniforms.uColor2.value.copy(colors[1]);
    this.uniforms.uColor3.value.copy(colors[2]);
    this.uniforms.uColor4.value.copy(colors[3]);
  }

  setMood(name, transitionMs = DEFAULT_TRANSITION_MS) {
    const targetName = this.moods.has(name) ? name : "neutral";
    const mood = this.getMood(targetName);
    if (!this.motionEnabled) {
      this.applyMoodInstant(targetName);
      return;
    }
    const toColors = mood.palette.map(hexToVector);

    this.transition = {
      fromColors: this.getUniformColors(),
      toColors,
      fromSpeed: this.uniforms.uSpeed.value,
      toSpeed: mood.speed,
      fromEnergy: this.uniforms.uEnergy.value,
      toEnergy: mood.energy,
      fromWarp: this.uniforms.uWarp.value,
      toWarp: mood.warp,
      fromPulse: this.uniforms.uPulse.value,
      toPulse: mood.pulse,
      fromGrain: this.uniforms.uGrain.value,
      toGrain: mood.grain,
      elapsed: 0,
      duration: clamp(Number(transitionMs) || DEFAULT_TRANSITION_MS, 120, 12000),
    };

    this.currentMoodName = targetName;
    this.onMoodChange(this.getCurrentMood());
  }

  applyMoodInstant(name) {
    const targetName = this.moods.has(name) ? name : "neutral";
    const mood = this.getMood(targetName);

    this.transition = null;
    this.currentMoodName = targetName;
    this.uniforms.uSpeed.value = mood.speed;
    this.uniforms.uEnergy.value = mood.energy;
    this.uniforms.uWarp.value = mood.warp;
    this.uniforms.uPulse.value = mood.pulse;
    this.uniforms.uGrain.value = mood.grain;
    this.applyColors(mood.palette.map(hexToVector));
    this.onMoodChange(this.getCurrentMood());
  }

  setMotionEnabled(enabled) {
    const next = Boolean(enabled);
    this.motionEnabled = next;
    this.frameBudgetMs = next ? (1000 / this.targetFps) : (1000 / 16);
    this.frameAccumulator = 0;
    if (!next) {
      this.transition = null;
    }
  }

  setPerformanceProfile(modelTier) {
    const tierMeta = getModelTierMeta(modelTier);
    this.targetFps = clamp(Number(tierMeta.targetFps || TARGET_FPS), 24, 60);
    this.maxPixelRatio = clamp(
      Math.min(this.baseMaxPixelRatio, Number(tierMeta.maxPixelRatioCap || this.baseMaxPixelRatio)),
      this.baseMinPixelRatio,
      this.baseMaxPixelRatio,
    );
    this.minPixelRatio = clamp(
      Number(tierMeta.minPixelRatio || 0.75),
      this.baseMinPixelRatio,
      this.maxPixelRatio,
    );
    this.currentPixelRatio = clamp(this.currentPixelRatio, this.minPixelRatio, this.maxPixelRatio);
    this.frameBudgetMs = this.motionEnabled ? (1000 / this.targetFps) : (1000 / 16);
    this.frameAccumulator = 0;
    this.onResize();
  }

  updateTransition(deltaMs) {
    if (!this.transition) {
      return;
    }

    this.transition.elapsed += deltaMs;
    const rawProgress = Math.min(this.transition.elapsed / this.transition.duration, 1);
    const progress = easeInOutCubic(rawProgress);

    const mixedColors = this.transition.fromColors.map((fromColor, index) => (
      fromColor.clone().lerp(this.transition.toColors[index], progress)
    ));

    this.applyColors(mixedColors);
    this.uniforms.uSpeed.value = THREE.MathUtils.lerp(
      this.transition.fromSpeed,
      this.transition.toSpeed,
      progress,
    );
    this.uniforms.uEnergy.value = THREE.MathUtils.lerp(
      this.transition.fromEnergy,
      this.transition.toEnergy,
      progress,
    );
    this.uniforms.uWarp.value = THREE.MathUtils.lerp(
      this.transition.fromWarp,
      this.transition.toWarp,
      progress,
    );
    this.uniforms.uPulse.value = THREE.MathUtils.lerp(
      this.transition.fromPulse,
      this.transition.toPulse,
      progress,
    );
    this.uniforms.uGrain.value = THREE.MathUtils.lerp(
      this.transition.fromGrain,
      this.transition.toGrain,
      progress,
    );

    if (rawProgress >= 1) {
      this.transition = null;
    }
  }

  adaptQuality() {
    if (this.frameDeltaAverage > this.qualityHighThresholdMs && this.currentPixelRatio > this.minPixelRatio) {
      this.currentPixelRatio = clamp(
        this.currentPixelRatio - this.qualityDownStep,
        this.minPixelRatio,
        this.maxPixelRatio,
      );
      this.onResize();
    } else if (this.frameDeltaAverage < this.qualityLowThresholdMs && this.currentPixelRatio < this.maxPixelRatio) {
      this.currentPixelRatio = clamp(
        this.currentPixelRatio + this.qualityUpStep,
        this.minPixelRatio,
        this.maxPixelRatio,
      );
      this.onResize();
    }
  }

  tick = (now) => {
    const rawDelta = now - this.lastFrameTime;
    this.lastFrameTime = now;

    if (document.hidden) {
      requestAnimationFrame(this.tick);
      return;
    }

    this.frameAccumulator += rawDelta;
    if (this.frameAccumulator < this.frameBudgetMs) {
      requestAnimationFrame(this.tick);
      return;
    }

    const deltaMs = this.frameAccumulator;
    this.frameAccumulator = 0;

    this.frameDeltaAverage = this.frameDeltaAverage * 0.94 + deltaMs * 0.06;
    this.qualitySampleCounter += 1;
    if (this.qualitySampleCounter >= 24) {
      this.adaptQuality();
      this.qualitySampleCounter = 0;
    }

    if (this.motionEnabled) {
      this.uniforms.uTime.value += deltaMs * 0.001;
    }
    this.updateTransition(deltaMs);
    this.renderer.render(this.scene, this.camera);

    this.onStats({
      frameMs: this.frameDeltaAverage,
      pixelRatio: this.currentPixelRatio,
      targetFrameMs: this.frameBudgetMs,
    });

    requestAnimationFrame(this.tick);
  };
}
