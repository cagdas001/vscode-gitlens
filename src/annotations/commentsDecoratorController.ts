'use strict';
import * as path from 'path';
import {
    DecorationOptions,
    Disposable,
    OverviewRulerLane,
    Range,
    TextDocument,
    TextDocumentChangeEvent,
    TextEditor,
    window,
    workspace
} from 'vscode';
import { Container } from '../container';
import { GitBlame, GitBlameLine, GitCommit } from '../git/git';
import {
    Comment,
    CommentCache,
    CommentCacheItem,
    CommentLine,
    CommentType,
    GitCommentService
} from '../gitCommentService';
import { GitUri } from '../gitService';
import { Strings } from '../system';

export class TargetLine extends CommentLine {
    CurrentLine?: number;
}

export class CommentsDecoratorController implements Disposable {
    private _disposable: Disposable;
    private _activeEditor: TextEditor | undefined;
    private _activeFilename: string | undefined;
    private repoPath: string | undefined;
    private gitUri: GitUri | undefined;
    private activeView: any;
    private fileCommit: GitCommit | undefined;
    private revisionCommitSha: string | undefined;
    private revisionBlame: GitBlame | undefined;
    private commentCache?: CommentCache;
    private timeout: any;

    private bookmarkDecorationType = window.createTextEditorDecorationType({
        gutterIconPath: Container.context.asAbsolutePath('images/light/bookmark.svg'),
        overviewRulerLane: OverviewRulerLane.Full,
        overviewRulerColor: 'rgba(21, 126, 251, 0.7)'
    });
    decorations: DecorationOptions[] = [];
    decoratedLines: number[] = [];

    constructor() {
        this._activeEditor = window.activeTextEditor;
        if (Container.commentService && Container.commentService.commentCache) {
            this.commentCache = Container.commentService.commentCache;
        }

        this._disposable = Disposable.from(
            window.onDidChangeActiveTextEditor(this.onActiveEditorChanged.bind(this)),
            workspace.onDidChangeTextDocument(this.onTextDocumentChanged, this)
        );
    }

    /**
     * Decorations will be refreshed 2 seconds later, once the user completed editing
     * @param e TextDocumentChangeEvent
     */
    private onTextDocumentChanged(e: TextDocumentChangeEvent) {
        if (!this._activeEditor) return;
        if (e.document !== this._activeEditor.document) return;
        this.clearDecorations();
        clearTimeout(this.timeout);
        this.timeout = setTimeout(
            async document => {
                if (GitCommentService.isLoggedIn()) {
                    const targetLines = await this.getTargetLines(document);
                    const commentLines = await this.fetchCommentLines(this.fileCommit!);
                    const linesToBeDecorated = this.linesToBeDecorated(commentLines, targetLines);
                    this.addDecorations(linesToBeDecorated);
                    this.setDecorations();
                }
            },
            2000,
            e.document
        );
    }

    private async onActiveEditorChanged(editor?: TextEditor) {
        if (editor) {
            let editors = [editor];
            const activeView = Container.commentService.getActiveView(editor.document.uri.fsPath);
            if (activeView.isDiffView) {
                editors = [...editors, ...window.visibleTextEditors];
            }
            this.syncEditors(editors);
        }
    }

    /**
     * Refreshes decorations for given array of TextEditors
     * @param editors TextEditor[]
     */
    async syncEditors(editors: TextEditor[]) {
        for (const editor of editors) {
            if (editor && GitCommentService.isLoggedIn()) {
                this._activeEditor = editor;
                this.commentCache = Container.commentService.commentCache;
                const activeDocument = editor.document;

                this.clearDecorations();
                await this.reset(editor);
                const targetLines = await this.getTargetLines(activeDocument);
                const commentLines = await this.fetchCommentLines(this.fileCommit!);
                const linesToBeDecorated = this.linesToBeDecorated(commentLines, targetLines);
                this.addDecorations(linesToBeDecorated);
                this.setDecorations();
            }
        }
    }

    dispose() {
        Container.lineTracker.stop(this);
        this._disposable && this._disposable.dispose();
    }

    /**
     * Reset required parameters to refresh decorations
     * @param editor TextEditor
     */
    async reset(editor: TextEditor) {
        this.repoPath = await Container.git.getActiveRepoPath(editor);
        this.gitUri = await GitUri.fromUri(editor.document.uri);
        this._activeFilename = Strings.normalizePath(
            path.relative(this.gitUri.repoPath ? this.gitUri.repoPath : '', this.gitUri.fsPath)
        );
        this.activeView = Container.commentService.getActiveView(editor.document.uri.fsPath);
        const revisionAndCommit = await Container.commentService.getRevisionAndCommit(
            this.activeView,
            this.repoPath!,
            this._activeFilename
        );
        this.revisionCommitSha = revisionAndCommit.Revision;
        this.fileCommit = revisionAndCommit.Commit;
        this.revisionBlame = await Container.git.getBlameForFileRevision(this.gitUri, this.revisionCommitSha);
    }

    /**
     * Returns an array of TargetLines in given text document.
     * If range is not specified, all lines in the document will be considered
     * otherwise only the given range will be considered
     * @param document
     * @param range (optional)
     */
    async getTargetLines(document: TextDocument, range?: Range): Promise<TargetLine[]> {
        let startLine = 0;
        let endLine = document.lineCount;
        if (range) {
            startLine = range.start.line;
            endLine = range.end.line;
        }

        const targetLines: TargetLine[] = [];
        const trackedDocument = await Container.tracker.getOrAdd(document);
        for (let i = startLine; i < endLine; ++i) {
            const blameLine = document.isDirty
                ? await Container.git.getBlameForLineContents(trackedDocument.uri, i, document.getText())
                : await Container.git.getBlameForLine(trackedDocument.uri, i);
            if (blameLine === undefined) continue;
            const targetLine = this.getTargetLine(blameLine);
            if (targetLine) {
                targetLines.push(targetLine);
            }
        }
        return targetLines;
    }

