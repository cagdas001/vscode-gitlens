'use strict';
import * as path from 'path';
import { BitbucketAPI, CommitCommentType, BitbucketResponse } from '../api/bitbucket';
import { TextEditor, Uri, window, workspace, ProgressLocation, commands, Selection  } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitLog, GitLogCommit, GitService, GitUri } from '../gitService';
import { CommandQuickPickItem, CommitFileQuickPick } from '../quickpicks';
import {
    ActiveEditorCachedCommand,
    CommandContext,
    Commands,
    getCommandUri,
    isCommandViewContextWithCommit
} from './common';

export enum CommentCommandType {
    PUT,
    REPLY,
    EDIT,
    DELETE
}

export interface ShowInputCommentCommandArgs {
    id?: number;
    sha?: string;
    repoPath?: string;
    commit?: GitCommit | GitLogCommit;
    fileLog?: GitLog;
    line?: number;
    type: CommentCommandType;

    goBackCommand?: CommandQuickPickItem;
}

export class ShowInputCommentCommand extends ActiveEditorCachedCommand {

    static getMarkdownCommandArgs(commit: GitCommit, sha: string, line: number): string {
        const args: ShowInputCommentCommandArgs = { sha: sha, type: CommentCommandType.PUT };
        args.line = line;
        args.commit = commit;
        return super.getMarkdownCommandArgsCore<ShowInputCommentCommandArgs>(
            Commands.ShowInputComment,
            args
        );
    }

    static getMarkdownCommandFileArgs(repoPath: string, sha: string): string {
        const args: ShowInputCommentCommandArgs = { sha: sha, type: CommentCommandType.PUT };
        args.repoPath = repoPath;
        return super.getMarkdownCommandArgsCore<ShowInputCommentCommandArgs>(
            Commands.ShowInputComment,
            args
        );
    }

    static getMarkdownCommandByIdArgs(commit: GitCommit, sha: string, id: number, type: CommentCommandType): string {
        const args: ShowInputCommentCommandArgs = { sha: sha, id: id, type: type };
        args.commit = commit;
        return super.getMarkdownCommandArgsCore<ShowInputCommentCommandArgs>(
            Commands.ShowInputComment,
            args
        );
    }

    static getMarkdownCommandFileByIdArgs(repoPath: string, sha: string, id: number, type: CommentCommandType): string {
        const args: ShowInputCommentCommandArgs = { sha: sha, id: id, type: type };
        args.repoPath = repoPath;
        return super.getMarkdownCommandArgsCore<ShowInputCommentCommandArgs>(
            Commands.ShowInputComment,
            args
        );
    }

    constructor() {
        super(Commands.ShowInputComment);
    }

    protected async preExecute(
        context: CommandContext,
        args: ShowInputCommentCommandArgs = { type: CommentCommandType.PUT }
    ): Promise<any> {
        if (context.type === 'view') {
            args = { ...args };
            args.sha = context.node.uri.sha;

            if (isCommandViewContextWithCommit(context)) {
                args.commit = context.node.commit;
            }
        }
        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: ShowInputCommentCommandArgs = { type: CommentCommandType.PUT }) {
        uri = getCommandUri(uri, editor);
        if (uri == null) return undefined;
        const gitUri = await GitUri.fromUri(uri);

        const remotes = await Container.git.getRemotes(gitUri.repoPath);
        const bitbucket = new BitbucketAPI(remotes[0].path);

        if (!BitbucketAPI.isLoggedIn()) {
            window.showWarningMessage('Please log in to Bitbucket via GitLens Explorer menu.');
            return;
        }

        if (!args.sha || typeof args.sha !== 'string') {
            return;
        }

        if (args.type === CommentCommandType.DELETE) {
            const sha: string = typeof args.sha === 'string' ? args.sha : '';
            if (args.id) {
                const p = bitbucket.deleteComment(
                    sha,
                    args.id
                ).then(response => {
                    Container.commentsDecorator.fetchComments();
                    const resp = response as BitbucketResponse;
                    if (resp.error) {
                        window.showErrorMessage(resp.error.message);
                    }
                    else {
                        window.showInformationMessage('Comment deleted.');
                    }
                });
            }
            return ;
        }
        const inputBox = await window.showInputBox({
            placeHolder: 'Write comment...'
        });
        if (inputBox) {
            const repoPath = args.commit ? args.commit.repoPath : args.repoPath;
            if (!repoPath) return;
            const sha: string = typeof args.sha === 'string' ? args.sha : '';
            const filename: string = path.relative(repoPath, gitUri.fsPath);

            window.withProgress({
                location: ProgressLocation.Notification,
                title: 'Sending comment...',
                cancellable: true
            }, (progress, token) => {

                progress.report({ increment: 30 });

                if (args.type === CommentCommandType.REPLY && args.id) {
                    const p = bitbucket.putCommentReply(
                        sha,
                        args.id,
                        filename,
                        inputBox
                    ).then(response => {
                        progress.report({ increment: 70 });
                        Container.commentsDecorator.fetchComments();
                        const resp = response as BitbucketResponse;
                        if (resp.error) {
                            window.showErrorMessage(resp.error.message);
                        }
                        else {
                            window.showInformationMessage('Comment sent.');
                        }
                    });

                    return p;
                }
                else {
                    const type = args.line ? CommitCommentType.LINE : CommitCommentType.FILE;
                    const p = bitbucket.putCommitComment(
                        sha,
                        filename,
                        inputBox,
                        type,
                        args.line
                    ).then(response => {
                        progress.report({ increment: 70 });
                        Container.commentsDecorator.fetchComments();
                        const resp = response as BitbucketResponse;
                        if (resp.error) {
                            window.showErrorMessage(resp.error.message);
                        }
                        else {
                            window.showInformationMessage('Comment sent.');
                        }
                    });

                    return p;
                }
            });

        }
        return inputBox;

    }
}
