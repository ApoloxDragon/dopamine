import { Component, ElementRef, EventEmitter, HostListener, Output, ViewChild, ViewEncapsulation } from '@angular/core';
import { TranslatorServiceBase } from '../../../../services/translator/translator.service.base';
import { SettingsSearch, SettingsSearchResult } from './settings-search';

@Component({
    selector: 'app-settings-search',
    templateUrl: './settings-search.component.html',
    styleUrls: ['./settings-search.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class SettingsSearchComponent {
    private readonly search: SettingsSearch;
    private _query: string = '';

    @ViewChild('settingsSearchInput') public input: ElementRef<HTMLInputElement> | undefined;
    @Output() public chosen: EventEmitter<SettingsSearchResult> = new EventEmitter<SettingsSearchResult>();

    public results: SettingsSearchResult[] = [];
    public selectedIndex: number = 0;
    public isOpen: boolean = false;

    public constructor(
        private translatorService: TranslatorServiceBase,
        private elementRef: ElementRef<HTMLElement>,
    ) {
        this.search = new SettingsSearch((key) => this.translatorService.get(key), process.platform);
    }

    public get query(): string {
        return this._query;
    }

    public set query(value: string) {
        this._query = value ?? '';
        this.results = this.search.search(this._query);
        this.selectedIndex = 0;
        this.isOpen = this._query.trim().length > 0;
    }

    public get hasQuery(): boolean {
        return this._query.length > 0;
    }

    public onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'ArrowDown' && this.results.length > 0) {
            this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
            event.preventDefault();
        } else if (event.key === 'ArrowUp' && this.results.length > 0) {
            this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
            event.preventDefault();
        } else if (event.key === 'Enter') {
            this.choose(this.results[this.selectedIndex]);
            event.preventDefault();
        } else if (event.key === 'Escape') {
            if (this.hasQuery) {
                this.clear();
                event.stopPropagation();
            }
        }
    }

    public choose(result: SettingsSearchResult | undefined): void {
        if (result === undefined) {
            return;
        }

        this.isOpen = false;
        this.chosen.emit(result);
    }

    public clear(): void {
        this.query = '';
        this.input?.nativeElement?.focus();
    }

    public open(): void {
        this.isOpen = this._query.trim().length > 0;
    }

    @HostListener('document:mousedown', ['$event'])
    public onDocumentMouseDown(event: MouseEvent): void {
        if (!this.elementRef.nativeElement.contains(event.target as Node)) {
            this.isOpen = false;
        }
    }
}
