'use strict';
import * as path from 'path';
import Axios, { AxiosBasicCredentials } from 'axios';
import { commands, Disposable, window, Selection } from 'vscode';
import { Commands, getCommandUri } from './commands/common';
import { Container } from './container';
import { GitCommit } from './git/models/commit';
import { Logger } from './logger';
import { AddLineCommentCommand } from './commands/addLineComments';
import { GitUri } from './git/gitUri';
import { ShowDiffMessage } from './ui/ipc';

/**
 * Enum to for different comment types.
 */
export enum CommentType {
    File = 'file',
    Line = 'line',
    Commit = 'commit'
}

/**
 * Encapsulates comment/reply info.
 */
export class Comment {
    Commit?: GitCommit;
    Message?: string;
    Type?: CommentType;
    Id?: number;
    ParentId?: number;
    Line?: number;
    Path?: string;
    Sha?: string;
    Replies: Comment[] = [];
}

/**
 * The service that communicates with remote repository store.
 */
export class GitCommentService implements Disposable {
    /**
     * Base Url for V1 apis.
     */
    private readonly V1_BaseURL = 'https://bitbucket.org/api/1.0/repositories';

    /**
     * Base Url for V2 apis.
     */
    private readonly V2_BaseURL = 'https://api.bitbucket.org/2.0/repositories';

    private static username?: string;
    private static password?: string;

    public static lastFetchedComments: Comment[] | undefined;
    public static showCommentsCache: boolean = false;

    constructor() {
        commands.registerCommand('gitlens.commentCommitFile', this.commentToFile, this);
        commands.registerCommand('gitlens.showCommentCommitFile', this.showFileComment, this);
    }

    async commentToFile() {
        if (!AddLineCommentCommand.currentFileCommit || !window.activeTextEditor) return undefined;
        const gitUri = await GitUri.fromUri(window.activeTextEditor.document.uri);
        const filename: string = path.relative(
            AddLineCommentCommand.currentFileCommit.repoPath,
            gitUri.fsPath
        );
        let fileCommit = {
            sha: AddLineCommentCommand.currentFileCommit.rsha,
            repoPath: AddLineCommentCommand.currentFileCommit.repoPath,
            fileName: filename
        } as GitCommit;

        commands.executeCommand(Commands.AddLineComment,
            {
                fileName: fileCommit.fileName,
                commit: fileCommit
            }
        );
        return;
    }

    async showFileComment() {
        if (!AddLineCommentCommand.currentFileCommit || !window.activeTextEditor) return undefined;
        const gitUri = await GitUri.fromUri(window.activeTextEditor.document.uri);
        const filename: string = path.relative(
            AddLineCommentCommand.currentFileCommit.repoPath,
            gitUri.fsPath
        );
        let fileCommit = {
            sha: AddLineCommentCommand.currentFileCommit.rsha,
            repoPath: AddLineCommentCommand.currentFileCommit.repoPath,
            fileName: filename
        } as GitCommit;

        commands.executeCommand(Commands.AddLineComment, {
            fileName: fileCommit.fileName,
            commit: fileCommit,
            isFileComment: true
        });
        return;
    }

    /**
     * Sets credentials that can be used for authenticating with remote git server.
     * @param username the username to be used for authentication
     * @param password the username to be used for authentication
     */
    static UseCredentials(username: string, password: string) {
        this.username = username;
        this.password = password;
    }

    /**
     * Resets auth credentials.
     */
    private static ClearCredentials() {
        this.username = undefined;
        this.password = undefined;
    }

    /**
     * Gets corresponding reomte path for given local file path.
     * @param localFilePath local file path
     */
    public async getRemoteRepoPath(localFilePath: string) {
        const repo = await Container.git.getRemotes(localFilePath);

        const bitREpo = repo.filter(r => {
            return r.provider!.domain!.includes('bitbucket');
        });
        return bitREpo![0]!.path;
    }

    /**
     * Prompts user to enter remote repository credentials.
     */
    private static async getCredentials(): Promise<AxiosBasicCredentials> {
        if (!GitCommentService.username || !GitCommentService.password) {
            await commands.executeCommand(Commands.BitBuckerServiceAuth);
        }
        return { username: GitCommentService.username, password: GitCommentService.password } as AxiosBasicCredentials;
    }

