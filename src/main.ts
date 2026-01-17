import { 
    App, Plugin, Editor, EditorPosition, Notice, TFile, 
    MarkdownView, WorkspaceLeaf, SuggestModal, HeadingCache,
    EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo,
    normalizePath, moment 
} from 'obsidian';

import { 
    FOCUS_MODE_CSS, ORDINARY_NOTE_PATH, 
    SYMBOLS, TRIGGER_CHAR, FILE_PATHS, LEGACY_SETTINGS 
} from './constants';

export default class MyIntegratedPlugin extends Plugin {
    private lastKey: string = "";
    private repeatCount: number = 0;

    async onload() {
        // 스타일 인젝트 (Focus Mode)
        this.injectStyles();

        // -------------------------------------------------------------------
        // 1. CURSOR COMMANDS
        // -------------------------------------------------------------------
        this.addCommand({
            id: 'move-cursor-to-end',
            name: '커서와 포커스를 문서 끝으로 이동',
            hotkeys: [{ modifiers: ["Mod"], key: "]" }],
            editorCallback: (editor: Editor) => this.moveCursorToEnd(editor)
        });
        this.addCommand({
            id: 'move-cursor-to-start',
            name: '커서와 포커스를 문서 처음으로 이동',
            hotkeys: [{ modifiers: ["Mod"], key: "[" }],
            editorCallback: (editor: Editor) => this.moveCursorToStart(editor)
        });

        // -------------------------------------------------------------------
        // 2. CUT & COPY COMMANDS
        // -------------------------------------------------------------------
        this.addCommand({
            id: 'copy-all-document',
            name: '문서 전체 복사',
            editorCallback: (editor) => this.copyAll(editor)
        });
        this.addCommand({
            id: 'cut-all-document',
            name: '문서 전체 잘라내기',
            editorCallback: (editor: Editor) => this.cutAll(editor) 
        });
        this.addCommand({
            id: "cut-to-clipboard",
            name: "잘라내기",
            icon: "lucide-scissors",
            hotkeys: [{ modifiers: ["Mod"], key: "X" }],
            editorCallback: (editor) => this.handleCutCopy(editor, true),
        });
        this.addCommand({
            id: "copy-to-clipboard",
            name: "복사하기",
            icon: "copy",
            hotkeys: [{ modifiers: ["Mod"], key: "C" }],
            editorCallback: (editor) => this.handleCutCopy(editor, false),
        });

        // -------------------------------------------------------------------
        // 3. CYCLE CURSOR (TAB FOCUS)
        // -------------------------------------------------------------------
        this.addCommand({
            id: 'focus-next-leaf',
            name: '다음 탭에 포커스',
            hotkeys: [{ modifiers: ["Mod"], key: "'" }],
            callback: () => this.cycleLeafFocus('forward'),
        });
        this.addCommand({
            id: 'focus-prev-leaf',
            name: '이전 탭에 포커스',
            hotkeys: [{ modifiers: ["Mod"], key: ";" }],
            callback: () => this.cycleLeafFocus('backward'),
        });

        // -------------------------------------------------------------------
        // 4. EXTRACT HEADINGS
        // -------------------------------------------------------------------
        this.addCommand({
            id: 'extract-heading-range',
            name: 'heading 범위 추출',
            icon: "lucide-heading",
            editorCallback: (editor: Editor, view: MarkdownView) => this.startHeadingWorkflow(editor, view)
        });

        // -------------------------------------------------------------------
        // 5. FOCUS MODE
        // -------------------------------------------------------------------
        this.addCommand({
            id: 'toggle-focus-mode',
            name: '집중 모드 토글',
            hotkeys: [{ modifiers: ["Mod"], key: "Enter" }],
            callback: () => this.toggleFocusMode()
        });

        // -------------------------------------------------------------------
        // 6. LEGACY FILE
        // -------------------------------------------------------------------
        this.addRibbonIcon("lucide-save", "레거시 파일 만들기", () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) this.createLegacyFile(activeFile);
            else new Notice("활성화된 파일이 없습니다.");
        });
        this.addCommand({
            id: "create-legacy-file",
            name: "현재 문서의 레거시 파일 만들기",
            hotkeys: [{ modifiers: ["Mod"], key: "S" }],
            checkCallback: (checking: boolean) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile && activeFile.extension === "md") {
                    if (!checking) {
                        this.createLegacyFile(activeFile);
                    }
                    return true;
                }
                return false;
            },
        });
        this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
            this.handleAbnormalInput(evt);
        });

        // -------------------------------------------------------------------
        // 7. LOCAL GRAPH
        // -------------------------------------------------------------------
        this.addRibbonIcon("lucide-git-fork", "로컬 그래프 열기", () => this.openGraphInSidebar());
        this.addCommand({
            id: 'open-localgraph-in-sidebar',
            name: '오른쪽 사이드바에 로컬그래프 열기',
            callback: () => this.openGraphInSidebar(),
        });

        // -------------------------------------------------------------------
        // 8. OPEN SPECIFIC FILES (from FILE_CONFIGS)
        // -------------------------------------------------------------------
        this.addRibbonIcon('lucide-library-big', '나중에 보기 열기', () => {
        this.openFileNormal(FILE_PATHS.LATER);
        });
        this.addRibbonIcon('lucide-file-pen', '작업 문서 열기', () => {
        this.openFileWithCleanup(FILE_PATHS.WORK);
        });
        this.addCommand({
        id: 'open-later-file',
        name: '나중에 보기 열기',
        hotkeys: [{ modifiers: ["Mod"], key: "L" }],
        callback: () => this.openFileNormal(FILE_PATHS.LATER),
        });
        this.addCommand({
        id: 'open-work-file',
        name: '작업 문서 열기',
        hotkeys: [{ modifiers: ["Mod"], key: "Q" }],
        callback: () => this.openFileWithCleanup(FILE_PATHS.WORK),
        });

        // -------------------------------------------------------------------
        // 9. ORDINARY NOTE
        // -------------------------------------------------------------------
        this.addRibbonIcon("calendar", "일상노트 열기", () => this.openOrCreateOrdinaryNote());
        this.addCommand({
            id: "open-ordinary-note",
            name: "일상노트 열기",
            hotkeys: [{ modifiers: ["Mod"], key: "D" }],
            callback: () => this.openOrCreateOrdinaryNote()
        });

        // -------------------------------------------------------------------
        // 10. PANEL CONTROL
        // -------------------------------------------------------------------
        this.addCommand({
            id: 'move-sidebar-panel',
            name: '사이드바 패널 이동',
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
            name: '사이드바 패널 닫기',
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

        // -------------------------------------------------------------------
        // 11. SELECTION EXPANDER
        // -------------------------------------------------------------------
        this.addCommand({
            id: 'expand-selection-char-right',
            name: '선택 영역 한 글자 오른쪽으로 확장',
            hotkeys: [{ modifiers: ["Alt"], key: "ArrowRight" }],
            editorCallback: (editor: Editor) => this.expandChar(editor, 1),
        });
        this.addCommand({
            id: 'expand-selection-char-left',
            name: '선택 영역 한 글자 왼쪽으로 확장',
            hotkeys: [{ modifiers: ["Alt"], key: "ArrowLeft" }],
            editorCallback: (editor: Editor) => this.expandChar(editor, -1),
        });
        this.addCommand({
            id: 'expand-selection-word-right',
            name: '선택 영역 단어 단위 오른쪽으로 확장',
            hotkeys: [{ modifiers: ["Mod"], key: "ArrowRight" }],
            editorCallback: (editor: Editor) => this.expandWord(editor, 'right'),
        });
        this.addCommand({
            id: 'expand-selection-word-left',
            name: '선택 영역 단어 단위 왼쪽으로 확장',
            hotkeys: [{ modifiers: ["Mod"], key: "ArrowLeft" }],
            editorCallback: (editor: Editor) => this.expandWord(editor, 'left'),
        });

        // -------------------------------------------------------------------
        // 12. SPECIAL CHARACTER (Editor Suggest)
        // -------------------------------------------------------------------
        this.registerEditorSuggest(new SymbolSuggestions(this));

        // -------------------------------------------------------------------
        // 13. TAGS PROPERTY
        // -------------------------------------------------------------------
        this.addCommand({
            id: "add-tags-property",
            name: "태그 속성 추가",
            icon: "tags",
            hotkeys: [{ modifiers: ["Mod"], key: "\\" }],
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) return;
                this.app.fileManager.processFrontMatter(activeFile, (fm) => {
                    if (!fm.hasOwnProperty('tags')) fm['tags'] = null;
                });
            },
        });

        // -------------------------------------------------------------------
        // 14. TASK & PLAN (Split View & Line Move)
        // -------------------------------------------------------------------
        this.addRibbonIcon("lucide-list-check", "task-plan 열기", () => this.openSplitFiles());
        this.addCommand({
            id: 'open-split-taskplan',
            name: 'task-plan 열기',
            hotkeys: [{ modifiers: ["Mod"], key: "R" }],
            callback: () => this.openSplitFiles(),
        });
        this.addCommand({
            id: 'move-line-taskplan',
            name: 'task-plan 이동',
            hotkeys: [{ modifiers: ["Mod"], key: "E" }],
            editorCallback: (editor: Editor, view: MarkdownView) => this.handleLineMove(editor, view)
        });
    }

    onunload() {
        document.body.classList.remove('is-focus-mode');
    }

    // --- Helper Methods ---

    // [CURSOR]
    private moveCursorToEnd(editor: Editor) {
        editor.focus();
        const line = editor.lineCount() - 1;
        const pos: EditorPosition = { line, ch: editor.getLine(line).length };
        editor.setCursor(pos);
        editor.scrollIntoView({ from: pos, to: pos }, true);
    }
    private moveCursorToStart(editor: Editor) {
        editor.focus();
        const pos: EditorPosition = { line: 0, ch: 0 };
        editor.setCursor(pos);
        editor.scrollIntoView({ from: pos, to: pos }, true);
    }

    // [CUT & COPY]
    private async copyAll(editor: Editor) {
        await navigator.clipboard.writeText(editor.getValue());
        new Notice('문서 전체가 복사되었습니다.');
    }
    private async cutAll(editor: Editor) {
        const content = editor.getValue();
        if (!content) return;
        await navigator.clipboard.writeText(content);
        editor.setValue("");
        new Notice('문서 전체를 잘라냈습니다.');
    }
    private async handleCutCopy(editor: Editor, isCut: boolean) {
        const hasSelection = editor.getSelection().length > 0;
        if (!hasSelection) {
            const cursor = editor.getCursor();
            editor.setSelection({ line: cursor.line, ch: 0 }, { line: cursor.line, ch: editor.getLine(cursor.line).length });
        }
        const text = editor.getSelection();
        if (text) {
            await navigator.clipboard.writeText(text);
            if (isCut) editor.replaceSelection("");
            else if (!hasSelection) editor.setCursor(editor.getCursor("to"));
        }
    }

    // [CYCLE LEAF]
    cycleLeafFocus(direction: 'forward' | 'backward') {
        const { workspace } = this.app;
        const activeLeaf = workspace.activeLeaf;
        const allLeaves: WorkspaceLeaf[] = [];

        // 사이드바를 제외한 메인 작업 영역의 리프만 수집
        workspace.iterateRootLeaves((leaf) => {
            allLeaves.push(leaf);
        });

        if (allLeaves.length <= 1) return;

        // 현재 활성 리프 인덱스 찾기
        const currentIndex = allLeaves.findIndex(leaf => leaf === activeLeaf);
        
        let targetIndex: number;

        if (direction === 'forward') {
            // 정방향: 다음 인덱스로 (마지막이면 0으로)
            targetIndex = (currentIndex + 1) % allLeaves.length;
        } else {
            // 역방향: 이전 인덱스로 (0보다 작아지면 마지막 인덱스로)
            targetIndex = (currentIndex - 1 + allLeaves.length) % allLeaves.length;
        }

        const targetLeaf = allLeaves[targetIndex];

        if (targetLeaf) {
            // 포커스 및 에디터 커서 활성화
            workspace.setActiveLeaf(targetLeaf, { focus: true });
            
            // 뷰 내부의 포커스 함수 호출 (타입 안전성 체크)
            const view = targetLeaf.view as any;
            if (typeof view.focus === 'function') {
                view.focus();
            }
        }
    }

    // [HEADING EXTRACTOR]
    private startHeadingWorkflow(editor: Editor, view: MarkdownView) {
        if (!view.file) return;
        const cache = this.app.metadataCache.getFileCache(view.file);
        const headings = cache?.headings || [];
        const options = [{ label: "시작: 문서 처음부터", line: 0, isSpecial: true }, 
            ...headings.map(h => ({ label: `${"#".repeat(h.level)} ${h.heading}`, line: h.position.start.line, level: h.level }))];
        
        new GenericSuggestModal(this.app, options, "추출 시작 위치 선택", (start) => {
            const endOpts = [{ label: "단일 헤딩 구간만", line: -1, isSpecial: true },
                ...headings.filter(h => h.position.start.line > start.line).map(h => ({ label: `종료: ${h.heading} 까지`, line: h.position.end.line, level: h.level }))];
            new GenericSuggestModal(this.app, endOpts, "종료 위치 선택", (end) => this.executeExtraction(editor, start, end, headings)).open();
        }).open();
    }
    private async executeExtraction(editor: Editor, start: any, end: any, all: HeadingCache[]) {
        const lastLine = editor.lineCount() - 1;
        const endLine = this.calculateEndLine(start, end, all, lastLine);
        const range = { from: { line: start.line, ch: 0 }, to: { line: endLine, ch: editor.getLine(endLine).length } };
        const content = editor.getRange(range.from, range.to);
        if (!content.trim()) return;
        const fileName = await this.getUniqueFileName("무제");
        const newFile = await this.app.vault.create(fileName, content);
        editor.replaceRange("", range.from, range.to);
        await this.app.workspace.getLeaf('tab').openFile(newFile as TFile);
    }
    private calculateEndLine(start: any, end: any, headings: HeadingCache[], last: number): number {
        if (!end.isSpecial) {
            const next = headings.find(h => h.position.start.line > end.line && h.level <= (end.level || 0));
            return next ? next.position.start.line - 1 : last;
        }
        const next = headings.find(h => h.position.start.line > start.line && h.level <= (start.level || 0));
        return next ? next.position.start.line - 1 : last;
    }
    private async getUniqueFileName(base: string): Promise<string> {
        let name = `${base}.md`, i = 1;
        while (this.app.vault.getAbstractFileByPath(name)) name = `${base} ${i++}.md`;
        return name;
    }

    // [FOCUS MODE]
    private toggleFocusMode() { document.body.classList.toggle('is-focus-mode'); }
    private injectStyles() {
        const el = document.createElement('style');
        el.id = 'integrated-plugin-styles';
        el.textContent = FOCUS_MODE_CSS;
        document.head.appendChild(el);
        this.register(() => el.detach());
    }

    // [LEGACY]
    private handleAbnormalInput(evt: KeyboardEvent) {
        // 현재 활성화된 뷰가 마크다운 에디터인지 확인
        const activeView = this.app.workspace.getActiveFile();
        if (!activeView || activeView.extension !== "md") return;

        // 포커스가 실제 에디터 입력창(.cm-content)에 있는지 확인
        const isEditor = (evt.target as HTMLElement).closest('.cm-content');
        if (!isEditor) return;

        // 조합 중인 키(한글 입력 등)나 특수 기능키(Shift, Ctrl 등)는 1차 제외
        if (evt.isComposing || evt.key.length > 1) {
            // 단, 백스페이스나 엔터는 연속 입력 감지에 포함하고 싶다면 예외 처리 가능
            if (evt.key !== "Backspace" && evt.key !== "Enter") return;
        }

        // 연속 입력 로직
        if (this.lastKey === evt.key) {
            this.repeatCount++;
        } else {
            this.lastKey = evt.key;
            this.repeatCount = 1;
        }

        // 임계치 도달 시 긴급 조치
        if (this.repeatCount >= LEGACY_SETTINGS.MAX_REPEAT) {
            this.emergencyAction(activeView);
        }
    }

    private async emergencyAction(file: TFile) {
        // 무한 루프 방지를 위한 카운트 초기화
        this.repeatCount = 0;
        this.lastKey = "";

        // 1. 즉시 백업 파일 생성
        await this.createLegacyFile(file);

        // 2. 에디터 포커스 강제 해제 (추가 입력 방지)
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        new Notice(`⚠️ 비정상 입력 감지: '${file.basename}' 백업 후 포커스를 해제했습니다.`);
    }
    // 레거시 파일 생성
    private async createLegacyFile(file: TFile) {
        // constants에서 가져온 값 사용
        const folderPath = LEGACY_SETTINGS.FOLDER_PATH;
        const ts = moment().format(LEGACY_SETTINGS.DATE_FORMAT);
        const newPath = normalizePath(`${folderPath}/${file.basename}_legacy_${ts}.md`);

        try {
            if (!(await this.app.vault.adapter.exists(folderPath))) {
                await this.app.vault.createFolder(folderPath);
            }
            await this.app.vault.copy(file, newPath);
            new Notice(`레거시 파일 저장됨: ${file.basename}_legacy_${ts}`);
        } catch (error) {
            new Notice("파일 복사 중 오류가 발생했습니다.");
        }
    }
    

    // [LOCAL GRAPH]
    private async openGraphInSidebar() {
        const leaf = this.app.workspace.getLeavesOfType('localgraph')[0] || this.app.workspace.getRightLeaf(false);
        await leaf.setViewState({ type: 'localgraph', active: true });
        this.app.workspace.revealLeaf(leaf);
    }

    // [OPEN FILE]
    private async openFileNormal(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(file);
    }
    }

    private async openFileWithCleanup(path: string) {
    const { workspace, vault } = this.app;
    const targetFile = vault.getAbstractFileByPath(path);

    if (!(targetFile instanceof TFile)) {
        new Notice('파일을 찾을 수 없습니다.');
        return;
    }

    // 1. 파일을 열 '타겟 리프'를 먼저 확보합니다.
    // 기존에 열린 탭이 있으면 그것을 쓰고, 없으면 새로 만듭니다.
    const targetLeaf = workspace.getLeaf(false);
    
    // 2. 해당 리프에 파일을 먼저 엽니다. (공간 확보)
    await targetLeaf.openFile(targetFile);

    // 3. 이제 파일을 연 리프(targetLeaf)를 제외한 나머지 모든 메인 탭을 수집합니다.
    const leavesToClose: WorkspaceLeaf[] = [];
    workspace.iterateAllLeaves((leaf) => {
        if (leaf.getRoot() === workspace.rootSplit && leaf !== targetLeaf) {
            leavesToClose.push(leaf);
        }
    });

    // 4. 나머지 탭들을 한 번에 닫습니다.
    leavesToClose.forEach(leaf => leaf.detach());

    // 5. 마지막으로 작업 리프에 포커스를 줍니다.
    workspace.setActiveLeaf(targetLeaf, { focus: true });
    }
    // [ORDINARY NOTE]
    private async openOrCreateOrdinaryNote() {
        let file = this.app.vault.getAbstractFileByPath(ORDINARY_NOTE_PATH);
        if (!(file instanceof TFile)) file = await this.app.vault.create(ORDINARY_NOTE_PATH, "");
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file as TFile);
        const editor = (leaf.view as MarkdownView).editor;
        const header = `### ${moment().format("MM월 DD일 (ddd)")}`;
        if (!editor.getValue().includes(header)) {
            const sep = editor.getValue().length > 0 ? "\n" : "";
            editor.replaceRange(`${sep}${header}\n`, { line: editor.lineCount(), ch: 0 });
        }
        this.moveCursorToEnd(editor);
    }

    // [PANEL CONTROL]
    openSidebarSelector(onSelect: (side: 'left' | 'right') => void) {
        const modal = new (class extends SuggestModal<'left' | 'right'> {
            getSuggestions() { return ['left', 'right'] as ('left' | 'right')[]; }
            renderSuggestion(value: 'left' | 'right', el: HTMLElement) {
                el.setText(value === 'left' ? '왼쪽 사이드바' : '오른쪽 사이드바');
            }
            onChooseSuggestion(value: 'left' | 'right') { onSelect(value); }
        })(this.app);
        
        modal.setPlaceholder("사이드바를 선택하세요");
        modal.open();
    }

    moveLeafToOppositeSidebar(leaf: WorkspaceLeaf, currentSide: 'left' | 'right') {
        const oppositeSide = currentSide === 'left' ? 'right' : 'left';
        const state = leaf.getViewState();
        const newLeaf = oppositeSide === 'left' 
            ? this.app.workspace.getLeftLeaf(false) 
            : this.app.workspace.getRightLeaf(false);

        if (newLeaf) {
            newLeaf.setViewState(state).then(() => {
                leaf.detach();
                this.app.workspace.revealLeaf(newLeaf);
                new Notice(`패널이 ${oppositeSide === 'left' ? '왼쪽' : '오른쪽'}으로 이동되었습니다.`);
            });
        }
    }

    // [SELECTION EXPANDER]
    private updateSelections(editor: Editor, getHead: (sel: any) => EditorPosition) {
        editor.setSelections(editor.listSelections().map(sel => ({ anchor: sel.anchor, head: getHead(sel) })));
    }
    private expandChar(editor: Editor, offset: number) {
        this.updateSelections(editor, sel => ({ line: sel.head.line, ch: Math.max(0, Math.min(editor.getLine(sel.head.line).length, sel.head.ch + offset)) }));
    }
    private expandWord(editor: Editor, dir: 'left' | 'right') {
        this.updateSelections(editor, sel => {
            const txt = editor.getLine(sel.head.line);
            if (dir === 'left') {
                const match = txt.substring(0, sel.head.ch).match(/(\S+\s*|\s+)$/);
                return { line: sel.head.line, ch: match ? sel.head.ch - match[0].length : 0 };
            } else {
                const match = txt.substring(sel.head.ch).match(/^(\s*\S+|\s+)/);
                return { line: sel.head.line, ch: match ? sel.head.ch + match[0].length : txt.length };
            }
        });
    }

    // [TASK & PLAN]
    async openSplitFiles() {
    const { workspace } = this.app;
    const taskFile = this.app.vault.getAbstractFileByPath(FILE_PATHS.TASK) as TFile;
    const planFile = this.app.vault.getAbstractFileByPath(FILE_PATHS.PLAN) as TFile;

    if (!taskFile || !planFile) {
        new Notice('파일을 찾을 수 없습니다.');
        return;
    }

    // 1. 모든 마크다운 리프와 빈 리프(가져오기)
    const allLeaves = workspace.getLeavesOfType('markdown');
    const emptyLeaves = workspace.getLeavesOfType('empty'); // 파일이 없는 빈 탭

    const getLeafForFile = (path: string) => 
        allLeaves.find(l => (l.view as MarkdownView).file?.path === path);

    let taskLeaf = getLeafForFile(FILE_PATHS.TASK);
    let planLeaf = getLeafForFile(FILE_PATHS.PLAN);

    // 시나리오 1: 이미 둘 다 열림
    if (taskLeaf && planLeaf) {
        new Notice('이미 모든 창이 구성되어 있습니다.');
        return;
    }

    // 시나리오 2: task만 있음 -> 우측에 plan 추가
    if (taskLeaf && !planLeaf) {
        workspace.setActiveLeaf(taskLeaf);
        // 빈 탭이 있다면 그 탭을 활용, 없다면 분할
        const targetLeaf = emptyLeaves.length > 0 ? emptyLeaves[0] : workspace.getLeaf('split', 'vertical');
        await targetLeaf.openFile(planFile);
        return;
    }

    // 시나리오 3: plan만 있음 -> 좌측 task, 우측 plan 재배치
    if (!taskLeaf && planLeaf) {
        workspace.setActiveLeaf(planLeaf);
        const rightLeaf = workspace.getLeaf('split', 'vertical');
        await rightLeaf.openFile(planFile); 
        await planLeaf.openFile(taskFile);
        return;
    }

    // 시나리오 4 & 5: 둘 다 없는 경우
    if (!taskLeaf && !planLeaf) {
    // 1. 현재 열려 있는 모든 마크다운 탭을 가져옴
    const leaves = workspace.getLeavesOfType('markdown');
    
    let baseLeaf: WorkspaceLeaf;

    if (leaves.length > 0) {
        // 2. 첫 번째 탭만 남기고 나머지는 모두 제거 (3분할 방지)
        baseLeaf = leaves[0];
        for (let i = 1; i < leaves.length; i++) {
            leaves[i].detach();
        }
    } else {
        // 3. 열려 있는 마크다운 탭이 하나도 없다면 빈 탭 확인 또는 생성
        const emptyLeaves = workspace.getLeavesOfType('empty');
        baseLeaf = emptyLeaves.length > 0 ? emptyLeaves[0] : workspace.getLeaf(false);
    }

    // 4. 남은 하나의 탭에 task.md를 먼저 열기
    await baseLeaf.openFile(taskFile);
    
    // 5. 그 상태에서 오른쪽으로 분할하여 plan.md 열기
    workspace.setActiveLeaf(baseLeaf);
    const rightLeaf = workspace.getLeaf('split', 'vertical');
    await rightLeaf.openFile(planFile);
    return;
    }
    }
    private async handleLineMove(editor: Editor, view: MarkdownView) {
    const path = view.file?.path;
    const targetPath = path === FILE_PATHS.TASK ? FILE_PATHS.PLAN : path === FILE_PATHS.PLAN ? FILE_PATHS.TASK : null;
    
    if (!targetPath) return;

    const lineIdx = editor.getCursor().line;
    const line = editor.getLine(lineIdx);
    if (!line.trim()) return;

    const targetLeaf = this.app.workspace.getLeavesOfType('markdown').find(l => (l.view as MarkdownView).file?.path === targetPath);
    
    if (targetLeaf) {
        const te = (targetLeaf.view as MarkdownView).editor;
        const targetValue = te.getValue();
        
        // --- 1. 대상 파일에 텍스트 추가 로직 ---
        // 내용이 있고, 마지막이 줄바꿈으로 끝나지 않을 때만 줄바꿈(\n) 추가
        const needsNewline = targetValue.length > 0 && !targetValue.endsWith("\n");
        const textToInsert = (needsNewline ? "\n" : "") + line;
        
        // 파일의 맨 끝 위치에 삽입
        te.replaceRange(textToInsert, { line: te.lineCount(), ch: 0 });

        // --- 2. 원본 파일에서 행 삭제 로직 ---
        // lineIdx부터 다음 줄의 시작(lineIdx + 1, ch: 0)까지 범위를 지정해 삭제
        // 마지막 줄일 경우를 대비해 범위를 안전하게 잡습니다.
        const from = { line: lineIdx, ch: 0 };
        const to = { line: lineIdx + 1, ch: 0 };
        
        // 만약 삭제하려는 줄이 파일의 마지막 줄이라면 이전 줄의 줄바꿈을 지워야 함
        if (lineIdx === editor.lineCount() - 1 && lineIdx > 0) {
            from.line = lineIdx - 1;
            from.ch = editor.getLine(lineIdx - 1).length;
            to.line = lineIdx;
            to.ch = line.length;
        }
        
        editor.replaceRange("", from, to);

        // --- 3. 화면 포커스 이동 ---
        this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
    }
    }
}

