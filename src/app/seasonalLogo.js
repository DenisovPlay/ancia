const DEFAULT_LOGO_PATH = "/ancia.png";

const HOLIDAY_RULES = [
  {
    id: "defender_day",
    logoPath: "/23_feb_outline.png",
    greeting: "Защищаем Отечество!",
    description: "Поздравляем с 23 февраля! Всем мужчинам желаем здоровья и успехов!",
    dates: [{ month: 2, day: 23 }],
  },
  {
    id: "womens_day",
    logoPath: "/8march_outline.png",
    greeting: "С 8 марта!",
    description: "Пусть каждый день приносит тепло, радость и вдохновение!",
    dates: [{ month: 3, day: 8 }],
  },
  {
    id: "victory_day",
    logoPath: "/9may_outline.png",
    greeting: "Помним победу!",
    description: "Помним подвиг и желаем мира, силы духа и благополучия.",
    dates: [{ month: 5, day: 9 }],
  },
  {
    id: "winter_holidays",
    logoPath: "/xmas_ny_outline.png",
    greeting: "С Новым годом!",
    description: "С Новым годом и Рождеством! Пусть в доме будет тепло, удача и спокойствие.",
    dates: [
      { month: 12, day: 25 },
      { month: 1, day: 1 },
      { month: 1, day: 7 },
    ],
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDayStamp(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function createLocalDate(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function resolveHolidayMatch(date) {
  const safeDate = date instanceof Date ? date : new Date();
  const year = safeDate.getFullYear();
  const currentStamp = toUtcDayStamp(safeDate);
  let bestMatch = null;

  for (const rule of HOLIDAY_RULES) {
    for (const holidayDate of rule.dates) {
      for (const candidateYear of [year - 1, year, year + 1]) {
        const candidate = createLocalDate(candidateYear, holidayDate.month, holidayDate.day);
        const diffDays = Math.round((currentStamp - toUtcDayStamp(candidate)) / DAY_MS);
        const distance = Math.abs(diffDays);
        if (distance > 1) {
          continue;
        }

        const isBetterMatch = !bestMatch || distance < bestMatch.distance;
        if (isBetterMatch) {
          bestMatch = {
            rule,
            holidayDate: candidate,
            distance,
          };
        }
      }
    }
  }

  return bestMatch;
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveSeasonalState(date = new Date()) {
  const safeDate = date instanceof Date ? date : new Date();
  const match = resolveHolidayMatch(safeDate);
  if (!match) {
    return {
      active: false,
      holidayId: "",
      holidayInstanceId: "",
      logoPath: DEFAULT_LOGO_PATH,
      greeting: "",
      description: "",
    };
  }

  return {
    active: true,
    holidayId: String(match.rule.id || "").trim(),
    holidayInstanceId: `${String(match.rule.id || "").trim()}:${formatDateKey(match.holidayDate)}`,
    logoPath: match.rule.logoPath,
    greeting: String(match.rule.greeting || "").trim(),
    description: String(match.rule.description || "").trim(),
  };
}

export function resolveSeasonalLogoPath(date = new Date()) {
  return resolveSeasonalState(date).logoPath || DEFAULT_LOGO_PATH;
}

export function applySeasonalLogos({ root = document, date = new Date() } = {}) {
  if (!root || typeof root.querySelectorAll !== "function") {
    return DEFAULT_LOGO_PATH;
  }

  const logoPath = resolveSeasonalLogoPath(date);
  root.querySelectorAll("img[data-seasonal-logo]").forEach((node) => {
    if (node instanceof HTMLImageElement) {
      node.src = logoPath;
    }
  });
  return logoPath;
}
