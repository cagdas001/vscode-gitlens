'use strict';
import { CommitSearchBootstrap } from '../ipc';
import { App } from '../shared/app-base';
import { DOM } from './../shared/dom';
const bootstrap: CommitSearchBootstrap = (window as any).bootstrap;

interface ShowDiffPost {
    type: string;
    file: string;
    repoPath: string;
    lsha?: string;
    rsha?: string;
}

interface FileCommitInfo {
    sha: string;
    prevSha?: string;
    nextSha?: string;
    date: Date;
    file: string;
    status: string;
}
interface HtmlTreeNode {
    title: string;
    fullPath: string;
    details: FileCommitInfo[] ;
    children?: HtmlTreeNode[];
    [propName: string]: any;
}
/*
interface HtmlTree {
    [index: number]: HtmlTreeNode;
}
*/
interface TreeData {
    fullPath?: string;
    [propName: string]: any;
}

interface TreeDataArray {
    [index: string]: TreeData;
}

export class CommitSearches extends App<CommitSearchBootstrap> {
    protected searchText: HTMLInputElement | null = null;

    constructor() {
        super('CommitSearches', bootstrap);
    }

    protected onInitialize() {

        const searchText = DOM.getElementById<HTMLInputElement>('searchText');
        this.searchText = searchText;

        const branches = DOM.getElementById<HTMLSelectElement>('branches');
        const selectedCommits = DOM.getElementById<HTMLDivElement>('selected-commits');
        const selectedFiles = DOM.getElementById<HTMLDivElement>('selected-files');
        if (branches && this.bootstrap.branches!.length) {
            this.bootstrap.branches.forEach(branch => {
                const option = document.createElement('option');
                option.value = branch;
                option.innerHTML = branch;
                if (this.bootstrap.branch === branch) {
                    option.selected = true;
                }
                branches.appendChild(option);
            });

            branches.parentElement!.classList.remove('hidden');
        }

        const since = DOM.getElementById<HTMLSelectElement>('since');
        const before = DOM.getElementById<HTMLInputElement>('before');
        before.hidden = true;
        const after = DOM.getElementById<HTMLInputElement>('after');
        after.hidden = true;
        since.onchange = function(this: HTMLElement, ev: Event) {
            const ele = this as HTMLSelectElement;
            const before = DOM.getElementById<HTMLInputElement>('before');
            const after = DOM.getElementById<HTMLInputElement>('after');
            if (ele!.selectedIndex === 1) {
                before.hidden = false;
                after.hidden = false;
            }
            else {
                before.hidden = true;
                after.hidden = true;
            }
            ev.stopPropagation();
        };
        window.addEventListener('message', event => {
            if (event.data.type === 'searchLabel') {
                const searchMessage = DOM.getElementById<HTMLSpanElement>('searchMessage');
                searchMessage.innerText = event.data.searchLabel;
                 return;
            }
            if (event.data.type === 'showDiff') {
                return;
            }

            // delete a previous html tree
            while (selectedFiles.firstChild) {
                selectedFiles.removeChild(selectedFiles.firstChild);
            }

            // delete selected commits
            while (selectedCommits.firstChild) {
                selectedCommits.removeChild(selectedCommits.firstChild);
            }

            // init selected commits list
            if (!selectedCommits.hasChildNodes()) {
                const ul = document.createElement('ul' );
                ul.id = 'selected-commits-list';
                selectedCommits.appendChild(ul);
            }
            const commitedList = document.getElementById('selected-commits-list');

            const selectedFileCommitMap = new Map<string, FileCommitInfo[]>();
            const list = DOM.getElementById<HTMLTableElement>('logs');
            while (list.rows.length !== 0) {
                list.deleteRow(0);
            }
            list.createTBody();
            const dataMsg = event.data.msg as any[];
            dataMsg.forEach((element, rId) => {
                const r1 = list.insertRow();
                const c1 = r1.insertCell();
                c1.innerHTML = `<div class='commit-label'> ${element.label} </div> <div> ${element.description}</div>
                `;

                if (!element.commit) {
                    r1.hidden = true;
                }
                else {
                    const detailsRow = list.insertRow();
                    detailsRow.className = 'details-row';
                    r1.id = `commit-${element.commit.sha}`;
                    const c1 = detailsRow.insertCell();
                    c1.innerHTML = `<span>${element.detail}</span>`;
                    c1.id = `details-${rId}`;
                    detailsRow.hidden = true;

                   // User selects a commit
                    r1.onclick = () => {

                        detailsRow.hidden = !detailsRow.hidden;

                        if (detailsRow.hidden) {
                            const selectCommitRow = document.getElementById(`selected-` + r1.id) as  HTMLElement;
                            selectCommitRow.parentElement!.removeChild(selectCommitRow);

                            // update the list fo selected files
                            const files = element.commit._fileName.split(',') as string[];
                            for (const file of files) {
                                const trimmedFilePath = file!.trim();
                                if (selectedFileCommitMap.has(trimmedFilePath)) {
                                    // delete a commit from the list
                                    const items = selectedFileCommitMap.get(trimmedFilePath!);
                                    selectedFileCommitMap.set(trimmedFilePath, items!.filter(e => e.sha !== element.commit.sha ));
                                    if (selectedFileCommitMap.get(trimmedFilePath)!.length === 0) {
                                        selectedFileCommitMap.delete(trimmedFilePath);
                                    }
                                }
                            }
                        }
                        else {
                            // add a commit to the list of selected commits
                            const selectedCommitRow =  document.createElement('li' );
                            selectedCommitRow.id = `selected-` + r1.id;
                            selectedCommitRow.innerHTML = `<div class='commit-label'> ${element.label} </div> <div>${element.commit._shortSha} ${element.detail}</div>`;
                            commitedList!.appendChild(selectedCommitRow);

                            // get the list of commited files
                            const files = element.commit._fileName.split(',') as string[];
                            for (const file of files) {
                                const trimmedFilePath = file.trim();
                                const status = element.commit.fileStatuses.filter((x: any) => x.fileName as string === trimmedFilePath);
                                const fileCommitInfo = {sha: element.commit.sha,
                                    prevSha: element.commit._previousSha,
                                    nextSha: element.commit.nextSha,
                                    date: new Date(element.commit.date), file: trimmedFilePath,
                                    status: status[0].status};
                                if (selectedFileCommitMap.has(trimmedFilePath)) {
                                    selectedFileCommitMap.get(trimmedFilePath)!.push(fileCommitInfo);
                                }
                                else {
                                    selectedFileCommitMap.set(trimmedFilePath, [fileCommitInfo]);
                                }
                            }
                        }

                         // delete a previous html tree
                         while (selectedFiles.firstChild) {
                            selectedFiles.removeChild(selectedFiles.firstChild);
                        }

                        // build tree data from file path strings
                        const treeData  = CommitSearches.createTreeData(selectedFileCommitMap);
                        const treeArray = CommitSearches.toTreeData(treeData) as HtmlTreeNode[];
                        treeArray.sort(CommitSearches.sortTree);

                        // display tree
                        const treeUl = document.createElement('ul');
                        treeUl.id = 'selected-files-list';
                        treeUl.className = 'tree';
                        selectedFiles.appendChild(treeUl);
                        const rootLi = document.createElement('li');
                        rootLi.className = 'open';
                        const a = document.createElement('a');
                        a.setAttribute('href', '#');
                        a.innerText = `${element.commit.repoPath}`;
                        rootLi.appendChild(a);
                        const ul = document.createElement('ul');
                        rootLi.appendChild(ul);
                        treeUl.appendChild(rootLi);
                        this.displayTreeData(element.commit.repoPath, treeArray, ul);

                        // All nodes are expanded
                        const treeHtml = document.querySelectorAll('ul.tree a:not(:last-child)');
                        for (const treeNode of treeHtml) {
                            treeNode.addEventListener('click', function(e) {
                                const parent  = (event.target as HTMLElement)['parentElement'] as HTMLElement;
                                const classList = parent.classList;
                                if (classList.contains('open')) {
                                    classList.remove('open');
                                    const opensubs = parent!.querySelectorAll(':scope .open');
                                    for (const opensub of  opensubs) {
                                        opensub.classList.remove('open');
                                    }
                                }
                                else {
                                    classList.add('open');
                                }
                            });
                        }
                    };

                    const seperator = list.insertRow();
                    const spCell = seperator.insertCell();
                    spCell.innerHTML = '<div class="seperator"></div>';
                }
            });
        });

        this._api.postMessage({
            type: 'search'
        });
    }

