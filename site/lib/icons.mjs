const I = {
  menu: '<path d="M3 5h14M3 10h14M3 15h14"/>',
  search: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4.5 4.5"/>',
  out: '<path d="M8 4H4.5A1.5 1.5 0 0 0 3 5.5v10A1.5 1.5 0 0 0 4.5 17h10a1.5 1.5 0 0 0 1.5-1.5V12"/><path d="M11 3h6v6M17 3l-8 8"/>',
  query:
    '<circle cx="10" cy="10" r="7.25"/><path d="M7.9 7.7a2.2 2.2 0 1 1 3 2.05c-.6.25-.9.7-.9 1.35v.4"/><circle cx="10" cy="13.9" r=".35" fill="currentColor"/>',
  page: '<path d="M5 2.75h6.5L15 6.25v10.5a.5.5 0 0 1-.5.5h-9.5a.5.5 0 0 1-.5-.5V3.25a.5.5 0 0 1 .5-.5Z"/><path d="M11.25 2.75v3.75H15M7 10h6M7 13h4"/>',
  sun: '<circle cx="10" cy="10" r="3.5"/><path d="M10 1.75v2M10 16.25v2M1.75 10h2M16.25 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"/>',
  moon: '<path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z"/>',
  arrow: '<path d="M4 10h11M11 6l4 4-4 4"/>',
  copy: '<rect x="6.75" y="6.75" width="10.5" height="10.5" rx="1.5"/><path d="M13.25 6.75V4.25a1.5 1.5 0 0 0-1.5-1.5h-7a1.5 1.5 0 0 0-1.5 1.5v7a1.5 1.5 0 0 0 1.5 1.5h2.5"/>',
  check: '<path d="m4 10.5 4 4 8-9"/>',
  chat: '<path d="M3.25 5.25a2 2 0 0 1 2-2h9.5a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H9l-3.75 3v-3h0a2 2 0 0 1-2-2Z"/>',
  plug: '<path d="M7 2.75v4M13 2.75v4M5 6.75h10v2.5a5 5 0 0 1-10 0Z"/><path d="M10 14.25v3"/>',
};
export function icon(name, cls = "") {
  return `<svg class="ic ${cls}" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name]}</svg>`;
}
