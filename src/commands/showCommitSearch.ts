'use strict';
import { areRangesOverlapping } from 'date-fns';
import { commands, InputBoxOptions, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitRepoSearchBy, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitsQuickPick, ShowCommitsSearchInResultsQuickPickItem } from '../quickpicks';
import { Strings } from '../system';
import { Iterables } from '../system/iterable';
import { ShowAllNode } from '../views/nodes';
import { ActiveEditorCachedCommand, Commands, getCommandUri, getRepoPathOrActiveOrPrompt } from './common';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';

const searchByRegex = /^([@~=:#])/;
const searchByMap = new Map<string, GitRepoSearchBy>([
    ['@', GitRepoSearchBy.Author],
    ['~', GitRepoSearchBy.ChangedLines],
    ['=', GitRepoSearchBy.Changes],
    [':', GitRepoSearchBy.Files],
    ['#', GitRepoSearchBy.Sha]
]);

export interface ShowCommitSearchCommandArgs {
    search?: string;
    searchBy?: GitRepoSearchBy[];
    maxCount?: number;
    branch?: string;
    author?: string;
    since?: string;
    before?: Date;
    after?: Date;
    showMergeCommits?: boolean;

    goBackCommand?: CommandQuickPickItem;
}

export class ShowCommitSearchCommand extends ActiveEditorCachedCommand {
    constructor() {
        super(Commands.ShowCommitSearch);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: ShowCommitSearchCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri && (await GitUri.fromUri(uri));

        const repoPath = await getRepoPathOrActiveOrPrompt(
            gitUri,
            editor,
            `Search for commits in which repository${GlyphChars.Ellipsis}`,
            args.goBackCommand
        );
        if (!repoPath) return undefined;

        args = { ...args };
        const originalArgs = { ...args };

        const searchByValuesMap = new Map<GitRepoSearchBy, string>();

        if (!args.search || args.searchBy == null || args.searchBy.length === 0) {
            try {
                if (!args.search) {
                    if (editor != null && gitUri != null) {
                        const blameLine = await Container.git.getBlameForLine(gitUri, editor.selection.active.line);
                        if (blameLine !== undefined && !blameLine.commit.isUncommitted) {
                            args.search = `#${blameLine.commit.shortSha}`;
                        }
                    }
                }
            }
            catch (ex) {
                Logger.error(ex, 'ShowCommitSearchCommand', 'search prefetch failed');
            }
            args.search = args.search || '';

            originalArgs.search = args.search;

            const match = searchByRegex.exec(args.search);
            if (match && match[1]) {
                const searchByValue = args.search.substring(args.search[1] === ' ' ? 2 : 1);
                const searchBy = searchByMap.get(match[1]);
                if (searchBy) {
                    searchByValuesMap.set(searchBy, searchByValue);
                }
            }
            else if (GitService.isSha(args.search)) {
                searchByValuesMap.set(GitRepoSearchBy.Sha, args.search);
            }
            else {
                searchByValuesMap.set(GitRepoSearchBy.Message, args.search);
            }
        }
        if (args.author && !searchByValuesMap.get(GitRepoSearchBy.Author)) {
            searchByValuesMap.set(GitRepoSearchBy.Author, args.author);
        }
        if (args.branch) {
            searchByValuesMap.set(GitRepoSearchBy.Branch, args.branch);
        }
        if (args.since && args.since !== '-1') {
            searchByValuesMap.set(GitRepoSearchBy.Since, args.since);
        }
        else {
            if (args.before) {
                searchByValuesMap.set(GitRepoSearchBy.Before, args.before.toString());
            }
            if (args.after) {
                searchByValuesMap.set(GitRepoSearchBy.After, args.after.toString());
            }
        }
        if (searchByValuesMap.size === 0) {
            searchByValuesMap.set(GitRepoSearchBy.Message, args.search);
        }
        const searchLabel: string | undefined = undefined;
        const progressCancellation = CommitsQuickPick.showProgress(searchLabel!);

        try {
            const log = await Container.git.getLogForSearch(repoPath, searchByValuesMap, {
                maxCount: args.maxCount,
                showMergeCommits: args.showMergeCommits,
            });

            if (progressCancellation.token.isCancellationRequested) return undefined;

            const goBackCommand: CommandQuickPickItem | undefined =
                args.goBackCommand ||
                new CommandQuickPickItem(
                    {
                        label: `go back ${GlyphChars.ArrowBack}`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to commit search`
                    },
                    Commands.ShowCommitSearch,
                    [uri, originalArgs]
                );

                const pick = await CommitsQuickPick.show(log, searchLabel!, progressCancellation, {
                    goBackCommand: goBackCommand,
                    showAllCommand:
                        log !== undefined && log.truncated
                            ? new CommandQuickPickItem(
                                  {
                                      label: `$(sync) Show All Commits`,
                                      description: `${Strings.pad(GlyphChars.Dash, 2, 3)} this may take a while`
                                  },
                                  Commands.ShowCommitSearch,
                                  [uri, { ...args, maxCount: 0, goBackCommand: goBackCommand }]
                              )
                            : undefined,
                    showInResultsExplorerCommand:
                        log !== undefined ? new ShowCommitsSearchInResultsQuickPickItem(log, searchLabel!) : undefined
                });
                if (pick === undefined) return undefined;

                if (pick instanceof CommandQuickPickItem) return pick.execute();

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'ShowCommitSearchCommand');
            return window.showErrorMessage(`Unable to find commits. See output channel for more details`);
        }
        finally {
            progressCancellation.cancel();
        }
    }
}
