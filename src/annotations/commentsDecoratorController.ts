'use strict';
import * as path from 'path';
import { DecorationOptions, Disposable, OverviewRulerLane, Range, TextEditor, window } from 'vscode';
import { Container } from '../container';
import { GitCommit } from '../git/git';
import { Comment, CommentType, GitCommentService, CommentCache } from '../gitCommentService';
import { GitUri } from '../gitService';

interface CommitDic {
    [key: string]: GitCommit;
}

export class CommentsDecoratorController implements Disposable {
    private _disposable: Disposable;
    private _activeEditor: TextEditor | undefined;
    private _activeFilename: string | undefined;
    private commentCache?: CommentCache;

    private bookmarkDecorationType = window.createTextEditorDecorationType({
        gutterIconPath: Container.context.asAbsolutePath('images/bookmark.svg'),
        overviewRulerLane: OverviewRulerLane.Full,
        overviewRulerColor: 'rgba(21, 126, 251, 0.7)'
    });
    decorations: DecorationOptions[] = [];

    constructor() {
        this._activeEditor = window.activeTextEditor;
        if (Container.commentService && Container.commentService.commentCache) {
            this.commentCache = Container.commentService.commentCache;
        }
        if (this._activeEditor) {
            this.fetchComments()
                .catch(e => {
                    console.log(e);
                });
        }

        this._disposable = Disposable.from(
            window.onDidChangeActiveTextEditor(editor => {
                this._activeEditor = editor;
                this.commentCache = Container.commentService.commentCache;
                if (editor) {
                    this.fetchComments()
                        .catch(e => {
                            console.log(e);
                        });
                }
            }, null)
        );
    }

    dispose() {
        Container.lineTracker.stop(this);
        this._disposable && this._disposable.dispose();
    }

    /**
     * Creates a list of the existing commits (no-duplicate) in the active file.
     */
    async fetchComments() {
        if (!GitCommentService.isLoggedIn()) {
            return;
        }

        if (this._activeEditor) {
            this.decorations = [];
            const gitUri = await GitUri.fromUri(this._activeEditor.document.uri);
            this._activeFilename = path.relative(gitUri.repoPath ? gitUri.repoPath : '', gitUri.fsPath);
            this._activeFilename = this.normalizePath(this._activeFilename);
            const count = this._activeEditor.document.lineCount;
            const commitSha: CommitDic = {};
            const trackedDocument = await Container.tracker.getOrAdd(this._activeEditor.document);
            for (let i = 0; i < count; i++) {
                const blameLine = this._activeEditor.document.isDirty
                    ? await Container.git.getBlameForLineContents(
                        trackedDocument.uri,
                        i,
                        this._activeEditor.document.getText()
                    )
                    : await Container.git.getBlameForLine(trackedDocument.uri, i);
                if (blameLine === undefined) continue;
                const commit = blameLine.commit;

                if (commit === undefined || commitSha[commit.sha]) continue;
                commitSha[commit.sha] = commit;
            }

            Object.values(commitSha).map(async commit => {
                let comments: Comment[] = [];
                const hasCache = this.commentCache!.CachedItems.has(commit.sha)!;
                let cacheTimedout = true;
                if (hasCache) {
                    const cacheItem = this.commentCache!.CachedItems.get(commit.sha)!;
                    const timeDiff = Date.now() - cacheItem.FetchedTime;
                    const timeDiffThreshold = CommentCache.CacheTimeout * 1000 * 60;
                    if (timeDiff < timeDiffThreshold) {
                        cacheTimedout = false;
                        comments = cacheItem.Comments.filter(
                            c => c.Type === CommentType.Line && c.Commit && this._activeFilename === c.Path
                        );
                    }
                }

                if (!hasCache || cacheTimedout) {
                    comments = await Container.commentService.loadComments(commit) as Comment[];
                    if (comments === undefined) return;
                    comments = comments.filter(
                        c => c.Type === CommentType.Line && c.Commit && this._activeFilename === c.Path
                    );
                }

                this.updateDecorations(comments);
            });
        }
    }

    /**
     * Takes comment list, and denotes the corresponding lines of comments
     * with an icon.
     * @param comments: Comment[] Comment list of the current file
     */
    updateDecorations(comments: Comment[]) {
        if (!this._activeEditor) {
            return;
        }
        for (const comment of comments) {
            const line = comment.Line!;
            const decoration = { range: new Range(line, 0, line, 0) };
            this.decorations.push(decoration);
        }
        // remove duplicate entries
        this.decorations = [...new Set(this.decorations)];
        this._activeEditor.setDecorations(this.bookmarkDecorationType, this.decorations);
    }

    /**
     * BitBucket API returns paths with forward slashes.
     * like 'dir/file.ext'
     *
     * If our OS is treating with backslashes 'dir\file.ext', we need to convert them
     * @param path Active file name
     */
    normalizePath(path: string) {
        return path.replace('\\', '/');
    }
}
