export const FOCUS_MODE_CSS = `
    body.is-focus-mode .mobile-toolbar,
    body.is-focus-mode .mobile-toolbar-container,
    body.is-focus-mode .workspace-drawer-tab-container {
        display: none !important;
    }
`;

export const ORDINARY_NOTE_PATH = "ordinary.md";

export const SYMBOLS = [
    { id: ".", symbol: "⋯" },
    { id: "-", symbol: "—" },
    { id: ",", symbol: "·" }
];

export const TRIGGER_CHAR = "@";

export const FILE_PATHS = {
    TASK: 'task.md',
    PLAN: 'plan.md',
    LATER: 'later.md',
    WORK: 'work.md'
};

export const LEGACY_SETTINGS = {
    MAX_REPEAT: 20,
    FOLDER_PATH: "legacy",
    DATE_FORMAT: "YYYYMMDDHHmmss",
} as const;