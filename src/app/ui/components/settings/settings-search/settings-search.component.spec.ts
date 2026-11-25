import { ElementRef } from '@angular/core';
import { IMock, It, Mock } from 'typemoq';
import { TranslatorServiceBase } from '../../../../services/translator/translator.service.base';
import { SettingsSearchComponent } from './settings-search.component';
import { SettingsSearchResult } from './settings-search';

describe('SettingsSearchComponent', () => {
    let translatorServiceMock: IMock<TranslatorServiceBase>;
    let host: HTMLElement;
    let component: SettingsSearchComponent;
    let chosen: SettingsSearchResult[];

    const key = (name: string): KeyboardEvent => new KeyboardEvent('keydown', { key: name, cancelable: true });

    beforeEach(() => {
        translatorServiceMock = Mock.ofType<TranslatorServiceBase>();
        translatorServiceMock.setup((x) => x.get(It.isAnyString())).returns((k: string) => k);
        host = document.createElement('div');
        component = new SettingsSearchComponent(translatorServiceMock.object, new ElementRef(host));
        chosen = [];
        component.chosen.subscribe((x) => chosen.push(x));
    });

    it('the regular customer: type, press Enter, land on the setting', () => {
        component.query = 'crossfade';
        component.onKeyDown(key('Enter'));

        expect(chosen.map((x) => x.entry.sectionKey)).toEqual(['crossfade']);
        expect(component.isOpen).toBe(false);
    });

    it('should show the list while typing and hide it when empty', () => {
        component.query = 'fade';
        expect(component.isOpen).toBe(true);
        expect(component.results.length).toBeGreaterThan(0);

        component.query = '  ';
        expect(component.isOpen).toBe(false);
    });

    it('should move through the results with the arrow keys, going round', () => {
        component.query = 'fade';
        const count = component.results.length;

        component.onKeyDown(key('ArrowUp'));
        expect(component.selectedIndex).toBe(count - 1);
        component.onKeyDown(key('ArrowDown'));
        expect(component.selectedIndex).toBe(0);
    });

    it('should start at the best result again after more typing', () => {
        component.query = 'fade';
        component.onKeyDown(key('ArrowDown'));

        component.query = 'fade on';

        expect(component.selectedIndex).toBe(0);
    });

    it('should clear on Escape and keep Escape from closing anything else, then let it through when empty', () => {
        component.query = 'fade';
        const first = key('Escape');
        jest.spyOn(first, 'stopPropagation');
        component.onKeyDown(first);

        expect(component.query).toBe('');
        expect(first.stopPropagation).toHaveBeenCalled();

        const second = key('Escape');
        jest.spyOn(second, 'stopPropagation');
        component.onKeyDown(second);
        expect(second.stopPropagation).not.toHaveBeenCalled();
    });

    // Trying to break it.

    it('should do nothing on Enter or arrows when nothing is found', () => {
        component.query = 'zzqxj';

        component.onKeyDown(key('ArrowDown'));
        component.onKeyDown(key('Enter'));

        expect(component.selectedIndex).toBe(0);
        expect(chosen).toEqual([]);
        expect(component.isOpen).toBe(true);
    });

    it('should survive a null query', () => {
        component.query = null as unknown as string;

        expect(component.query).toBe('');
        expect(component.results).toEqual([]);
    });

    it('should close when clicking outside, not inside', () => {
        component.query = 'fade';
        const inside = document.createElement('span');
        host.appendChild(inside);

        component.onDocumentMouseDown({ target: inside } as unknown as MouseEvent);
        expect(component.isOpen).toBe(true);

        component.onDocumentMouseDown({ target: document.body } as unknown as MouseEvent);
        expect(component.isOpen).toBe(false);

        component.open();
        expect(component.isOpen).toBe(true);
    });
});
