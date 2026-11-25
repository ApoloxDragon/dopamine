import { IMock, Mock } from 'typemoq';
import { ManageCollectionComponent } from './manage-collection.component';
import { AppearanceServiceBase } from '../../../services/appearance/appearance.service.base';
import { SettingsJump } from '../settings/settings-search/settings-search';

describe('ManageRefreshComponent', () => {
    let appearanceServiceMock: IMock<AppearanceServiceBase>;

    let component: ManageCollectionComponent;

    beforeEach(() => {
        appearanceServiceMock = Mock.ofType<AppearanceServiceBase>();

        component = new ManageCollectionComponent(appearanceServiceMock.object);
    });

    describe('constructor', () => {
        it('should create', () => {
            // Arrange

            // Act

            // Assert
            expect(component).toBeDefined();
        });

        it('should define appearanceService', () => {
            // Arrange

            // Act

            // Assert
            expect(component.appearanceService).toBeDefined();
        });
    });

    describe('ngOnInit', () => {
        it('should open the page the settings search asked for, once', () => {
            SettingsJump.request(2, 'grouping');

            component.ngOnInit();

            expect(component.page).toBe(2);
            expect(SettingsJump.take()).toBeUndefined();
        });

        it('should open the first page when nothing was asked', () => {
            SettingsJump.take();

            component.ngOnInit();

            expect(component.page).toBe(0);
        });
    });
});
