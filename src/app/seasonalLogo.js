const DEFAULT_LOGO_PATH = "/ancia.png";

const HOLIDAY_RULES = [
  {
    logoPath: "/23_feb_outline.png",
    dates: [{ month: 2, day: 23 }],
  },
  {
    logoPath: "/8march_outline.png",
    dates: [{ month: 3, day: 8 }],
  },
  {
    logoPath: "/9may_outline.png",
    dates: [{ month: 5, day: 9 }],
  },
  {
    logoPath: "/xmas_ny_outline.png",
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

function isWithinHolidayWindow(date, { month, day }) {
  const year = date.getFullYear();
  const currentStamp = toUtcDayStamp(date);

  for (const candidateYear of [year - 1, year, year + 1]) {
    const candidate = createLocalDate(candidateYear, month, day);
    const diffDays = Math.round((currentStamp - toUtcDayStamp(candidate)) / DAY_MS);
    if (Math.abs(diffDays) <= 1) {
      return true;
    }
  }
  return false;
}

export function resolveSeasonalLogoPath(date = new Date()) {
  const safeDate = date instanceof Date ? date : new Date();
  for (const rule of HOLIDAY_RULES) {
    if (rule.dates.some((entry) => isWithinHolidayWindow(safeDate, entry))) {
      return rule.logoPath;
    }
  }
  return DEFAULT_LOGO_PATH;
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
