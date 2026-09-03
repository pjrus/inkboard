const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const HandIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M18 11V6.5a1.5 1.5 0 0 0-3 0V11m0-1.5V4.5a1.5 1.5 0 0 0-3 0V11m0-1.5v-3a1.5 1.5 0 0 0-3 0V13l-1.8-2.2a1.6 1.6 0 0 0-2.4 2.1L8 17.5C9.3 19.8 11 21 13.5 21c3.6 0 6-2.4 6-6v-4" />
  </svg>
);
export const PenIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z" />
    <path d="M13.5 6.5l3 3" />
  </svg>
);
export const PencilIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M3 21l3.2-.8L18 8.4l-2.4-2.4L3.8 17.8 3 21z" />
    <path d="M15.6 6l2.4 2.4M13 8.6l2.4 2.4" />
    <path d="M17.2 4.4l1.1-1.1a1.7 1.7 0 0 1 2.4 2.4l-1.1 1.1" />
  </svg>
);
export const EraserIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M6.5 19.5h11" />
    <path d="M4.2 14.3l8.2-8.2a2 2 0 0 1 2.8 0l3.7 3.7a2 2 0 0 1 0 2.8l-4.9 4.9H9.6l-5.4-5.4a1 1 0 0 1 0-1.4z" />
    <path d="M9 9.5l5.5 5.5" />
  </svg>
);
export const PdfIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h6" />
  </svg>
);
export const UndoIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h9a6 6 0 0 1 0 12h-2" />
  </svg>
);
export const RedoIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9h-9a6 6 0 0 0 0 12h2" />
  </svg>
);
export const ChevronIcon = () => (
  <svg {...base} width={12} height={12} aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const LassoIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M12 4c4.4 0 8 2.2 8 5s-3.6 5-8 5-8-2.2-8-5 3.6-5 8-5z" strokeDasharray="3 2" />
    <path d="M7.5 13.5c-.8 1.4-1 3-.3 4.2.8 1.4 2.6 1.9 4 1.1" />
    <path d="M7 19.5c-.6 0-1.4.6-1.4 1.5" />
  </svg>
);
export const TextIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M5 6.5V5h14v1.5" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
  </svg>
);
export const AlignLeftIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true">
    <path d="M4 6h16M4 11h10M4 16h13M4 21h8" />
  </svg>
);
export const AlignCenterIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true">
    <path d="M4 6h16M7 11h10M5 16h14M8 21h8" />
  </svg>
);
export const AlignRightIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true">
    <path d="M4 6h16M10 11h10M7 16h13M12 21h8" />
  </svg>
);
export const MenuIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);
export const ExportIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M12 3v11" />
    <path d="M8.5 10.5L12 14l3.5-3.5" />
    <path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
  </svg>
);
export const SunIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const MoonIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);
export const SystemIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true">
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M9 21h6" />
  </svg>
);
export const EyeIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true">
    <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);
export const EditModeIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true">
    <path d="M4 20l4.2-1 9.4-9.4a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20z" />
  </svg>
);
export const RotateIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true">
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4h-4" />
  </svg>
);
