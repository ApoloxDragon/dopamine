import { NetworkDriveNicknames } from './network-drive-nicknames';

describe('NetworkDriveNicknames', () => {
    const gvfs = '/run/user/1000/gvfs';
    const guest = `${gvfs}/smb-share:server=192.168.10.183,share=storage`;
    const withUser = `${gvfs}/smb-share:server=192.168.10.183,share=Storage,user=apolox`;
    let stored: string | undefined;
    const nicknames = (): NetworkDriveNicknames =>
        new NetworkDriveNicknames(
            () => stored,
            (x) => (stored = x),
        );

    beforeEach(() => (stored = '{}'));

    it('the regular customer: names a share, shown with the folder inside it', () => {
        expect(nicknames().set(`${guest}/music`, 'Home server')).toBe(true);

        expect(nicknames().display(`${guest}/music`)).toBe('Home server › music');
        expect(nicknames().display(guest)).toBe('Home server');
        expect(nicknames().get(`${guest}/music/flac`)).toBe('Home server');
    });

    it('should keep the nickname when the share comes back under another name', () => {
        nicknames().set(`${guest}/music`, 'Home server');

        expect(nicknames().display(`${withUser}/music`)).toBe('Home server › music');
    });

    it('should remove the nickname when it is emptied', () => {
        nicknames().set(guest, 'Home server');
        nicknames().set(guest, '   ');

        expect(nicknames().get(guest)).toBeUndefined();
        expect(stored).toBe('{}');
    });

    // Trying to break it.

    it.each([['/home/apolox/Music'], ['/mnt/storage'], [''], [undefined as unknown as string]])(
        'should not name %p (not a desktop share)',
        (path) => {
            expect(nicknames().set(path, 'x')).toBe(false);
            expect(nicknames().display(path)).toBeUndefined();
        },
    );

    it('should clean nicknames: control characters, direction tricks, long text', () => {
        nicknames().set(guest, '  Home\u0000‮ server\n\t ' + 'x'.repeat(200));

        const name = nicknames().get(guest)!;
        expect(name.startsWith('Home server x')).toBe(true);
        expect(name.length).toBeLessThanOrEqual(NetworkDriveNicknames.maximumLength);
        expect(name).not.toMatch(/[\u0000-\u001f‮]/);
    });

    it('should keep HTML-looking names as plain text', () => {
        nicknames().set(guest, '<img src=x onerror=alert(1)>');

        expect(nicknames().get(guest)).toBe('<img src=x onerror=alert(1)>');
    });

    it.each([['not JSON'], ['[1,2]'], ['null'], [undefined as unknown as string], ['{"a/b": 5, "nokey": "x", "c/d": ""}']])(
        'should survive stored settings like %p',
        (text) => {
            stored = text;

            expect(nicknames().get(guest)).toBeUndefined();
            expect(nicknames().set(guest, 'Home server')).toBe(true);
            expect(nicknames().get(guest)).toBe('Home server');
        },
    );

    it('should refuse more than 100 shares, but still rename an existing one', () => {
        for (let i = 0; i < NetworkDriveNicknames.maximumCount; i++) {
            nicknames().set(`${gvfs}/smb-share:server=nas${i},share=s`, `n${i}`);
        }

        expect(nicknames().set(guest, 'one too many')).toBe(false);
        expect(nicknames().set(`${gvfs}/smb-share:server=nas0,share=s`, 'renamed')).toBe(true);
    });
});
