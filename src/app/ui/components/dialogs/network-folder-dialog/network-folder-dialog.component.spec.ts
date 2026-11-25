import { NetworkFolderDialogComponent } from './network-folder-dialog.component';

describe('NetworkFolderDialogComponent', () => {
    function create(
        options: { allowed?: boolean; drives?: any[]; resolve?: string; connect?: string; confirm?: boolean; picked?: string } = {},
    ) {
        let allowed: boolean = options.allowed ?? false;
        const networkDrives: any = {
            get isAllowed(): boolean {
                return allowed;
            },
            allow: jest.fn(() => (allowed = true)),
            canConnectShares: true,
            find: jest.fn(() => (allowed ? (options.drives ?? []) : [])),
            resolveSmbUrl: jest.fn(() => options.resolve),
            connectAsGuestAsync: jest.fn(async () => options.connect),
        };
        const desktop: any = { showSelectFolderDialogAsync: jest.fn(async () => options.picked ?? '') };
        const translator: any = { getAsync: jest.fn(async (key: string) => key) };
        const dialogs: any = { showConfirmationDialogAsync: jest.fn(async () => options.confirm ?? false) };
        const dialogRef: any = { close: jest.fn() };
        const component = new NetworkFolderDialogComponent(networkDrives, desktop, translator, dialogs, dialogRef);
        component.ngOnInit();
        return { component, networkDrives, desktop, dialogs, dialogRef };
    }

    it('should not look for drives until the user allows it', () => {
        const { component, networkDrives } = create({
            drives: [{ label: 'storage on nas', kind: 'samba', path: '/run/user/1000/gvfs/x' }],
        });
        expect(component.drives).toEqual([]);

        component.allow();

        expect(networkDrives.allow).toHaveBeenCalled();
        expect(component.drives.length).toBe(1);
    });

    it('should open the folder picker inside a drive and return the chosen folder', async () => {
        const drive = { label: 'storage on nas', kind: 'samba', path: '/run/user/1000/gvfs/x' };
        const { component, desktop, dialogRef } = create({ allowed: true, drives: [drive], picked: '/run/user/1000/gvfs/x/music' });

        await component.pickInAsync(drive as any);

        expect(desktop.showSelectFolderDialogAsync).toHaveBeenCalledWith('select-folder', drive.path);
        expect(dialogRef.close).toHaveBeenCalledWith('/run/user/1000/gvfs/x/music');
    });

    it('should keep the window open when the picker is cancelled', async () => {
        const { component, dialogRef } = create({ allowed: true, picked: '' });

        await component.pickInAsync({ label: 'x', kind: 'samba', path: '/x' });

        expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should use a typed path as it is', async () => {
        const { component, dialogRef } = create();
        component.typed = '/mnt/music/';

        await component.useTypedAsync();

        expect(dialogRef.close).toHaveBeenCalledWith('/mnt/music');
    });

    it('should turn an smb:// address of a connected share into its folder, without connecting anything', async () => {
        const { component, networkDrives, dialogRef } = create({ resolve: '/run/user/1000/gvfs/smb-share:server=nas,share=storage/music' });
        component.typed = 'smb://nas/storage/music';

        await component.useTypedAsync();

        expect(networkDrives.connectAsGuestAsync).not.toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalledWith('/run/user/1000/gvfs/smb-share:server=nas,share=storage/music');
    });

    it('should ask before connecting a share, and do nothing when the answer is no', async () => {
        const { component, networkDrives, dialogs, dialogRef } = create({ confirm: false });
        component.typed = 'smb://nas/storage/music';

        await component.useTypedAsync();

        expect(dialogs.showConfirmationDialogAsync).toHaveBeenCalled();
        expect(networkDrives.connectAsGuestAsync).not.toHaveBeenCalled();
        expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should connect as a guest when allowed, and explain when that fails', async () => {
        const connected = create({ confirm: true, connect: '/run/user/1000/gvfs/smb-share:server=nas,share=storage/music' });
        connected.component.typed = 'smb://nas/storage/music';
        await connected.component.useTypedAsync();
        expect(connected.dialogRef.close).toHaveBeenCalledWith('/run/user/1000/gvfs/smb-share:server=nas,share=storage/music');

        const failed = create({ confirm: true, connect: undefined });
        failed.component.typed = 'smb://nas/private';
        await failed.component.useTypedAsync();
        expect(failed.component.problem).toEqual('share-could-not-be-connected');
        expect(failed.dialogRef.close).not.toHaveBeenCalled();
    });

    it.each([
        ['music', 'network-folder-not-a-path'],
        ['nfs://nas/music', 'network-folder-url'],
    ])('should explain why %j cannot be used', async (typed: string, problem: string) => {
        const { component, dialogRef } = create();
        component.typed = typed;

        await component.useTypedAsync();

        expect(component.problem).toEqual(problem);
        expect(dialogRef.close).not.toHaveBeenCalled();
    });
});