// --- Supporting Classes ---

class GenericSuggestModal extends SuggestModal<any> {
    constructor(app: App, private options: any[], placeholder: string, private onChoose: (item: any) => void) {
        super(app); this.setPlaceholder(placeholder);
    }
    getSuggestions(q: string) { return this.options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())); }
    renderSuggestion(o: any, el: HTMLElement) { el.createEl("div", { text: o.label }); }
    onChooseSuggestion(o: any) { this.onChoose(o); }
}

class UniversalPanelModal extends SuggestModal<{ name: string; leaf: WorkspaceLeaf }> {
    constructor(app: App, private side: 'left' | 'right', private action: (l: WorkspaceLeaf) => void, placeholder: string) {
        super(app); this.setPlaceholder(placeholder);
    }
    getSuggestions(q: string) {
        const panels: any[] = [];
        const split = this.side === 'left' ? this.app.workspace.leftSplit : this.app.workspace.rightSplit;
        this.app.workspace.iterateAllLeaves(l => { if (l.getRoot() === split) panels.push({ name: l.getDisplayText(), leaf: l }); });
        return panels.filter(p => p.name.toLowerCase().includes(q.toLowerCase()));
    }
    renderSuggestion(p: any, el: HTMLElement) { el.setText(p.name); }
    onChooseSuggestion(p: any) { this.action(p.leaf); }
}

class SymbolSuggestions extends EditorSuggest<{ id: string, symbol: string }> {
    constructor(plugin: Plugin) { super(plugin.app); }
    onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line).substring(0, cursor.ch);
        const match = line.match(new RegExp(`\\${TRIGGER_CHAR}([^\\${TRIGGER_CHAR}\\s]*)$`));
        return match ? { start: { line: cursor.line, ch: match.index! }, end: cursor, query: match[1] } : null;
    }
    getSuggestions(ctx: EditorSuggestContext) { return SYMBOLS.filter(s => s.id.toLowerCase().includes(ctx.query.toLowerCase())); }
    renderSuggestion(item: any, el: HTMLElement) { el.setText(`${item.id} ${item.symbol}`); }
    selectSuggestion(item: any) { this.context?.editor.replaceRange(item.symbol, this.context.start, this.context.end); }
}