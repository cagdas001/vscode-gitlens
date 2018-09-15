'use strict';
import { CommitSearchBootstrap } from '../ipc';
import { App } from '../shared/app-base';
import { DOM } from './../shared/dom';

const bootstrap: CommitSearchBootstrap = (window as any).bootstrap;

export class CommitSearches extends App<CommitSearchBootstrap> {
    protected searchText: HTMLInputElement | null = null;

    constructor() {
        super('CommitSearches', bootstrap);
    }

    protected onInitialize() {

        const searchText = DOM.getElementById<HTMLInputElement>('searchText');
        this.searchText = searchText;

        const branches = DOM.getElementById<HTMLSelectElement>('branches');
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

                    const c1 = detailsRow.insertCell();
                    c1.innerHTML = `<span>${element.detail}</span>`;
                    c1.id = `details-${rId}`;
                    detailsRow.hidden = true;
                    r1.onclick = () => {
                        detailsRow.hidden = !detailsRow.hidden;
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
