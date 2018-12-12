import { EventEmitter } from 'events';
import { AddLineCommentsCommandArgs } from './addLineComments';
import { ExternalApp } from './externalAppController';

export class CommentApp extends ExternalApp {
    protected commentArgs: AddLineCommentsCommandArgs;
    constructor(
        hostCmd: string,
        arg: string,
        eventEmitter: EventEmitter,
        commentArgs: AddLineCommentsCommandArgs,
        connectionStringPrefix: string = 'bitBucketCommentApp'
    ) {
        super(hostCmd, arg, eventEmitter, connectionStringPrefix);
        this.commentArgs = commentArgs;
    }

    /**
     * The bitBucketCommentApp expects 'init.editor' event to set editor content.
     * This function sends 'init.editor' message with the text payload.
     * @param text The text will be set into the editor
     */
    public initEditor(text: string) {
        this.sendMessage('init.editor', text);
    }

    public initSuggestions(text: string) {
        this.sendMessage('init.suggestions', text);
    }

    public show() {
        this.sendMessage('show');
    }

    public hide() {
        this.sendMessage('hide');
    }

    public exit() {
        this.quitApp();
    }

    /**
     * The default close function. This will check the keepOpen parameter
     * and automatically hide or quit the app.
     */
    public close() {
        if (this.keepOpen) {
            this.hide();
        }
        else {
            this.exit();
        }
    }

    // getter & setters
    public getCommentArgs() {
        return this.commentArgs;
    }

    public setCommentArgs(commentArgs: AddLineCommentsCommandArgs) {
        this.commentArgs = commentArgs;
    }
}
