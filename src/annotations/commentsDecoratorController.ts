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
import { GitBlameLine, GitCommit } from '../git/git';
import { Comment, CommentCache, CommentCacheItem, CommentType, GitCommentService } from '../gitCommentService';
import { GitUri } from '../gitService';

interface CommitDict {
    [key: string]: GitCommit;
}

export class CommentsDecoratorController implements Disposable {
    private _disposable: Disposable;
    private _activeEditor: TextEditor | undefined;
    private _activeFilename: string | undefined;
    private commentCache?: CommentCache;
    private timeout: any;

    private bookmarkDecorationType = window.createTextEditorDecorationType({
        gutterIconPath: Container.context.asAbsolutePath('images/bookmark.svg'),
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
            window.onDidChangeActiveTextEditor(editor => {
                this._activeEditor = editor;
                this.commentCache = Container.commentService.commentCache;
                if (editor && GitCommentService.isLoggedIn()) {
                    const activeDocument = editor.document;
                    this.clearDecorations();
                    this.getBlameLines(activeDocument)
                        .then(this.getCommits.bind(this))
                        .then(this.fetchCommentLines.bind(this))
                        .then(this.addDecorations.bind(this))
                        .then(this.setDecorations.bind(this));
                }
            }, null),
            workspace.onDidChangeTextDocument(this.onTextDocumentChanged, this)
        );
    }

    private onTextDocumentChanged(e: TextDocumentChangeEvent) {
        if (!this._activeEditor) return;
        if (e.document !== this._activeEditor.document) return;
        if (GitCommentService.isLoggedIn()) {
            this.clearDecorations();
            this.getBlameLines(e.document)
                .then(this.getCommits.bind(this))
                .then(this.fetchCommentLines.bind(this))
                .then(this.addDecorations.bind(this))
                .then(this.setDecorations.bind(this));
        }
    }

    dispose() {
        Container.lineTracker.stop(this);
        this._disposable && this._disposable.dispose();
    }

    /**
     * Returns an array of blame lines in given text document.
     * If range is not specified, all lines in the document will be considered
     * otherwise only the given range will be considered
     * @param document
     * @param range (optional)
     */
    async getBlameLines(document: TextDocument, range?: Range): Promise<GitBlameLine[]> {
        let startLine = 0;
        let endLine = document.lineCount;
        if (range) {
            startLine = range.start.line;
            endLine = range.end.line;
        }

        const blames: GitBlameLine[] = [];
        const gitUri = await GitUri.fromUri(document.uri);
        this._activeFilename = path.relative(gitUri.repoPath ? gitUri.repoPath : '', gitUri.fsPath);
        const trackedDocument = await Container.tracker.getOrAdd(document);
        for (let i = startLine; i < endLine; ++i) {
            const blameLine = document.isDirty
                ? await Container.git.getBlameForLineContents(trackedDocument.uri, i, document.getText())
                : await Container.git.getBlameForLine(trackedDocument.uri, i);
            if (blameLine === undefined) continue;
            blames.push(blameLine);
        }
        return blames;
    }

    /**
     * Returns commit list/dictionary (no-duplicate) of lines in given array of blame lines.
     * @param blames GitBlameLine[] Array of blame lines
     * @returns CommitDict (key: commitSha)
     */
    getCommits(blames: GitBlameLine[]): CommitDict {
        const commitDict: CommitDict = {};
        for (const blame of blames) {
            const commit = blame.commit;
            if (commit === undefined) continue;
            // uncommited change
            if (commit.sha.startsWith('0000')) continue;
            // duplicate commit
            if (commitDict[commit.sha]) continue;
            // add
            commitDict[commit.sha] = commit;
        }
        return commitDict;
    }

    /**
     * Fetches comments of given commits, from API (see loadComments method) or cache (if it is in cache and not timedout)
     * Returns line numbers (no-duplicate) corresponding to fetched comments
     * Returns empty array if user is not logged in to BitBucket
     * @param commitDict: CommitDict<commitSha, commit>
     * @returns number[]: Line numbers of comments
     */
    async fetchCommentLines(commitDict: CommitDict): Promise<number[]> {
        if (GitCommentService.isLoggedIn()) {
            // gets line numbers (no-duplicate) of fetched comments
            const commitCommentLines = Object.values(commitDict).map(async commit => {
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

                comments = comments.filter(
                    c =>
                        c.Type === CommentType.Line &&
                        c.Commit &&
                        this._activeFilename === path.normalize(c.Path!) &&
                        !c.ParentId
                );

                // get lines of comments
                let commentLines = comments.map(c => c.Line!);
                // remove duplicates
                commentLines = [...new Set(commentLines)];
                return commentLines;
            });

            return Promise.all(commitCommentLines)
            .then(commitLines => {
                return Array.prototype.concat.apply([], commitLines);
            });
        }
        else {
            // not logged in
            return [] as number[];
        }
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
