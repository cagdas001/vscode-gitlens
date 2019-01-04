'use strict';
import { EventEmitter } from 'events';
import * as path from 'path';
import { CancellationTokenSource, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Comment, CommentCacheItem, CommentType } from '../gitCommentService';
import { GitCommit, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommentsQuickPick } from '../quickpicks';
import { Strings } from '../system';
import { ShowDiffMessage } from '../ui/ipc';
import { CommentApp } from './commentAppController';
import { ActiveEditorCachedCommand, Commands, getCommandUri, getRepoPathOrActiveOrPrompt } from './common';
import * as externalAppController from './externalAppController';

/**
 * Line number will be sent in To or From field.
 * See for details:
 * https://developer.atlassian.com/bitbucket/api/2/reference/resource/repositories/%7Busername%7D/%7Brepo_slug%7D/commit/%7Bnode%7D/comments#get
 */
export enum lineCommentTypes {
    To,
    From
}

/**
 *Encapsulates infomation to perform comments management command.
 */
export interface AddLineCommentsCommandArgs {
    commit?: GitCommit;
    line?: number;
    fileName?: string;
    id?: number;
    message?: string;
    editCommand?: CommandQuickPickItem;
    replyCommand?: CommandQuickPickItem;
    type?: operationTypes;
    isFileComment?: boolean;
    lineCommentType?: lineCommentTypes;
}

/**
 * Different Comment management commands.
 */
export enum operationTypes {
    Create,
    Delete,
    Edit,
    Reply
}

// the app instance
export let commentApp: CommentApp;

/**
 * Command to add/edit/delete/reply an inline or file comment.
 */
export class AddLineCommentCommand extends ActiveEditorCachedCommand {
    /**
     * Gets markdown for command with given argumants.
     * @param args to be serialized.
     */
    static getMarkdownCommandArgs(args: AddLineCommentsCommandArgs): string {
        return super.getMarkdownCommandArgsCore<AddLineCommentsCommandArgs>(Commands.AddLineComment, args);
    }

    static currentFileCommit: ShowDiffMessage;
    static currentFileGitCommit: GitCommit;
    static currentFileName: string;
    static showFileCommitComment: boolean = false;

    static rightDocumentUri: Uri;
    static leftDocumentUri: Uri;

    // required parameters for bitBucketCommentApp
    private eventEmitter: EventEmitter;
    private BITBUCKET_COMMENT_APP_NAME = 'bitbucket-comment-app';
    private BITBUCKET_COMMENT_APP_PATH = path.join(__dirname, this.BITBUCKET_COMMENT_APP_NAME);
    private electronPath = externalAppController.getElectronPath();

    constructor() {
        super(Commands.AddLineComment);
        this.eventEmitter = new EventEmitter();
        this.eventEmitter.on('vscode.app.message', this.onMessage);
    }

    /**
     * onMessage event for node-ipc connections
     * @param message Message data from the external app
     */
    async onMessage(message: any) {
        const data = JSON.parse(message);
        const commentArgs = commentApp.getCommentArgs();
        // make sure we're getting the message from correct window
        if (data.id === commentApp.getConnectionString() && data.command === 'save.comment') {
            if (!commentArgs.id) {
                // new comment
                await Container.commentService.addComment(
                    commentArgs.commit!,
                    data.payload as string,
                    commentArgs.fileName as string,
                    commentArgs.line,
                    commentArgs.lineCommentType
                );

                // add the new comment in cache
                // add decoration for new comment
                if (data.payload) {
                    const newComment = new Comment();
                    newComment.Line = commentArgs.line!;
                    newComment.Path = commentArgs.fileName!;
                    newComment.Type = CommentType.Line;
                    newComment.Commit = commentArgs.commit;

                    const cache = Container.commentService.commentCache;
                    const hasCache = cache.CachedItems.has(commentArgs.commit!.sha);
                    if (hasCache) {
                        const cachedComment = cache.CachedItems.get(commentArgs.commit!.sha)!;
                        cachedComment!.Comments.push(newComment);
                    }
                    else {
                        const cacheItem = new CommentCacheItem([newComment]);
                        cache.CachedItems.set(commentArgs.commit!.sha, cacheItem);
                    }
                    Container.commentsDecorator.updateDecorations([newComment]);
                }
            }
            else if (commentArgs.type === operationTypes.Reply) {
                // reply
                await Container.commentService.addComment(
                    commentArgs.commit!,
                    data.payload as string,
                    commentArgs.fileName as string,
                    commentArgs.line,
                    commentArgs.lineCommentType,
                    commentArgs.id
                );
            }
            else if (commentArgs.type === operationTypes.Edit) {
                // edit
                await Container.commentService.editComment(commentArgs.commit!, data.payload!, commentArgs.id!);
            }
            // clear the args of instance
            commentApp.setCommentArgs({} as AddLineCommentsCommandArgs);
        }
        else if (data.id === commentApp.getConnectionString() && data.command === 'ui.ready') {
            const initText = commentArgs.type === operationTypes.Edit ? commentArgs.message! : '';
            commentApp.initEditor(initText);
        }
        else if (data.id === commentApp.getConnectionString() && data.command === 'send.suggestions.keyword') {
            const participants = await Container.commentService.retrieveParticipants(data.payload!);
            commentApp.sendSuggestions(JSON.stringify(participants));
        }
        else if (data.id === commentApp.getConnectionString() && data.command === 'close') {
            commentApp.close();
        }
    }