    /**
     * Loads all comments for the given commit.
     * @param commit commit
     */
    async loadComments(commit: GitCommit): Promise<void | Comment[] | undefined> {
        const baseUrl = this.V2_BaseURL;
        const path = await this.getRemoteRepoPath(commit.repoPath);
        if (!path) {
            return;
        }
        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const url = `${baseUrl}/${path}/commit/${sha}/comments/`;
        const result: Comment[] = [];
        const commentsMap = new Map<Number, Comment>();

        let next: string | null | undefined = url;
        while (next) {
            await Axios.create({
                auth: auth
            })
                .get(next)
                .then(v => {
                    const items = v!.data!.values! as any[];
                    items!.forEach(c => {
                        if (!c!.deleted) {
                            const comment = { Commit: commit } as Comment;
                            if (c!.content && c!.content.raw) {
                                comment.Message = c.content.raw;
                            }
                            if (c.id) {
                                comment.Id = c.id;
                            }
                            //  if (c.inline && c.inline.to !== undefined) {
                            comment.Line = (c.inline.to as number)! - 1;
                            if (comment.Line === -1) {
                                comment.Type = CommentType.File;
                            }
                            else {
                                comment.Type = CommentType.Line;
                            }
                            // }
                            if (c.inline && c.inline.path) {
                                comment.Path = c.inline.path;
                            }
                            if (c.commit && c.commit.hash) {
                                comment.Sha = c.commit.hash;
                            }
                            if (c.parent && c.parent.id) {
                                comment.ParentId = c.parent.id;
                            }

                            // Note: There is a bug in BitBucker API. It doesnot add Line number when returing reply.
                            // so check the parent and normalize.
                            if (comment.ParentId!) {
                                const parent = commentsMap.get(comment.ParentId!);
                                if (parent!) {
                                    comment.Line = parent!.Line;
                                    comment.Type = parent!.Type;
                                    if (parent!.Replies) {
                                        parent!.Replies.push(comment);
                                    }
                                    else {
                                        parent!.Replies = [comment];
                                    }
                                }
                            }

                            commentsMap.set(c.id, comment);

                            result.push(comment);
                        }
                    });
                    console.log(v);
                    if (v!.data!.next) {
                        next = v!.data!.next;
                    }
                    else {
                        next = null;
                    }
                    return result;
                })
                .catch(e => {
                    if (e!.response!.status === 401 || e!.response!.status === 403) {
                        window.showErrorMessage('Incorrect Bit Bucket Service Credentials.');
                        GitCommentService.ClearCredentials();
                    }

                    Logger.log(e);
                    next = null;
                });
        }

        return result.filter(c => c.ParentId === undefined);
    }

    /**
     * Adds a comment on remote server.
     * @param commit commit id
     * @param comment comment to be added
     * @param fileName File Name to comment on.
     * @param line Line number for the comment.
     * @param parentId Parent id to be specified for replying to a comment.
     */
    async addComment(
        commit: GitCommit,
        comment: string,
        fileName: string,
        line?: number,
        parentId?: number
    ): Promise<void> {
        if (!comment) {
            return;
        }
        const baseUrl = this.V2_BaseURL;
        const path = await this.getRemoteRepoPath(commit.repoPath);
        if (!path) {
            return;
        }
        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const url = `${baseUrl}/${path}/commit/${sha}/comments/`;
        const to = line! + 1;
        const data = {
            content: {
                raw: comment
            },
            inline: {
                path: fileName,
                to: to || undefined
            },
            parent: parentId ? { id: parentId } : undefined
        };
        await Axios.create({
            auth: auth
        })
            .post(url, data)
            .then(response => {
                window.showInformationMessage('Comment/reply added successfully.');
                if (GitCommentService.lastFetchedComments) {
                    let newComment: Comment = {
                        Id: response.data.id,
                        Commit: commit,
                        Message: comment,
                        Line: line,
                        Path: fileName,
                        Sha: commit.sha,
                        ParentId: parentId ? parentId : undefined,
                        Replies: []
                    };
                    if (line) {
                        newComment.Type = CommentType.Line;
                    }
                    else {
                        newComment.Type = CommentType.File;
                    }
                    if (newComment.ParentId) {
                        function checkReply(replies: Comment[]) {
                            return replies.map(comment => {
                                if (comment.Id === newComment.ParentId) {
                                    newComment.Type = comment.Type;
                                    newComment.Line = comment.Line;
                                    if (comment.Replies) {
                                        comment.Replies.push(newComment);
                                    }
                                    else {
                                        comment.Replies = [newComment];
                                    }
                                }
                                else if (comment.Replies) {
                                    comment.Replies = checkReply(comment.Replies);
                                }
                                return comment;
                            })
                        }
                        GitCommentService.lastFetchedComments = checkReply(GitCommentService.lastFetchedComments);
                    }
                    else {
                        GitCommentService.lastFetchedComments.push(newComment);
                    }
                }
                this.updateView();
            })
            .catch(e => {
                if (e!.response!.status === 401 || e!.response!.status === 403) {
                    window.showErrorMessage('Incorrect Bit Bucket Service Credentials. Could not add comment/reply.');
                    GitCommentService.ClearCredentials();
                }
                else {
                    window.showErrorMessage('Failed to add comment/reply.');
                }
            });
    }

