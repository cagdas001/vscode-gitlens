'use strict';
import { IConfig } from './config';

export interface Bootstrap {
    config: IConfig;
}

export interface SettingsBootstrap extends Bootstrap {
    scope: 'user' | 'workspace';
    scopes: ['user' | 'workspace', string][];
}

export interface WelcomeBootstrap extends Bootstrap {}

export interface CommitSearchBootstrap extends Bootstrap {
    branches: string[];
    branch: string;
    stashes: any[];
    rootPath: string;
}

export interface SaveSettingsMessage {
    type: 'saveSettings';
    changes: {
        [key: string]: any;
    };
    removes: string[];
    scope: 'user' | 'workspace';
    uri: string;
}

export interface SearchRepoMessage {
    type: 'search';
    searchText: string;
    branch: string;
    author: string;
    since: string;
    before: Date | undefined;
    after: Date | undefined;
}

export interface SettingsChangedMessage {
    type: 'settingsChanged';
    config: IConfig;
}

export interface ShowDiffMessage {
    type: 'showDiff';
    repoPath: string;
    lsha: string;
    rsha: string;
    file: string;
    showIndex: number;
}

export interface SaveDiffMessages {
    type: 'saveDiffs';
    diffs: ShowDiffMessage[];
}

export interface ShowQuickStashList {
    type: 'listStashes';
}

export type Message = SaveSettingsMessage | SettingsChangedMessage | SearchRepoMessage| ShowDiffMessage | SaveDiffMessages | ShowQuickStashList;