    /**
     * This function decides automatically if it needs to run a new app,
     * or just show (un-hide) the current open app.
     *
     * If there are running instance, and keepOpen is set to true
     * then shows the running instance.
     *
     * Otherwise spawns a new one.
     * @param args Comment arguments
     */
    showOrRunApp(args: AddLineCommentsCommandArgs) {
        const initText = args.type === operationTypes.Edit ? args.message! : '';
        if (commentApp && commentApp.isRunning() && commentApp.getKeepOpen()) {
            commentApp.setCommentArgs(args);
            commentApp.initEditor(initText);
            commentApp.show();
        }
        else {
            if (!externalAppController.isAllowedToRun()) {
                window.showWarningMessage(externalAppController.exceedsMaxWindowWarningMessage);
                return;
            }
            commentApp = new CommentApp(this.electronPath, this.BITBUCKET_COMMENT_APP_PATH, this.eventEmitter, args);
            commentApp.run();
            commentApp.setUpConnection();
            commentApp.initEditor(initText);
        }
    }

    /**
     * Prepends offset to a message to give illusion of hirarchy on rendering to UI.
     * @param level Number of times to prepend offset.
     */
    static commentStartRender(level: number): string {
        let message = ``;
        while (level > 0) {
            message += `${GlyphChars.SpaceThin}${Strings.pad(GlyphChars.Dash, 2, 3)}${GlyphChars.Space}`;
            level = level - 1;
        }
        return message;
    }