    /**
     * Returns the single TargetLine from given blame
     * @param blames GitBlameLine Blame of line
     * @returns TargetLine
     */
    getTargetLine(blame: GitBlameLine): TargetLine | undefined {
        const commit = blame.commit;
        if (commit === undefined) return;
        // uncommited change
        if (commit.sha.startsWith('0000')) return;
        // get target line
        const targetLine = this.revisionBlame!.lines.find(
            l => l.sha === commit.sha && l.originalLine === blame.line.originalLine
        );
        if (this.revisionCommitSha === commit.sha && !this.activeView.isLeftActive) {
            return { To: targetLine!.line, CurrentLine: blame.line.line } as TargetLine;
        }
        else {
            return { From: targetLine!.line, CurrentLine: blame.line.line } as TargetLine;
        }
    }

    /**
     * Checks if lines already include the lineToCheck
     * @param lineToCheck CommentLine
     * @param lines CommentLine[]
     * @returns boolean
     */
    isDuplicate(lineToCheck: CommentLine, lines: CommentLine[]): boolean {
        if (lineToCheck.To) {
            return !!lines.find(l => l.To === lineToCheck.To);
        }
        else {
            return !!lines.find(l => l.From === lineToCheck.From);
        }
    }

    /**
     * Fetches comments of given commit, from API (see loadComments method) or cache (if it is in cache and not timedout)
     * Returns an array of CommentLine (see definiton)
     * Returns empty array if user is not logged in to BitBucket
     * @param commit: GitCommit
     * @returns CommentLine[]: Array of CommentLines
     */
    async fetchCommentLines(commit: GitCommit): Promise<CommentLine[]> {
        if (GitCommentService.isLoggedIn()) {
            let comments: Comment[] = [];
            const hasCache = this.commentCache!.CachedItems.has(commit.sha)!;
            let cacheTimedout = false;
            let cacheItem: CommentCacheItem;
            if (hasCache) {
                cacheItem = this.commentCache!.CachedItems.get(commit.sha)!;
                const timeDiff = Date.now() - cacheItem.FetchedTime;
                const timeDiffThreshold = CommentCache.CacheTimeout * 1000 * 60;
                if (timeDiff >= timeDiffThreshold) {
                    cacheTimedout = true;
                }
            }

            if (!hasCache || cacheTimedout) {
                comments = (await Container.commentService.loadComments(commit)) as Comment[];
            }
            else {
                comments = cacheItem!.Comments;
            }

            // get only line comments (excl. replies) belong to this file
            comments = comments.filter(
                c =>
                    c.Type === CommentType.Line &&
                    c.Commit &&
                    this._activeFilename === Strings.normalizePath(c.Path!) &&
                    !c.ParentId
            );

            // get and return Lines (item) of comments
            return comments.map(c => c.LineItem!);
        }
        else {
            // not logged in
            return [] as CommentLine[];
        }
    }

    /**
     * Detects the lines should be decorated from given parameters
     * @param fetchedLines CommentLine[] Fetched comments from API or cache
     * @param targetLines number[] Line numbers to be decorated
     */
    linesToBeDecorated(fetchedLines: CommentLine[], targetLines: TargetLine[]): number[] {
        const lineNums: number[] = [];
        for (const line of fetchedLines) {
            if (!line) continue;
            if (line.To) {
                const foundTargetLine = targetLines.find(l => l.To === line.To);
                if (!!foundTargetLine) {
                    lineNums.push(foundTargetLine.CurrentLine!);
                }
            }
            else {
                const foundTargetLine = targetLines.find(l => l.From === line.From);
                if (!!foundTargetLine) {
                    lineNums.push(foundTargetLine.CurrentLine!);
                }
            }
        }
        // Set contains only unique line numbers
        return [...new Set(lineNums)];
    }

    /**
     * Adds decorations for given lines
     * @param lines number[] Line numbers
     */
    addDecorations(lines: number[]) {
        for (const line of lines) {
            this.addDecoration(line);
        }
    }

    /**
     * Adds the given line number in decoratedLines
     * @param line number Line number
     */
    addDecoration(line: number) {
        if (!this.decoratedLines.includes(line)) {
            this.decoratedLines.push(line);

            const decoration = { range: new Range(line, 0, line, 0) };
            this.decorations.push(decoration);
        }
    }

    /**
     * Removes the decorations of given line numbers
     * @param lines number[] line numbers
     */
    removeDecorations(lines: number[]) {
        for (const line of lines) {
            this.removeDecoration(line);
        }
    }

    /**
     * Removes the given line number from decoratedLines
     * @param line number Line number
     */
    removeDecoration(line: number) {
        let index = this.decoratedLines.indexOf(line);
        if (index > -1) {
            this.decoratedLines.splice(index, 1);
        }

        index = this.decorations.findIndex(d => d.range.start.line === line);
        if (index > -1) {
            this.decorations.splice(index, 1);
        }
    }

    /**
     * Sets and creates decorations for the active editor
     */
    setDecorations() {
        if (this._activeEditor) {
            this._activeEditor.setDecorations(this.bookmarkDecorationType, this.decorations);
        }
    }

    /**
     * Clears the decorations of active editor
     */
    clearDecorations() {
        if (this._activeEditor) {
            this.decorations = [];
            this.decoratedLines = [];
            this._activeEditor.setDecorations(this.bookmarkDecorationType, []);
        }
    }
}
