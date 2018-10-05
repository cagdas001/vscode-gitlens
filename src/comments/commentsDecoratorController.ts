'use strict';
import * as path from 'path';
import {
    commands,
    DecorationOptions,
    Disposable,
    Range,
    TextEditor,
    window,
    OverviewRulerLane,
    Selection
} from 'vscode';
import { Container } from '../container';
import { GitCommit } from '../git/git';
import { BitbucketAPI, Comment } from '../api/bitbucket';
import { GitService, GitUri } from '../gitService';
import { ShowInputCommentCommand, CommentCommandType, ShowInputCommentCommandArgs } from '../commands/showInputComment';
import { ShowDiffMessage } from '../ui/ipc';
import { Commands } from '../commands/common';

interface CommitDic {
    [key: string]: GitCommit;
}
interface CommentMap {
    [key: number]: Comment[];
}
interface CommitOriginalLineMap {
    [key: string]: number;
}
export class CommentsDecoratorController implements Disposable {
    private _debugSessionEndDisposable: Disposable | undefined;
    private _disposable: Disposable;
    private _hoverProviderDisposable: Disposable | undefined;
    private _timeout: NodeJS.Timer | undefined;
    private _activeEditor: TextEditor | undefined;
    private _comments: Comment[] = [];
    private _fileComments: Comment[] = [];
    private _activeFilename: String | undefined;
    private _commentsMap: CommentMap = {};
    private _commentsIdMap: CommentMap = {};
    private _originalLineMap: CommitOriginalLineMap = {};

    static currentFileCommit: ShowDiffMessage;
    static showFileCommentHover: boolean = false;

    constructor() {

        this._activeEditor = window.activeTextEditor;
        if (this._activeEditor) {
            this.fetchComments();
        }

        this._disposable = Disposable.from(
            window.onDidChangeActiveTextEditor(editor => {

                this._activeEditor = editor;
                if (editor) {
                    this.fetchComments();
                }
            }, null)
        );

        commands.registerCommand('gitlens.commentCommitFile', this.commentToFile, this);
        commands.registerCommand('gitlens.showCommentCommitFile', this.showFileComment, this);

    }

    dispose() {
        Container.lineTracker.stop(this);
        this._disposable && this._disposable.dispose();
    }

    commentToFile() {
        if (CommentsDecoratorController.currentFileCommit) {
            const args: ShowInputCommentCommandArgs = {
                sha: CommentsDecoratorController.currentFileCommit.rsha,
                type: CommentCommandType.PUT
            };
            args.repoPath = CommentsDecoratorController.currentFileCommit.repoPath,

            commands.executeCommand(Commands.ShowInputComment, args);
        }
    }

    showFileComment() {
        const editor = window.activeTextEditor;
        if (editor) {
            const firstLength = editor.document.lineAt(0).text.length;
            const position = editor.selection.active;

            const newPosition = position.with(0, firstLength);
            const newSelection = new Selection(newPosition, newPosition);
            editor.selection = newSelection;
            CommentsDecoratorController.showFileCommentHover = true;
            setTimeout(() => {
                commands.executeCommand('editor.action.showHover');
                setTimeout(() => {
                    CommentsDecoratorController.showFileCommentHover = false;
                }, 1000);
            }, 1000);
        }
    }

    async fetchComments() {
        console.log('fetch');

        if (this._activeEditor && BitbucketAPI.isLoggedIn()) {
            const gitUri = await GitUri.fromUri(this._activeEditor.document.uri);
            this._activeFilename = path.relative(
                gitUri.repoPath ? gitUri.repoPath : '',
                gitUri.fsPath
            );
            const remotes = await Container.git.getRemotes(gitUri.repoPath);
            const bitbucket = new BitbucketAPI(remotes[0].path);

            this._comments = [];
            this._commentsMap = {};
            this._commentsIdMap = {};
            this._originalLineMap = {};
            this._fileComments = [];
            const count = this._activeEditor.document.lineCount;
            const commitSha: CommitDic = {};
            const trackedDocument = await Container.tracker.getOrAdd(this._activeEditor.document);
            for (let i = 0; i < count; i++) {
                const blameLine = this._activeEditor.document.isDirty
                ? await Container.git.getBlameForLineContents(trackedDocument.uri, i, this._activeEditor.document.getText())
                : await Container.git.getBlameForLine(trackedDocument.uri, i);
                if (blameLine === undefined) continue;
                const commit = blameLine.commit;

                this._originalLineMap[commit.sha + blameLine.line.originalLine.toString()] = i;
                if (commit === undefined || commitSha[commit.sha]) continue;
                commitSha[commit.sha] = commit;
            }
            for (const key of Object.keys(commitSha)) {
                bitbucket.getCommitComment(key).then(response => {
                    console.log(JSON.stringify(response));

                    const comments = response.values;
                    this._comments = this._comments.concat(comments);
                    this.triggerUpdateDecorations();
                });
            }
        }
	}

	triggerUpdateDecorations() {
		if (this._timeout) {
			clearTimeout(this._timeout);
		}
		this._timeout = setTimeout(this.updateDecorations.bind(this), 500);
	}

	updateDecorations() {
		if (!this._activeEditor) {
			return;
        }

        this._commentsMap = {};
        this._commentsIdMap = {};

        const bookmarkDecorationType = window.createTextEditorDecorationType({
            gutterIconPath: Container.context.asAbsolutePath('images/bookmark.svg'),
            overviewRulerLane: OverviewRulerLane.Full,
            overviewRulerColor: 'rgba(21, 126, 251, 0.7)'
        });
        this._activeEditor.setDecorations(bookmarkDecorationType, []);
        const decorations: DecorationOptions[] = [];
        for (const comment of this._comments) {
            if (!comment.deleted && comment.inline.to && comment.commit && this._activeFilename === comment.inline.path) {
                const line = this._originalLineMap[comment.commit.hash + (comment.inline.to - 1).toString()];
                if (!this._commentsMap[line]) this._commentsMap[line] = [];
                if (!this._commentsMap[line].includes(comment)) this._commentsMap[line].push(comment);
                this._commentsIdMap[comment.id] = [comment];
                const decoration = { range: new Range(line, 0, line, 0) };
                decorations.push(decoration);
            }
            else if (!comment.inline.to && !comment.inline.from && !comment.parent && comment.inline.path && this._activeFilename === comment.inline.path) {
                this._fileComments.push(comment);
                this._commentsIdMap[comment.id] = [comment];
            }
        }
        for (const comment of this._comments) {
            if (!comment.deleted && comment.parent && this._commentsIdMap[comment.parent.id]) {
                const parent = this._commentsIdMap[comment.parent.id][0];
                if (!parent.replies) parent.replies = [];
                parent.replies.push(comment);
            }
        }

        this._activeEditor.setDecorations(bookmarkDecorationType, decorations);

    }

    getCommentsMap() {
        return this._commentsMap;
    }

    getCommentsIdMap() {
        return this._commentsIdMap;
    }

    getFileComments() {
        return this._fileComments;
    }
}
