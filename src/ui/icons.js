const ICONS = {
  chat: `
    <path d="M5 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-4 3v-3H7a2 2 0 0 1-2-2z"/>
  `,
  plugins: `
    <rect x="4.5" y="4.5" width="6" height="6" rx="1.2"/>
    <rect x="13.5" y="4.5" width="6" height="6" rx="1.2"/>
    <rect x="4.5" y="13.5" width="6" height="6" rx="1.2"/>
    <rect x="13.5" y="13.5" width="6" height="6" rx="1.2"/>
  `,
  settings: `
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/>
  `,
  menu: `
    <path d="M4 7h16M4 12h16M4 17h16"/>
  `,
  sessions: `
    <circle cx="12" cy="12" r="8"/>
    <path d="M12 8v4l2.5 2.5"/>
  `,
  inspector: `
    <path d="M4 7h6M12 7h8M4 12h2M10 12h10M4 17h10M18 17h2"/>
    <circle cx="10" cy="7" r="2"/>
    <circle cx="8" cy="12" r="2"/>
    <circle cx="16" cy="17" r="2"/>
  `,
  filter: `
    <path d="M4 6h16l-6.5 7.2v4.8l-3-1.6v-3.2z"/>
  `,
  eye: `
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/>
    <circle cx="12" cy="12" r="2.8"/>
  `,
  attach: `
    <path d="M8.5 12.5l5.3-5.3a3.1 3.1 0 1 1 4.4 4.4l-7.1 7.1a4.1 4.1 0 1 1-5.8-5.8l6.6-6.6"/>
  `,
  send: `
    <path d="M3.5 11.8 20.8 3.8l-5.7 16.4-3.7-6.2-7.9-2.2z"/>
    <path d="M11.4 14 20.8 3.8"/>
  `,
  stop: `
    <rect x="6.5" y="6.5" width="11" height="11" rx="2"/>
  `,
  publish: `
    <path d="M12 15V5"/>
    <path d="m8 9 4-4 4 4"/>
    <path d="M4 15.5v2A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-2"/>
  `,
  refresh: `
    <path d="M20 11a8 8 0 1 1-2.34-5.66"/>
    <path d="M20 4v7h-7"/>
  `,
  save: `
    <path d="M5 4h11l3 3v13H5z"/>
    <path d="M8 4v5h7V4"/>
    <rect x="8" y="14" width="8" height="4" rx="1"/>
  `,
  categories: `
    <path d="M6 6h14M6 12h14M6 18h14"/>
    <circle cx="3.5" cy="6" r="1"/>
    <circle cx="3.5" cy="12" r="1"/>
    <circle cx="3.5" cy="18" r="1"/>
  `,
  personalization: `
    <circle cx="12" cy="8" r="3"/>
    <path d="M5 19a7 7 0 0 1 14 0"/>
  `,
  interface: `
    <rect x="4" y="5" width="16" height="12" rx="2"/>
    <path d="M8 20h8"/>
  `,
  developer: `
    <path d="m7 8-4 4 4 4M17 8l4 4-4 4M14 4l-4 16"/>
  `,
  info: `
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 11v5M12 8h.01"/>
  `,
  plus: `
    <path d="M12 5v14M5 12h14"/>
  `,
  trash: `
    <path d="M4 7h16"/>
    <path d="M9 7V5h6v2"/>
    <path d="M7 7l1 12h8l1-12"/>
    <path d="M10 11v5M14 11v5"/>
  `,
  check: `
    <path d="m5 12 5 5 9-9"/>
  `,
  "x-mark": `
    <path d="m18 6-12 12M6 6l12 12"/>
  `,
  globe: `
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 3a15 15 0 0 1 0 18"/>
    <path d="M3 12h18"/>
  `,
  clock: `
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v5l3 3"/>
  `,
  "search-web": `
    <circle cx="11" cy="11" r="7"/>
    <path d="m21 21-4.35-4.35"/>
  `,
  mood: `
    <circle cx="12" cy="12" r="9"/>
    <path d="M9 13.5s1 1.5 3 1.5 3-1.5 3-1.5"/>
    <path d="M9.5 9.5h.01M14.5 9.5h.01"/>
  `,
  "chevron-down": `
    <path d="m6 9 6 6 6-6"/>
  `,
};

export function icon(name, className = "") {
  const body = ICONS[name] || ICONS.info;
  const cssClass = ["ui-icon", className].filter(Boolean).join(" ");
  return `
    <svg
      class="${cssClass}"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      ${body}
    </svg>
  `;
}
