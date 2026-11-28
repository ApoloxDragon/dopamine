import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { IMock, It, Mock } from 'typemoq';
import { DialogService } from './dialog.service';
import { InputData } from './input-data';
import { PlaylistModelFactory } from '../playlist/playlist-model-factory';
import { TranslatorServiceBase } from '../translator/translator.service.base';
import { InputDialogComponent } from '../../ui/components/dialogs/input-dialog/input-dialog.component';
import { SleepTimerComponent } from '../../ui/components/sleep-timer/sleep-timer.component';
import { AddFolderComponent } from '../../ui/components/add-folder/add-folder.component';
import { NetworkDrivesService } from '../network-drives/network-drives.service';
import { SettingsMock } from '../../testing/settings-mock';
import { Logger } from '../../common/logger';
import { DialogServiceBase } from './dialog.service.base';
import { FolderModel } from '../folder/folder-model';

// "A tester walks into a bar": text dialogs (Cancel, empty answers) and the nickname dialog, tried every odd way.
describe('Text dialogs: trying to break them', () => {
    describe('DialogService: only OK gives the text back', () => {
        let open: (component: unknown, config: { data: InputData }) => unknown;
        let service: DialogService;

        // The user types `typed`, then the dialog closes with `result`. (A plain fake: typemoq copies the arguments,
        // so typing into its copy would never reach the service.)
        const dialogThatCloses = (typed: unknown, result: unknown): void => {
            open = (_, config) => {
                config.data.inputText = typed as string;
                return { afterClosed: () => of(result) };
            };
        };

        beforeEach(() => {
            const matDialog = {
                open: (component: unknown, config: { data: InputData }): unknown => open(component, config),
            } as unknown as MatDialog;
            service = new DialogService(matDialog, Mock.ofType<PlaylistModelFactory>().object, Mock.ofType<TranslatorServiceBase>().object);
        });

        it('the regular customer: types a name and presses OK', async () => {
            dialogThatCloses('Home server', true);

            expect(await service.showInputDialogAsync('t', 'p', '', [])).toBe('Home server');
            expect(await service.showInputDialogOrCancelAsync('t', 'p', '', [])).toBe('Home server');
        });

        it.each([[false], [undefined], [null], ['true'], [1], [{}], [[]]])(
            'should treat a dialog closed with %p as Cancel, even after typing',
            async (result) => {
                dialogThatCloses('typed but cancelled', result);

                expect(await service.showInputDialogAsync('t', 'p', 'old', [])).toBe('');
                expect(await service.showInputDialogOrCancelAsync('t', 'p', 'old', [])).toBeUndefined();
            },
        );

        it('should give an empty answer (not Cancel) when OK is pressed on an empty field that allows it', async () => {
            dialogThatCloses('', true);

            expect(await service.showInputDialogOrCancelAsync('t', 'p', 'old', [], '', 'las la-pen', true)).toBe('');
        });

        it.each([[undefined], [null]])('should give "" when the text field ends up %p after OK', async (typed) => {
            dialogThatCloses(typed, true);

            expect(await service.showInputDialogOrCancelAsync('t', 'p', '', [])).toBe('');
        });

        it('should hand weird text back untouched (callers clean it)', async () => {
            const weird = '<img src=x onerror=alert(1)>\u0000‮🦎'.repeat(1000);
            dialogThatCloses(weird, true);

            expect(await service.showInputDialogAsync('t', 'p', '', [])).toBe(weird);
        });

        it('should pass the error on when the dialog itself fails (callers decide)', async () => {
            open = (): unknown => ({ afterClosed: () => throwError(new Error('boom')) });

            await expect(service.showInputDialogAsync('t', 'p', '', [])).rejects.toThrow('boom');
        });
    });

    describe('InputDialogComponent: when OK can be pressed', () => {
        const component = (inputText: unknown, allowEmpty: unknown): InputDialogComponent =>
            new InputDialogComponent({ inputText, allowEmpty } as unknown as InputData, Mock.ofType<never>().object);

        it.each([
            ['text', 'a', false, true],
            ['empty', '', false, false],
            ['spaces', '   \t\n', false, false],
            ['undefined', undefined, false, false],
            ['null', null, false, false],
            ['empty, allowed', '', true, true],
            ['spaces, allowed', '  ', true, true],
            ['empty, allowEmpty "yes" (not a real true)', '', 'yes', false],
            ['empty, allowEmpty 1', '', 1, false],
            ['empty, allowEmpty undefined', '', undefined, false],
        ])('%s', (_, inputText, allowEmpty, expected) => {
            expect(component(inputText, allowEmpty).canConfirm).toBe(expected);
        });
    });

    describe('Sleep timer: what Cancel and odd text start', () => {
        it.each([
            ['', 0],
            ['   ', 0],
            ['-5', 0],
            ['0', 0],
            ['1e9', 0],
            ['NaN', 0],
            ['20abc', 0],
            ['0x10', 0],
            ['٢٠', 0],
            ['99999', 0],
            ['20', 20],
            [' 45 min ', 45],
            ['1:30', 90],
            ['2h', 0],
        ])('"%s" gives %p minutes', (typed, minutes) => {
            expect(SleepTimerComponent.parseMinutes(typed)).toBe(minutes);
        });

        it('should start nothing for a cancelled dialog (undefined)', () => {
            expect(SleepTimerComponent.parseMinutes(undefined)).toBe(0);
        });
    });

    describe('Nickname dialog (Settings, Collection)', () => {
        const share = '/run/user/1000/gvfs/smb-share:server=192.168.10.183,share=storage';
        let settings: SettingsMock;
        let drives: NetworkDrivesService;
        let dialogServiceMock: IMock<DialogServiceBase>;
        let component: AddFolderComponent;

        const folder = (path: string): FolderModel => ({ path }) as unknown as FolderModel;
        const answer = (value: Promise<string | undefined>): void => {
            dialogServiceMock.reset();
            dialogServiceMock
                .setup((x) =>
                    x.showInputDialogOrCancelAsync(It.isAny(), It.isAny(), It.isAny(), It.isAny(), It.isAny(), It.isAny(), It.isAny()),
                )
                .returns(() => value);
        };

        beforeEach(() => {
            settings = new SettingsMock();
            settings.networkDriveNicknames = '{}';
            const loggerMock = Mock.ofType<Logger>();
            drives = new NetworkDrivesService(settings, loggerMock.object);
            dialogServiceMock = Mock.ofType<DialogServiceBase>();
            const translatorMock = Mock.ofType<TranslatorServiceBase>();
            translatorMock.setup((x) => x.get(It.isAny())).returns((k: string) => k);
            component = new AddFolderComponent(
                Mock.ofType<never>().object,
                translatorMock.object,
                Mock.ofType<never>().object,
                dialogServiceMock.object,
                Mock.ofType<never>().object,
                settings,
                loggerMock.object,
                undefined,
                drives,
            );
            drives.nicknames.set(share, 'Home server');
        });

        it('the regular customer: renames the share', async () => {
            answer(Promise.resolve('NAS'));

            await component.setNicknameAsync(folder(`${share}/music`));

            expect(component.displayNameOf(`${share}/music`)).toBe('NAS › music');
        });

        it('should keep the nickname on Cancel', async () => {
            answer(Promise.resolve(undefined));

            await component.setNicknameAsync(folder(`${share}/music`));

            expect(drives.nicknames.get(share)).toBe('Home server');
        });

        it('should remove the nickname when saved empty (or only spaces)', async () => {
            answer(Promise.resolve('   '));

            await component.setNicknameAsync(folder(`${share}/music`));

            expect(drives.nicknames.get(share)).toBeUndefined();
            expect(component.displayNameOf(`${share}/music`)).toBe(`${share}/music`);
        });

        it('should not ask, nor change anything, for a local folder', async () => {
            answer(Promise.resolve('Nope'));

            await component.setNicknameAsync(folder('/home/apolox/Music'));

            expect(component.canHaveNickname('/home/apolox/Music')).toBe(false);
            expect(settings.networkDriveNicknames).not.toContain('Nope');
        });

        it('should keep the nickname, and not throw, when the dialog fails', async () => {
            answer(Promise.reject(new Error('no window')));

            await expect(component.setNicknameAsync(folder(`${share}/music`))).resolves.toBeUndefined();
            expect(drives.nicknames.get(share)).toBe('Home server');
        });

        it('should clean odd nicknames, and show HTML as plain text (Angular escapes it)', async () => {
            answer(Promise.resolve('‮<b>NAS</b>\u0000' + 'x'.repeat(500)));

            await component.setNicknameAsync(folder(`${share}/music`));

            const name = drives.nicknames.get(share)!;
            expect(name.startsWith('<b>NAS</b>')).toBe(true);
            expect(name.length).toBeLessThanOrEqual(60);
        });

        it('should work without the network drives service (older callers)', () => {
            const bare = new AddFolderComponent(
                Mock.ofType<never>().object,
                Mock.ofType<never>().object,
                Mock.ofType<never>().object,
                dialogServiceMock.object,
                Mock.ofType<never>().object,
                settings,
                Mock.ofType<Logger>().object,
            );

            expect(bare.displayNameOf(share)).toBe(share);
            expect(bare.canHaveNickname(share)).toBe(false);
        });
    });
});