    /**
     * Gets command quick pick corresponding to given command.
     * @param uri
     * @param fileName
     * @param commit
     */
    private getAddFileCommentCommand(uri: Uri, fileName: string, commit: GitCommit): CommandQuickPickItem {
        const cmdArg = {
            fileName: fileName,
            commit: commit
        } as AddLineCommentsCommandArgs;

        return new CommandQuickPickItem(
            {
                label: `${Strings.pad(GlyphChars.Pencil, 2, 3)} Add Comment`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} Add comment`
            },
            Commands.AddLineComment,
            [uri, cmdArg]
        );
    }

    /**
     * Returns a flattened array for hirarchy of comments/replies.
     * @param level
     * @param ele
     * @param uri
     */
    static flattenCommands(level: number, ele: Comment, uri?: Uri): CommandQuickPickItem[] {
        let commands: CommandQuickPickItem[] = [];
        try {
            const message = this.commentStartRender(level) + ele.Message;

            const cmdArg = {
                fileName: ele.Path,
                commit: ele.Commit,
                id: ele.Id,
                message: ele.Message
            } as AddLineCommentsCommandArgs;

            const cmd = new CommandQuickPickItem(
                {
                    label: message
                },
                Commands.AddLineComment,
                [uri, cmdArg]
            );

            commands.push(cmd);

            if (ele.Replies !== undefined) {
                ele.Replies!.forEach(reply => {
                    commands = [...commands, ...this.flattenCommands(level + 1, reply, uri)];
                });
            }

            return commands;
        }
        catch (e) {
            console.log(e);
            return commands;
        }
    }

    async execute(editor?: TextEditor, uri?: Uri, args: AddLineCommentsCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri && (await GitUri.fromUri(uri));

        const repoPath = await getRepoPathOrActiveOrPrompt(
            gitUri,
            editor,
            `Search for commits in which repository${GlyphChars.Ellipsis}`
            // args.goBackCommand
        );
        if (!repoPath) return undefined;

        if (args.isFileComment) {
            const allComments = await Container.commentService.loadComments(args.commit!);
            const fileComments = (allComments as Comment[])!.filter(
                c => c.Path === args.fileName && c.Type === CommentType.File
            );
            let fileCommands: CommandQuickPickItem[] = [];
            fileComments.forEach(element => {
                if (element.ParentId === undefined) {
                    fileCommands = [...fileCommands, ...AddLineCommentCommand.flattenCommands(0, element, uri)];
                }
            });
            const pick = await CommentsQuickPick.showFileComments(fileCommands, {
                addCommand: this.getAddFileCommentCommand(uri!, args.fileName!, args.commit!)
            });
            if (pick === undefined) return undefined;

            if (pick instanceof CommandQuickPickItem) return pick.execute();
        }
        const searchLabel: string | undefined = undefined;
        let progressCancellation: CancellationTokenSource | undefined = undefined;

        const comment: string | undefined = args.message;
        try {
            if (args.id) {
                if (!args.type) {
                    // show edit/reply comment
                    progressCancellation = CommentsQuickPick.showProgress(searchLabel!);
                    const pick = await CommentsQuickPick.show(comment!, {
                        deleteCommand: new CommandQuickPickItem(
                            {
                                label: `${Strings.pad(GlyphChars.Asterisk, 2, 3)} Delete Comment`,
                                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} delete comment`
                            },
                            Commands.AddLineComment,
                            [uri, { ...args, type: operationTypes.Delete }]
                        ),
                        editCommand: new CommandQuickPickItem(
                            {
                                label: `${Strings.pad(GlyphChars.Pencil, 2, 3)} Edit Comment`,
                                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} edit comment`
                            },
                            Commands.AddLineComment,
                            [uri, { ...args, type: operationTypes.Edit }]
                        ),
                        replyCommand: new CommandQuickPickItem(
                            {
                                label: `${Strings.pad(GlyphChars.Pencil, 2, 3)} Reply To Comment`,
                                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} reply to comment`
                            },
                            Commands.AddLineComment,
                            [uri, { ...args, type: operationTypes.Reply }]
                        )
                    });

                    progressCancellation.cancel();

                    if (pick === undefined) return undefined;

                    if (pick instanceof CommandQuickPickItem) return pick.execute();
                }
                else if (args.type === operationTypes.Edit || args.type === operationTypes.Reply) {
                    this.showOrRunApp(args);
                }

                if (args.type === operationTypes.Delete) {
                    await Container.commentService.deleteComment(args.commit!, args.id);

                    const deletedComment = new Comment();
                    deletedComment.Line = args.line!;
                    deletedComment.Path = args.fileName!;
                    deletedComment.Type = CommentType.Line;
                    deletedComment.Commit = args.commit;
                    deletedComment.Id = args.id;

                    const cache = Container.commentService.commentCache;
                    const hasCache = cache.CachedItems.has(args.commit!.sha);
                    let removeDecoration = true;
                    if (hasCache) {
                        // delete comment from cache
                        const cachedComment = cache.CachedItems.get(args.commit!.sha)!;
                        for (let index = 0; index < cachedComment.Comments.length; ++index) {
                            const comment = cachedComment.Comments[index];
                            if (comment.Id === args.id) {
                                cachedComment.Comments.splice(index, 1);
                            }
                            else if (comment.Line === args.line && comment.Path === args.fileName) {
                                // there's still another comment on this line
                                // no need to remove decoration
                                removeDecoration = false;
                                break;
                            }
                        }
                    }
                    Container.commentsDecorator.updateDecorations([deletedComment], removeDecoration);
                }
            }
            else {
                this.showOrRunApp(args);
            }

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'AddLineCommentCommand');

            return window.showErrorMessage(`Unable to find comment. See output channel for more details`);
        }
        finally {
            if (progressCancellation !== undefined) {
                (progressCancellation as CancellationTokenSource)!.cancel();
            }
        }
    }
}
