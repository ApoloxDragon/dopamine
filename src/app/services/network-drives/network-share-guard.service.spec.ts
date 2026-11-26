import { IMock, It, Mock, Times } from 'typemoq';
import { NetworkShareGuardService } from './network-share-guard.service';
import { NetworkDrives, NetworkDrivesFileSystem } from '../../common/io/network-drives';
import { FolderRepositoryBase } from '../../data/repositories/folder-repository.base';
import { PathRelocationRepositoryBase } from '../../data/repositories/path-relocation-repository.base';
import { DialogServiceBase } from '../dialog/dialog.service.base';
import { TranslatorServiceBase } from '../translator/translator.service.base';
import { SettingsMock } from '../../testing/settings-mock';
import { Logger } from '../../common/logger';
import { Folder } from '../../data/entities/folder';

describe('NetworkShareGuardService', () => {
    const gvfs = '/run/user/1000/gvfs';
    const guest = `${gvfs}/smb-share:server=192.168.10.183,share=storage`;
    const withUser = `${gvfs}/smb-share:server=192.168.10.183,share=storage,user=apolox`;
    const song = `${guest}/music/Band/01 Song.flac`;

    let folderRepositoryMock: IMock<FolderRepositoryBase>;
    let relocationMock: IMock<PathRelocationRepositoryBase>;
    let dialogServiceMock: IMock<DialogServiceBase>;
    let translatorServiceMock: IMock<TranslatorServiceBase>;
    let loggerMock: IMock<Logger>;
    let settings: SettingsMock;
    let mounted: string[];
    let existing: Set<string>;
    let gioCalls: string[][];
    let clock: number;

    const folder = (path: string): Folder => ({ path }) as unknown as Folder;

    function create(folders: string[] = [`${guest}/music`, '/home/apolox/Music']): NetworkShareGuardService {
        folderRepositoryMock.setup((x) => x.getFolders()).returns(() => folders.map(folder));
        const service = new NetworkShareGuardService(
            folderRepositoryMock.object,
            relocationMock.object,
            dialogServiceMock.object,
            translatorServiceMock.object,
            settings,
            loggerMock.object,
        );
        const fileSystem: NetworkDrivesFileSystem = {
            readFileSync: (): string => '',
            readdirSync: (path: string): string[] => {
                if (path === gvfs) {
                    return mounted.map((x) => x.slice(gvfs.length + 1));
                }
                throw new Error('ENOENT');
            },
            existsSync: (path: string): boolean => existing.has(path) || (path === gvfs && mounted.length >= 0),
        };
        service.drives = new NetworkDrives(fileSystem, 1000, 'linux');
        service.exists = (path: string): boolean => existing.has(path);
        service.platform = 'linux';
        service.now = (): number => clock;
        service.runGio = (args: string[]): Promise<string | undefined> => {
            gioCalls.push(args);
            return Promise.resolve(undefined);
        };
        return service;
    }

    beforeEach(() => {
        folderRepositoryMock = Mock.ofType<FolderRepositoryBase>();
        relocationMock = Mock.ofType<PathRelocationRepositoryBase>();
        relocationMock.setup((x) => x.relocate(It.isAny(), It.isAny())).returns(() => 12);
        dialogServiceMock = Mock.ofType<DialogServiceBase>();
        translatorServiceMock = Mock.ofType<TranslatorServiceBase>();
        translatorServiceMock.setup((x) => x.get(It.isAny(), It.isAny())).returns((key: string) => key);
        loggerMock = Mock.ofType<Logger>();
        settings = new SettingsMock();
        settings.reconnectNetworkDrives = false;
        mounted = [];
        existing = new Set<string>(['/home/apolox/Music']);
        gioCalls = [];
        clock = 1000000;
    });

    describe('relocateMovedShares (at startup)', () => {
        it('the regular customer: the share was opened with a user name, so its folder moves there', () => {
            mounted = [withUser];
            existing.add(`${withUser}/music`);

            expect(create().relocateMovedShares()).toEqual([{ from: guest, to: withUser }]);
            relocationMock.verify((x) => x.relocate(guest, withUser), Times.once());
        });

        it('should move a share once even with several music folders on it', () => {
            mounted = [withUser];
            existing.add(`${withUser}/music`).add(`${withUser}/more`);

            create([`${guest}/music`, `${guest}/more`]).relocateMovedShares();

            relocationMock.verify((x) => x.relocate(It.isAny(), It.isAny()), Times.once());
        });

        it('should change nothing when the folders are there, and log what is there when a share is missing', () => {
            mounted = [];

            expect(create().relocateMovedShares()).toEqual([]);
            relocationMock.verify((x) => x.relocate(It.isAny(), It.isAny()), Times.never());
            loggerMock.verify(
                (x) =>
                    x.warn(
                        It.is((m: string) => m.includes('is empty')),
                        It.isAny(),
                        It.isAny(),
                    ),
                Times.once(),
            );
        });

        it('should not count a move that the database refused (new place already a music folder)', () => {
            mounted = [withUser];
            existing.add(`${withUser}/music`);
            relocationMock.reset();
            relocationMock.setup((x) => x.relocate(It.isAny(), It.isAny())).returns(() => undefined);

            expect(create().relocateMovedShares()).toEqual([]);
        });

        it('should survive the database failing', () => {
            folderRepositoryMock = Mock.ofType<FolderRepositoryBase>();
            const service = create();
            folderRepositoryMock.reset();
            folderRepositoryMock.setup((x) => x.getFolders()).throws(new Error('database is locked'));

            expect(service.relocateMovedShares()).toEqual([]);
        });
    });

    describe('reconnectMissingSharesAsync (at startup)', () => {
        it('should do nothing unless turned on', async () => {
            await create().reconnectMissingSharesAsync();

            expect(gioCalls).toEqual([]);
        });

        it('should connect the share as before (as a guest, or with the same user), once per share', async () => {
            settings.reconnectNetworkDrives = true;

            await create([`${guest}/music`, `${guest}/more`, `${withUser}/x`]).reconnectMissingSharesAsync();

            expect(gioCalls).toEqual([
                ['mount', '--anonymous', 'smb://192.168.10.183/storage'],
                ['mount', 'smb://apolox@192.168.10.183/storage'],
            ]);
        });
    });

    describe('tryToReachAsync (when a song on a share is played)', () => {
        it('should find the share under its new name without asking', async () => {
            mounted = [withUser];
            existing.add(`${withUser}/music/Band/01 Song.flac`);

            expect(await create().tryToReachAsync(song)).toEqual({ reachable: true, move: { from: guest, to: withUser } });
            dialogServiceMock.verify((x) => x.showConfirmationDialogAsync(It.isAny(), It.isAny()), Times.never());
        });

        it('should ask before connecting, and connect when the user says yes', async () => {
            dialogServiceMock.setup((x) => x.showConfirmationDialogAsync(It.isAny(), It.isAny())).returns(() => Promise.resolve(true));
            const service = create();
            service.runGio = (args: string[]): Promise<string | undefined> => {
                gioCalls.push(args);
                existing.add(song);
                return Promise.resolve(undefined);
            };

            expect(await service.tryToReachAsync(song)).toEqual({ reachable: true });
            expect(gioCalls).toEqual([['mount', '--anonymous', 'smb://192.168.10.183/storage']]);
        });

        it('should connect without asking when "Reconnect network drives" is on', async () => {
            settings.reconnectNetworkDrives = true;

            await create().tryToReachAsync(song);

            dialogServiceMock.verify((x) => x.showConfirmationDialogAsync(It.isAny(), It.isAny()), Times.never());
            expect(gioCalls.length).toBe(1);
        });

        it('should not connect when the user says no, and not ask again for the next songs for a while', async () => {
            dialogServiceMock.setup((x) => x.showConfirmationDialogAsync(It.isAny(), It.isAny())).returns(() => Promise.resolve(false));
            const service = create();

            expect(await service.tryToReachAsync(song)).toEqual({ reachable: false });
            expect(await service.tryToReachAsync(`${guest}/music/Band/02 Other.flac`)).toEqual({ reachable: false });

            dialogServiceMock.verify((x) => x.showConfirmationDialogAsync(It.isAny(), It.isAny()), Times.once());
            expect(gioCalls).toEqual([]);

            clock += NetworkShareGuardService.retryAfterMs;
            await service.tryToReachAsync(song);
            dialogServiceMock.verify((x) => x.showConfirmationDialogAsync(It.isAny(), It.isAny()), Times.exactly(2));
        });

        // Trying to break it.

        it('should say not reachable, and log why, when connecting fails', async () => {
            settings.reconnectNetworkDrives = true;
            const service = create();
            service.runGio = (): Promise<string | undefined> =>
                Promise.resolve('gio: smb://192.168.10.183/storage: Failed to mount: Connection refused');

            expect(await service.tryToReachAsync(song)).toEqual({ reachable: false });
            loggerMock.verify(
                (x) =>
                    x.warn(
                        It.is((m: string) => m.includes('Connection refused')),
                        It.isAny(),
                        It.isAny(),
                    ),
                Times.once(),
            );
        });

        it.each([['/home/apolox/Music/a.flac'], ['/mnt/storage/a.flac'], [''], [undefined as unknown as string]])(
            'should do nothing for a song that is not on a desktop share (%p)',
            async (path) => {
                expect(await create().tryToReachAsync(path)).toEqual({ reachable: false });
                expect(gioCalls).toEqual([]);
            },
        );

        it('should do nothing on Windows and macOS', async () => {
            settings.reconnectNetworkDrives = true;
            const service = create();
            service.platform = 'win32';

            expect(await service.tryToReachAsync(song)).toEqual({ reachable: false });
            expect(gioCalls).toEqual([]);
        });

        it('should never throw, even when the dialog does', async () => {
            dialogServiceMock
                .setup((x) => x.showConfirmationDialogAsync(It.isAny(), It.isAny()))
                .returns(() => Promise.reject(new Error('no window')));

            expect(await create().tryToReachAsync(song)).toEqual({ reachable: false });
        });

        it('should pass a share name with odd characters to gio as one argument, never through a shell', async () => {
            settings.reconnectNetworkDrives = true;
            const odd = `${gvfs}/smb-share:server=nas,share=a%20b%3B%20rm%20-rf%20~`;

            await create([`${odd}/music`]).tryToReachAsync(`${odd}/music/x.flac`);

            expect(gioCalls).toEqual([['mount', '--anonymous', 'smb://nas/a%20b%3B%20rm%20-rf%20~']]);
        });
    });
});