    // Create a file tree from file path strings
    static createTreeData(selectedFileCommitMap: Map<string, FileCommitInfo[]>) {
        const tree: TreeDataArray  = {};
        selectedFileCommitMap.forEach((value, key, map) => {
            let currentNode = tree;
            const paths = key.split('/');
            for (let i = 0; i < paths.length; i++) {
                const  fullPath =  paths.slice(0, i + 1).join('/') ;
                if (currentNode[paths[i]] === undefined) {
                    if ( i === paths.length - 1) {
                        currentNode[paths[i]] = { fullPath: fullPath, details: value};
                    }
                    else {
                        currentNode[paths[i]] = { fullPath: fullPath};
                    }
                }
                currentNode = currentNode[paths[i]];
            }
        });

        return tree;
    }

    // Convert the nested dictionaries into lists of children.
    // Basic algorithm:
    // 1. Each dictionary becomes an array of children.
    // 2. Each element of the array has a title, fullPath, commit details and a list of children.
    // 3. We recurse for the list of children (if we have children).
    static toTreeData(tree: TreeDataArray): HtmlTreeNode [] {
        return Object.keys(tree).map(function(title: string) {
          //  const that  = this as CommitSearches;
            const o = {title:  title} as any;

            if ( Object.keys(tree[title]).length > 0) {
                if (tree[title]['fullPath'] !== undefined ) {
                    o['fullPath'] = tree[title]['fullPath'];
                    delete tree[title]['fullPath'];
                }

                if (tree[title]['details'] !== undefined ) {
                    o['details'] = tree[title]['details'];
                    delete tree[title]['details'];
                }
                if ( Object.keys(tree[title]).length > 0) {
                    const children = CommitSearches.toTreeData(tree[title]) as HtmlTreeNode[];
                    children.sort(CommitSearches.sortTree);
                    o['children'] = children;
                }
            }
            return o;
        }
        // .bind(this)
        );
    }

