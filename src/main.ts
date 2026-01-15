import { 
    App,
    Editor,
    EditorPosition,
    EditorSelection,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    MarkdownView,
    Notice,
    Plugin,
    SuggestModal,
    TFile,
    WorkspaceLeaf,
    moment,
    normalizePath
} from 'obsidian';
const FOCUS_MODE_CSS = `
    body.is-focus-mode .mobile-toolbar,
    body.is-focus-mode .mobile-toolbar-container,
    body.is-focus-mode .workspace-drawer-tab-container {
        display: none !important;
    }
`;
const FILE_CONFIGS = [
    { id: 'task', path: 'task.md', name: '할 일 문서 열기', icon: 'lucide-square-check' },
    { id: 'later', path: 'later.md', name: '나중에 보기 열기', icon: 'lucide-library-big' },
    { id: 'plan', path: 'plan.md', name: '계획 문서 열기', icon: 'lucide-goal' },
    { id: 'work', path: 'work.md', name: '작업 문서 열기', icon: 'lucide-file-pen' },
];
const SYMBOLS = [
    { id: ".", symbol: "⋯" },
    { id: "-", symbol: "—" },
    { id: ",", symbol: "·" }
];
const TRIGGER_CHAR = "@";
const ORDINARY_NOTE_PATH = "ordinary.md";
type SidebarSide = 'left' | 'right';
type PanelOption = { name: string; leaf: WorkspaceLeaf };
export default class CombinedPlugin extends Plugin {
    async onload() {
        this.injectFocusStyles();
        this.registerEditorSuggest(new SymbolSuggestions(this));
        this.addRibbonIcon("lucide-save", "레거시 파일 만들기", () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) this.createLegacyFile(activeFile);
            else new Notice("활성화된 파일이 없습니다.");
        });
        this.addRibbonIcon("lucide-git-fork", "로컬 그래프 열기", () => this.openGraphInSidebar());
        for (const config of FILE_CONFIGS) {
            this.addRibbonIcon(config.icon, config.name, () => {
                this.openTargetFile(config.path);
            });
        }
        this.addRibbonIcon("calendar", "일상노트 열기", () => this.openOrCreateOrdinaryNote());
        this.addCommand({ id: 'copy-all-document', name: '문서 전체 복사', editorCallback: (editor) => this.copyAll(editor) });
        this.addCommand({ id: "cut-to-clipboard", name: "잘라내기", icon: "lucide-scissors", editorCallback: (editor) => this.handleCutCopy(editor, true) });
        this.addCommand({ id: "copy-to-clipboard", name: "복사하기", icon: "copy", editorCallback: (editor) => this.handleCutCopy(editor, false) });
        this.addCommand({ id: 'toggle-focus-mode', name: '집중 모드 토글', callback: () => this.toggleFocusMode() });
        this.addCommand({
            id: "create-legacy-file",
            name: "현재 문서의 레거시 파일 만들기",
            checkCallback: (checking: boolean) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    if (!checking) this.createLegacyFile(activeFile);
                    return true;
                }
                return false;
            },
        });
        this.addCommand({ id: 'open-localgraph-in-sidebar', name: '오른쪽 사이드바에 로컬그래프 열기', callback: () => this.openGraphInSidebar() });
        for (const config of FILE_CONFIGS) {
            this.addCommand({ id: `open-${config.id}-file`, name: config.name, callback: () => this.openTargetFile(config.path) });
        }
        this.addCommand({ id: "open-ordinary-note", name: "일상노트 열기", callback: () => this.openOrCreateOrdinaryNote() });
        this.addCommand({
            id: 'move-sidebar-panel',
            name: '사이드바 패널 이동 (선택)',
            callback: () => {
                this.openSidebarSelector((side) => {
                    const placeholder = `${side === 'left' ? '왼쪽' : '오른쪽'}에서 이동할 패널 선택`;
                    new UniversalPanelModal(this.app, side, (leaf) => {
                        this.moveLeafToOppositeSidebar(leaf, side);
                    }, placeholder).open();
                });
            }
        });
        this.addCommand({
            id: 'close-sidebar-panel',
            name: '사이드바 패널 닫기 (선택)',
            callback: () => {
                this.openSidebarSelector((side) => {
                    const placeholder = `${side === 'left' ? '왼쪽' : '오른쪽'}에서 닫을 패널 선택`;
                    new UniversalPanelModal(this.app, side, (leaf) => {
                        leaf.detach();
                        new Notice(`패널이 닫혔습니다.`);
                    }, placeholder).open();
                });
            }
        });
        this.addCommand({ id: 'expand-selection-char-right', name: '선택 영역 한 글자 오른쪽으로 확장', editorCallback: (editor: Editor) => this.expandChar(editor, 1) });
        this.addCommand({ id: 'expand-selection-char-left', name: '선택 영역 한 글자 왼쪽으로 확장', editorCallback: (editor: Editor) => this.expandChar(editor, -1) });
        this.addCommand({ id: 'expand-selection-word-right', name: '선택 영역 단어 단위 오른쪽으로 확장', editorCallback: (editor: Editor) => this.expandWord(editor, 'right') });
        this.addCommand({ id: 'expand-selection-word-left', name: '선택 영역 단어 단위 왼쪽으로 확장', editorCallback: (editor: Editor) => this.expandWord(editor, 'left') });
        this.addCommand({ id: 'swap-splits', name: '분할 탭 교환', callback: () => this.swapTabsBetweenTwoSplits() });
        this.addCommand({
            id: "add-tags-property",
            name: "태그 속성 추가",
            icon: "tags",
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) return;
                this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
                    if (!frontmatter.hasOwnProperty('tags')) frontmatter['tags'] = null;
                });
            },
        });
        this.addCommand({
            id: 'move-cursor-to-end',
            name: '커서와 포커스를 문서 끝으로 이동',
            icon: "lucide-text-cursor",
            editorCallback: (editor: Editor) => this.moveCursorToEnd(editor)
        });
        this.addCommand({
            id: 'move-cursor-to-start',
            name: '커서와 포커스를 문서 처음으로 이동',
            icon: "lucide-arrow-up-to-line",
            editorCallback: (editor: Editor) => this.moveCursorToStart(editor)
        });
    }
    onunload() {
        document.body.classList.remove('is-focus-mode');
    }
    private moveCursorToEnd(editor: Editor) {
        editor.focus();
        const line = editor.lineCount() - 1;
        const ch = editor.getLine(line).length;
        const lastPos: EditorPosition = { line, ch };
        editor.setCursor(lastPos);
        editor.scrollIntoView({ from: lastPos, to: lastPos }, true);
    }
    private moveCursorToStart(editor: Editor) {
        editor.focus();
        const firstPos: EditorPosition = { line: 0, ch: 0 };
        editor.setCursor(firstPos);
        editor.scrollIntoView({ from: firstPos, to: firstPos }, true);
    }
    private async copyAll(editor: Editor) {
        await navigator.clipboard.writeText(editor.getValue());
        new Notice('문서 전체가 복사되었습니다.');
    }
    private async handleCutCopy(editor: Editor, isCut: boolean) {
        const hasSelection = editor.getSelection().length > 0;
        if (!hasSelection) {
            const cursor: EditorPosition = editor.getCursor();
            const lineText = editor.getLine(cursor.line);
            const startPos: EditorPosition = { line: cursor.line, ch: 0 };
            const endPos: EditorPosition = { line: cursor.line, ch: lineText.length };
            editor.setSelection(startPos, endPos);
        }
        const textToProcess = editor.getSelection();
        if (textToProcess) {
            try {
                await navigator.clipboard.writeText(textToProcess);
                if (isCut) editor.replaceSelection("");
                else if (!hasSelection) {
                    const currentCursor = editor.getCursor("to");
                    editor.setCursor(currentCursor);
                }
            } catch (err) {
                new Notice('클립보드 접근 권한이 없습니다.');
            }
        }
    }
    private toggleFocusMode() {
        document.body.classList.toggle('is-focus-mode');
    }
    private injectFocusStyles() {
        const styleEl = document.createElement('style');
        styleEl.id = 'focus-mode-styles';
        styleEl.textContent = FOCUS_MODE_CSS;
        document.head.appendChild(styleEl);
        this.register(() => styleEl.detach());
    }
    private async createLegacyFile(file: TFile) {
        const folderPath = "legacy";
        const ts = moment().format("YYYYMMDDHHmmss");
        const newPath = normalizePath(`${folderPath}/${file.basename}_legacy_${ts}.md`);
        try {
            const adapter = this.app.vault.adapter;
            if (!(await adapter.exists(folderPath))) await this.app.vault.createFolder(folderPath);
            await this.app.vault.copy(file, newPath);
            new Notice(`레거시 파일 생성 완료: ${file.basename}_legacy_${ts}`);
        } catch (error) {
            new Notice("파일 복사 중 오류가 발생했습니다.");
        }
    }
    async openGraphInSidebar() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType('localgraph')[0] || workspace.getRightLeaf(false);
        await leaf.setViewState({ type: 'localgraph', active: true });
        workspace.revealLeaf(leaf);
    }
    private async openTargetFile(path: string) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(file);
        }
    }
    private async openOrCreateOrdinaryNote() {
        try {
            let file = this.app.vault.getAbstractFileByPath(ORDINARY_NOTE_PATH);
            if (!(file instanceof TFile)) {
                file = await this.app.vault.create(ORDINARY_NOTE_PATH, "");
            }
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(file as TFile);
            const editor = (leaf.view as MarkdownView).editor;
            const todayHeader = `### ${moment().format("MM월 DD일 (ddd)")}`;
            const content = editor.getValue();
            if (!content.includes(todayHeader)) {
                const separator = content.length > 0 ? "\n" : "";
                editor.replaceRange(`${separator}${todayHeader}\n`, { line: editor.lineCount(), ch: 0 });
            }
            const lastLine = editor.lineCount() - 1;
            editor.setCursor({ line: lastLine, ch: editor.getLine(lastLine).length });
            editor.scrollIntoView({ from: editor.getCursor(), to: editor.getCursor() }, true);
            editor.focus();
        } catch (e) {
            new Notice("일상노트 처리 중 오류가 발생했습니다.");
        }
    }
    private openSidebarSelector(onSelect: (side: SidebarSide) => void) {
        const modal = new (class extends SuggestModal<SidebarSide> {
            getSuggestions() { return ['left', 'right'] as SidebarSide[]; }
            renderSuggestion(value: SidebarSide, el: HTMLElement) {
                el.setText(value === 'left' ? '왼쪽 사이드바' : '오른쪽 사이드바');
            }
            onChooseSuggestion(value: SidebarSide) { onSelect(value); }
        })(this.app);
        modal.setPlaceholder("사이드바를 선택하세요");
        modal.open();
    }
    private moveLeafToOppositeSidebar(leaf: WorkspaceLeaf, currentSide: SidebarSide) {
        const oppositeSide = currentSide === 'left' ? 'right' : 'left';
        const state = leaf.getViewState();
        const newLeaf = oppositeSide === 'left' ? this.app.workspace.getLeftLeaf(false) : this.app.workspace.getRightLeaf(false);
        if (newLeaf) {
            newLeaf.setViewState(state).then(() => {
                leaf.detach();
                this.app.workspace.revealLeaf(newLeaf);
                new Notice(`패널이 ${oppositeSide === 'left' ? '왼쪽' : '오른쪽'}으로 이동되었습니다.`);
            });
        }
    }
    private updateSelections(editor: Editor, getNewHead: (sel: EditorSelection) => EditorPosition) {
        const selections: EditorSelection[] = editor.listSelections().map(sel => ({ anchor: sel.anchor, head: getNewHead(sel) }));
        editor.setSelections(selections);
    }
    private expandChar(editor: Editor, offset: number) {
        this.updateSelections(editor, sel => {
            const lineText = editor.getLine(sel.head.line);
            const newCh = Math.max(0, Math.min(lineText.length, sel.head.ch + offset));
            return { line: sel.head.line, ch: newCh };
        });
    }
    private expandWord(editor: Editor, direction: 'left' | 'right') {
        this.updateSelections(editor, sel => {
            const { line, ch } = sel.head;
            const lineText = editor.getLine(line);
            if (direction === 'left') {
                const before = lineText.substring(0, ch);
                const match = before.match(/(\S+\s*|\s+)$/);
                return { line, ch: match ? ch - match[0].length : 0 };
            } else {
                const after = lineText.substring(ch);
                const match = after.match(/^(\s*\S+|\s+)/);
                return { line, ch: match ? ch + match[0].length : lineText.length };
            }
        });
    }
    async swapTabsBetweenTwoSplits() {
        const ws: any = (this.app.workspace as any);
        const getLayoutFn = ws.getLayout ?? ws._getLayout;
        if (typeof getLayoutFn !== 'function') {
            new Notice('레이아웃을 가져올 수 없습니다.');
            return;
        }
        const layout = getLayoutFn.call(ws);
        const main = layout?.main;
        const target = findTwoPaneSplitNode(main);
        if (!target) {
            new Notice('현재 두 분할에서만 동작합니다.');
            return;
        }
        const [a, b] = target.children;
        const newLayout = swapChildrenAtPath(layout, target.__path, [b, a]);
        const applyFns = [ws.setLayout, ws.changeLayout, ws.loadLayout];
        for (const fn of applyFns) {
            if (typeof fn === 'function') {
                try {
                    await fn.call(ws, newLayout);
                    return;
                } catch (e) { }
            }
        }
        new Notice('레이아웃 적용 실패: 플러그인 버전/환경을 확인하세요.');
    }
}
class UniversalPanelModal extends SuggestModal<PanelOption> {
    constructor(app: App, private sidebar: SidebarSide, private action: (leaf: WorkspaceLeaf) => void, placeholder: string) {
        super(app);
        this.setPlaceholder(placeholder);
    }
    getSuggestions(query: string): PanelOption[] {
        const panels: PanelOption[] = [];
        const targetSplit = this.sidebar === 'left' ? this.app.workspace.leftSplit : this.app.workspace.rightSplit;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.getRoot() === targetSplit) {
                panels.push({ name: leaf.getDisplayText() || leaf.view.getViewType(), leaf: leaf });
            }
        });
        return panels.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
    }
    renderSuggestion(panel: PanelOption, el: HTMLElement) { el.createEl('div', { text: panel.name }); }
    onChooseSuggestion(panel: PanelOption) { this.action(panel.leaf); }
}
function findTwoPaneSplitNode(node: any, path: (string | number)[] = ['main']): any | null {
    if (!node) return null;
    const children = node.children;
    if (Array.isArray(children) && children.length === 2) {
        const candidate = { ...node };
        (candidate as any).__path = path;
        return candidate;
    }
    if (Array.isArray(children)) {
        for (let i = 0; i < children.length; i++) {
            const found = findTwoPaneSplitNode(children[i], path.concat(['children', i]));
            if (found) return found;
        }
    }
    const keys = ['root', 'container', 'content'];
    for (const k of keys) {
        if (node[k]) {
            const found = findTwoPaneSplitNode(node[k], path.concat([k]));
            if (found) return found;
        }
    }
    return null;
}
function swapChildrenAtPath(layout: any, path: (string | number)[], newChildren: any[]): any {
    const cloned = deepClone(layout);
    let cursor: any = cloned;
    for (let i = 0; i < path.length; i++) {
        const key = path[i];
        cursor[key] = deepClone(cursor[key]);
        cursor = cursor[key];
    }
    if (Array.isArray(cursor.children) && cursor.children.length === 2) {
        cursor.children = newChildren.map(deepClone);
    }
    return cloned;
}
function deepClone<T>(obj: T): T {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
}
class SymbolSuggestions extends EditorSuggest<{ id: string, symbol: string }> {
    constructor(plugin: Plugin) {
        super(plugin.app);
    }

    onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line).substring(0, cursor.ch);
        const match = line.match(new RegExp(`\\${TRIGGER_CHAR}([^\\${TRIGGER_CHAR}\\s]*)$`));
        if (!match) return null;
        return {
            start: { line: cursor.line, ch: match.index! },
            end: cursor,
            query: match[1]
        };
    }

    getSuggestions(ctx: EditorSuggestContext) {
        const q = ctx.query.toLowerCase();
        return SYMBOLS.filter(s => s.id.toLowerCase().includes(q));
    }

    renderSuggestion(item: { id: string, symbol: string }, el: HTMLElement) {
        el.setText(`${item.id} ${item.symbol}`);
    }

    selectSuggestion(item: { id: string, symbol: string }) {
        this.context?.editor.replaceRange(item.symbol, this.context.start, this.context.end);
    }
}
