import { NetworkFolderPath } from './network-folder-path';

describe('NetworkFolderPath', () => {
    it.each([
        ['\\\\192.168.10.183\\storage\\music', '\\\\192.168.10.183\\storage\\music'],
        ['\\\\192.168.10.183\\storage\\music\\', '\\\\192.168.10.183\\storage\\music'],
        ['  "\\\\server\\share"  ', '\\\\server\\share'],
        ["'Z:\\Music'", 'Z:\\Music'],
        ['Z:\\', 'Z:\\'],
        ['//server/share/music', '//server/share/music'],
        ['/mnt/music/', '/mnt/music'],
        [
            '/run/user/1000/gvfs/smb-share:server=192.168.10.183,share=storage/music',
            '/run/user/1000/gvfs/smb-share:server=192.168.10.183,share=storage/music',
        ],
        ['/media/apolox/Ünïcødé 🍺', '/media/apolox/Ünïcødé 🍺'],
    ])('should accept %j as %j', (typed: string, expected: string) => {
        expect(NetworkFolderPath.check(typed)).toEqual({ path: expected, problem: undefined });
    });

    it.each([
        ['', 'empty'],
        ['   ', 'empty'],
        [undefined, 'empty'],
        [null, 'empty'],
        ['""', 'empty'],
        ['smb://192.168.10.183/storage/music', 'url'],
        ['SMB://server/share', 'url'],
        ['nfs://nas/music', 'url'],
        ['file:///home/apolox/Music', 'url'],
        ['music', 'relative'],
        ['./music', 'relative'],
        ['..\\..\\Windows', 'relative'],
        ['\\\\server', 'relative'],
        ['//server', 'relative'],
        ['C:music', 'relative'],
        ['192.168.10.183\\storage', 'relative'],
    ])('should refuse %j (%s)', (typed: any, problem: string) => {
        expect(NetworkFolderPath.check(typed)).toEqual({ path: undefined, problem });
    });

    it('should stay fast on a very long typed path', () => {
        const started: number = Date.now();
        NetworkFolderPath.check('/' + 'a/'.repeat(100000) + '\\'.repeat(100000));
        NetworkFolderPath.check('x'.repeat(200000) + '://');
        expect(Date.now() - started).toBeLessThan(500);
    });
});
