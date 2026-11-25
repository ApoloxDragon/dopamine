import { IMock, Mock, Times } from 'typemoq';
import { SettingsComponent } from './settings.component';
import { AppearanceServiceBase } from '../../../services/appearance/appearance.service.base';
import { NavigationServiceBase } from '../../../services/navigation/navigation.service.base';
import { DialogServiceBase } from '../../../services/dialog/dialog.service.base';
import { SettingsJump, SettingsSearchResult } from './settings-search/settings-search';
import { SettingsSearchEntry } from './settings-search/settings-search-index';

describe('SettingsComponent', () => {
    let appearanceServiceMock: IMock<AppearanceServiceBase>;
    let navigationServiceMock: IMock<NavigationServiceBase>;
    let dialogServiceMock: IMock<DialogServiceBase>;

    let component: SettingsComponent;

    const result = (place: SettingsSearchEntry['place'], page: number, sectionKey: string): SettingsSearchResult => ({
        entry: { place, page, sectionKey, labelKeys: [], words: [] },
        title: sectionKey,
        where: '',
        detail: '',
    });

    beforeEach(() => {
        appearanceServiceMock = Mock.ofType<AppearanceServiceBase>();
        navigationServiceMock = Mock.ofType<NavigationServiceBase>();
        dialogServiceMock = Mock.ofType<DialogServiceBase>();

        component = new SettingsComponent(appearanceServiceMock.object, navigationServiceMock.object, dialogServiceMock.object);
        SettingsJump.take();
    });

    describe('constructor', () => {
        it('should create', () => {
            expect(component).toBeDefined();
        });

        it('should define appearanceService', () => {
            expect(component.appearanceService).toBeDefined();
        });
    });

    describe('goToAsync', () => {
        it('should open the page of a settings section and scroll to it', async () => {
            document.body.innerHTML = '<div class="title" data-settings-section="crossfade">Crossfade</div>';
            const element = document.querySelector('[data-settings-section="crossfade"]')!;
            element.scrollIntoView = jest.fn();

            await component.goToAsync(result('settings', 1, 'crossfade'));

            expect(component.page).toBe(1);
            expect(element.scrollIntoView).toHaveBeenCalled();
            expect(element.classList.contains('settings-search-found')).toBe(true);
        });

        it('should not slide the page in again when the section is on the open page', async () => {
            component.setPage(1);
            const previous = component.previousPage;

            await component.goToAsync(result('settings', 1, 'crossfade'));

            expect(component.previousPage).toBe(previous);
        });

        it('should go to Manage collection and leave the page and section for it', async () => {
            await component.goToAsync(result('manage-collection', 0, 'folders'));

            navigationServiceMock.verify((x) => x.navigateToManageCollectionAsync(), Times.once());
            expect(SettingsJump.take()).toEqual({ page: 0, sectionKey: 'folders' });
            expect(SettingsJump.take()).toBeUndefined();
        });

        it('should open the equalizer', async () => {
            await component.goToAsync(result('equalizer', 0, 'equalizer'));

            dialogServiceMock.verify((x) => x.showEqualizerDialogAsync(), Times.once());
            expect(component.page).toBe(0);
        });

        it('should do nothing with nothing', async () => {
            await component.goToAsync(undefined as unknown as SettingsSearchResult);

            expect(component.page).toBe(0);
            navigationServiceMock.verify((x) => x.navigateToManageCollectionAsync(), Times.never());
        });
    });
});
