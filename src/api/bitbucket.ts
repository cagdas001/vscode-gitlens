'use strict';
import fetch from 'node-fetch';

const BASE_API = 'https://api.bitbucket.org/2.0';
const CLIENT_KEY = '3zYXa7WgHr5JWsSJg8';
const CLIENT_SECRET = 'bp2VJvLcMN4j7zqnwtarn4x7r6bmnqfG';
export enum CommitCommentType {
    FILE,
    LINE
}

export interface Comment {
    id: number;
    content: {
        raw: string,
        html: string
    };
    user: {
        username: string,
        display_name: string,
        account_id: string
    };
    commit?: {
        hash: string
    };
    inline: {
        to?: number,
        from?: number,
        path?: string
    };
    parent?: {
        id: number;
    };
    deleted: boolean;
    created_on: Date;
    type: string;
    replies?: Comment[];
}

export interface URLParams {
    [key: string]: string;
}

export interface BitbucketResponse {
    [key: string]: any;
}

export class BitbucketAPI {

    static accessToken: string | undefined;

    private repoPath: String;

    constructor(repo: String) {
        this.repoPath = repo;
    }

    login(
        username: string,
        password: string
    ): Thenable<object> {
        const param = {
            username: username,
            password: password,
            grant_type: 'password'
        };
        return fetch(`https://${CLIENT_KEY}:${CLIENT_SECRET}@bitbucket.org/site/oauth2/access_token`, {
            method: 'POST',
            body: this.jsonToXXXForm(param),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
            }).then(res => res.json())
            .catch(error => console.error('Error:', error));
    }

    putCommitComment(
        sha: string,
        file: string,
        content: string,
        type: CommitCommentType,
        line: number = 0
    ): Thenable<object> {
        const data = {
            content: {raw: content},
            inline: {}
        };
        if (type === CommitCommentType.LINE) {
            data.inline = {to: line, path: file};
        }
        else if (type === CommitCommentType.FILE) {
            data.inline = {path: file};
        }
        return this.generateCommitCommentUrl(sha).then(url => {
            return fetch(url, {
                method: 'POST',
                body: JSON.stringify(data),
                headers: {
                  'Content-Type': 'application/json'
                }
              }).then(res => res.json())
              .catch(error => console.error('Error:', error));
        });
    }

    putCommentReply(
        sha: string,
        id: number,
        file: string,
        content: string
    ): Thenable<object> {
        const data = {
            content: {raw: content},
            parent: {id: id},
            inline: {path: file}
        };
        return this.generateCommitCommentUrl(sha).then(url => {
            return fetch(url, {
                method: 'POST',
                body: JSON.stringify(data),
                headers: {
                  'Content-Type': 'application/json'
                }
              }).then(res => res.json())
              .catch(error => console.error('Error:', error));
        });
    }

    deleteComment(
        sha: string,
        id: number
    ): Thenable<object> {
        return this.generateCommitCommentIdUrl(sha, id).then(url => {
            return fetch(url, {
                method: 'DELETE'
              });
        });
    }

    getCommitComment(
        sha: string
    ): Thenable<{values: [Comment]}> {
        return this.generateCommitCommentUrl(sha).then(url => {
            return fetch(url).then(res => res.json())
            .catch(error => console.error('Error:', error));
        });
    }

    getNextCommitComment(
        url: string
    ): Thenable<{values: [Comment]}> {
        return this.generateCommitCommentUrl(url).then(url => {
            return fetch(url).then(res => res.json())
            .catch(error => console.error('Error:', error));
        });
    }

    private async generateCommitCommentUrl(sha: string): Promise<string> {
        return `${await this.getRepoPath()}/commit/${sha}/comments/?access_token=${this.getAccessToken()}`;
    }

    private async generateCommitCommentIdUrl(sha: string, id: number): Promise<string> {
        return `${await this.getRepoPath()}/commit/${sha}/comments/${id}?access_token=${this.getAccessToken()}`;
    }

    private async getRepoPath(): Promise<string> {
        return `${BASE_API}/repositories/${this.repoPath}`;
    }

    private getAccessToken(): string {
        return BitbucketAPI.accessToken ? BitbucketAPI.accessToken : '';
    }

    private jsonToXXXForm(obj: URLParams) {
        const str = [];
        for (const key in obj) {
             if (obj.hasOwnProperty(key)) {
                   str.push(`${encodeURIComponent(key)}=${encodeURIComponent(obj[key])}`);
             }
        }
        return str.join('&');
    }

    static isLoggedIn() {
        return BitbucketAPI.accessToken ? true : false;
    }
}
