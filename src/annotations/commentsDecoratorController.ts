'use strict';
import * as path from 'path';
import { DecorationOptions, Disposable, OverviewRulerLane, Range, TextEditor, window } from 'vscode';
import { Container } from '../container';
import { GitCommit } from '../git/git';
import { Comment, CommentCache, CommentType, GitCommentService } from '../gitCommentService';
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
                            c => c.Type === CommentType.Line && c.Commit && this._activeFilename === path.normalize(c.Path!)
                                && !c.ParentId
                        );
                    }
                }

                if (!hasCache || cacheTimedout) {
                    comments = await Container.commentService.loadComments(commit) as Comment[];
                    if (comments === undefined) return;
                    comments = comments.filter(
                        c => c.Type === CommentType.Line && c.Commit && this._activeFilename === path.normalize(c.Path!)
                            && !c.ParentId
                    );
                }

                this.updateDecorations(comments);
            });
        }
    }

    /**
     * Takes comment list, and denotes (or removes) the corresponding lines of comments
     * with an icon.
     * @param comments: Comment[] Comment list of the current file
     * @param removeDecoration: bool True if decorations of comments will be removed.
     * False if decorations of comments will be added.
     */
    updateDecorations(comments: Comment[], removeDecoration = false) {
        if (!this._activeEditor) {
            return;
        }
        for (const comment of comments) {
            const line = comment.Line!;
            const decoration = { range: new Range(line, 0, line, 0) };
            if (removeDecoration) {
                const index = this.decorations.findIndex(d => JSON.stringify(d) === JSON.stringify(decoration));
                this.decorations.splice(index, 1);
            }
            else if (!this.decorations.includes(decoration)) {
                this.decorations.push(decoration);
            }
        }
        this._activeEditor.setDecorations(this.bookmarkDecorationType, this.decorations);
    }
}