    /**
     * Edit comment on Git Remote server.
     * @param commit Commit to be used for editing
     * @param comment New value
     * @param commentId Comment to be edited.
     */
    async editComment(commit: GitCommit, comment: string, commentId: number): Promise<void> {
        if (!comment) {
            return;
        }
        const baseUrl = this.V1_BaseURL;
        const path = await this.getRemoteRepoPath(commit.repoPath);
        if (!path) {
            return;
        }
        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const url = `${baseUrl}/${path}/changesets/${sha}/comments/${commentId}`;
        const data = {
            content: comment,
            comment_id: commentId
        };
        await Axios.create({
            auth: auth
        })
            .put(url, data)
            .then(v => {
                window.showInformationMessage('Comment/reply edited successfully.');
                if (GitCommentService.lastFetchedComments) {
                    GitCommentService.lastFetchedComments = GitCommentService.lastFetchedComments.map(item => {
                        if (item.Id === commentId) {
                            item.Message = comment;
                        }
                        else {
                            function checkReply(replies: Comment[]) {
                                for (const reply of replies) {
                                    if (reply.Id === commentId) {
                                        reply.Message = comment;
                                    }
                                    if (reply.Replies) {
                                        checkReply(reply.Replies);
                                    }
                                }
                            }
                            if (item.Replies) {
                                checkReply(item.Replies);
                            }
                        }
                        return item;
                    });
                }
                this.updateView();
            })
            .catch(e => {
                if (e!.response!.status === 401 || e!.response!.status === 403) {
                    window.showErrorMessage('Incorrect Bit Bucket Service Credentials. Could not edit comment/reply.');
                    GitCommentService.ClearCredentials();
                }
                else {
                    window.showErrorMessage('Failed to add comment/reply.');
                }
            });
    }

    /**
     * Deletes comment/reply on Git remote server.
     * @param commit commit to be used for deleting comment
     * @param commentId comment to be deleted.
     */
    async deleteComment(commit: GitCommit, commentId: number): Promise<void> {
        const baseUrl = this.V1_BaseURL;
        const auth = await GitCommentService.getCredentials();
        const sha = commit.sha;
        const path = await this.getRemoteRepoPath(commit.repoPath);
        const url = `${baseUrl}/${path}/changesets/${sha}/comments/${commentId}`;

        await Axios.create({
            auth: auth
        })
            .delete(url)
            .then(v => {
                window.showInformationMessage('Comment/reply deleted successfully.');
                if (GitCommentService.lastFetchedComments) {
                    GitCommentService.lastFetchedComments = GitCommentService.lastFetchedComments.filter(comment => {
                        function checkReply(replies: Comment[]) {
                            return replies.filter(reply => {
                                if (reply.Replies) {
                                    checkReply(reply.Replies);
                                }
                                return reply.Id !== commentId
                            });
                        }
                        if (comment.Replies) {
                            comment.Replies = checkReply(comment.Replies);
                        }
                        return comment.Id !== commentId
                    });
                }
                this.updateView();
            })
            .catch(e => {
                if (e!.response!.status === 401 || e!.response!.status === 403) {
                    window.showErrorMessage('Incorrect Bit Bucket Service Credentials. Could not delete comment/reply.');
                    GitCommentService.ClearCredentials();
                }
                else {
                    window.showErrorMessage('Failed to delete comment/reply.');
                }
            });
    }

    private updateView() {
        const editor = window.activeTextEditor;
        if (editor) {
            const firstLength = editor.document.lineAt(0).text.length;
            const position = editor.selection.active;
            const newPosition = position.with(0, firstLength);
            const newSelection = new Selection(newPosition, newPosition);
            editor.selection = newSelection;
            setTimeout(() => {
                GitCommentService.showCommentsCache = true;
                const originalSelection = new Selection(position, position);
                editor.selection = originalSelection;
                setTimeout(() => {
                    commands.executeCommand('editor.action.showHover');
                }, 500);
            }, 200);
        }
    }

    dispose() {}
}