    // Sort file nodes against folder nodes. Files will be at the end.
    static sortTree(a: HtmlTreeNode, b: HtmlTreeNode) {
        if ((a.children && b.children) || (!a.children && !b.children)) {
            return a.title.localeCompare(b.title);
        }
        return  !a.children ? 1 : -1;
    }

    // Sort commits by date
    private sortCommit(a: FileCommitInfo, b: FileCommitInfo) {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return 0;
     }

    private displayTreeData(repoPath: string, tree: HtmlTreeNode[], selectedFiles: HTMLUListElement) {
        for ( const item of tree) {
            const li = document.createElement('li');
            li.className = 'open';
            const a = document.createElement('a');
            a.setAttribute('href', '#');
            a.className = 'showdiff';
            a.onclick = () => {
                const fileURI = item.fullPath;
                const params: ShowDiffPost = {
                    type: 'showDiff',
                    file: fileURI,
                    repoPath: repoPath,
                    lsha: undefined,
                    rsha: undefined
                };
                // The logic of comparison is based on Intelij Idea
                if (item.details.length === 1) {
                    params.lsha = item.details[0].prevSha;
                    params.rsha = item.details[0].sha;
                }
                else {
                  item.details!.sort(this.sortCommit);
                  params.lsha = item.details![0].prevSha;
                  params.rsha = item.details![item.details!.length - 1 ].sha;
                }
                this._api.postMessage(params);
            };
            a.innerText = `${item.title}`;
            li.appendChild(a);
            selectedFiles.appendChild(li);
            // display files
            if (item.children) {
                const ul = document.createElement('ul');
                li.appendChild(ul);
                this.displayTreeData(repoPath, item.children, ul);
            }
        }
    }

    protected onBind() {
        const that = this;
        DOM.listenAll('.postme', 'click', function(this: HTMLButtonElement) {
            const searchText = DOM.getElementById<HTMLInputElement>('searchText')!.value;
            const author = DOM.getElementById<HTMLInputElement>('author')!.value;
            const before = DOM.getElementById<HTMLInputElement>('before')!.value;
            const after = DOM.getElementById<HTMLInputElement>('after')!.value;
            that._api.postMessage({
                type: 'search',
                search: searchText,
                branch: that.getBranch(),
                author: author,
                since: that.getSince(),
                before: before,
                after: after
            });
        });
   }

    protected getBranch(): string {
        const branches = DOM.getElementById<HTMLSelectElement>('branches');
        return branches!.options![branches!.selectedIndex].value || 'all';
    }

    protected getSince(): string {
        const since = DOM.getElementById<HTMLSelectElement>('since');
        return since!.options![since!.selectedIndex].value;
    }
}