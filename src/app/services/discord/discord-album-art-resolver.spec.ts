import { IMock, It, Mock, Times } from 'typemoq';
import { DiscordAlbumArtResolver } from './discord-album-art-resolver';
import { LastfmApi } from '../../common/api/lastfm/lastfm.api';
import { LastfmAlbum } from '../../common/api/lastfm/lastfm-album';
import { Logger } from '../../common/logger';
import { TrackModel } from '../track/track-model';

function track(album: string, albumArtist: string): TrackModel {
    return { rawAlbumTitle: album, rawFirstAlbumArtist: albumArtist } as unknown as TrackModel;
}

function lastfmAlbum(extraLarge: string, large: string = ''): LastfmAlbum {
    const album: LastfmAlbum = new LastfmAlbum();
    album.imageExtraLarge = extraLarge;
    album.imageLarge = large;
    album.imageMega = '';
    album.imageMedium = '';
    return album;
}

describe('DiscordAlbumArtResolver', () => {
    let lastfmApiMock: IMock<LastfmApi>;
    let resolver: DiscordAlbumArtResolver;

    beforeEach(() => {
        lastfmApiMock = Mock.ofType<LastfmApi>();
        resolver = new DiscordAlbumArtResolver(lastfmApiMock.object, Mock.ofType<Logger>().object);
    });

    it('should return undefined from the cache before a lookup', () => {
        expect(resolver.getCachedUrl(track('Oracles', 'Fleshgod Apocalypse'))).toBeUndefined();
    });

    it('should return an empty url without looking up when album or artist is unknown', async () => {
        expect(resolver.getCachedUrl(track('', 'Fleshgod Apocalypse'))).toEqual('');
        expect(await resolver.resolveAsync(track('Oracles', ''))).toEqual('');
        lastfmApiMock.verify((x) => x.getAlbumInfoAsync(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.never());
    });

    it('should look up the cover on Last.fm and cache it per album', async () => {
        lastfmApiMock
            .setup((x) => x.getAlbumInfoAsync('Fleshgod Apocalypse', 'Oracles', false, 'EN'))
            .returns(() => Promise.resolve(lastfmAlbum('https://img/xl.jpg')));

        expect(await resolver.resolveAsync(track('Oracles', 'Fleshgod Apocalypse'))).toEqual('https://img/xl.jpg');
        expect(await resolver.resolveAsync(track('oracles', 'fleshgod apocalypse'))).toEqual('https://img/xl.jpg');
        expect(resolver.getCachedUrl(track('Oracles', 'Fleshgod Apocalypse'))).toEqual('https://img/xl.jpg');
        lastfmApiMock.verify((x) => x.getAlbumInfoAsync(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.once());
    });

    it('should share one request between simultaneous lookups', async () => {
        lastfmApiMock
            .setup((x) => x.getAlbumInfoAsync(It.isAny(), It.isAny(), It.isAny(), It.isAny()))
            .returns(() => Promise.resolve(lastfmAlbum('https://img/xl.jpg')));

        await Promise.all([resolver.resolveAsync(track('A', 'B')), resolver.resolveAsync(track('A', 'B'))]);

        lastfmApiMock.verify((x) => x.getAlbumInfoAsync(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.once());
    });

    it('should only accept https urls', async () => {
        lastfmApiMock
            .setup((x) => x.getAlbumInfoAsync(It.isAny(), It.isAny(), It.isAny(), It.isAny()))
            .returns(() => Promise.resolve(lastfmAlbum('http://img/xl.jpg', 'https://img/l.jpg')));

        expect(await resolver.resolveAsync(track('A', 'B'))).toEqual('https://img/l.jpg');
    });

    it('should cache "no cover" and never reject when Last.fm fails', async () => {
        lastfmApiMock
            .setup((x) => x.getAlbumInfoAsync(It.isAny(), It.isAny(), It.isAny(), It.isAny()))
            .returns(() => Promise.reject(new Error('offline')));

        expect(await resolver.resolveAsync(track('A', 'B'))).toEqual('');
        expect(resolver.getCachedUrl(track('A', 'B'))).toEqual('');
    });

    describe('albums split into discs', () => {
        it('should try the title without the disc part when the exact title has no cover, and share it between discs', async () => {
            lastfmApiMock
                .setup((x) => x.getAlbumInfoAsync('Amon Amarth', 'Deceiver Of The Gods (CD1)', false, 'EN'))
                .returns(() => Promise.resolve(lastfmAlbum('')));
            lastfmApiMock
                .setup((x) => x.getAlbumInfoAsync('Amon Amarth', 'Deceiver Of The Gods', false, 'EN'))
                .returns(() => Promise.resolve(lastfmAlbum('https://img/dotg.jpg')));

            expect(await resolver.resolveAsync(track('Deceiver Of The Gods (CD1)', 'Amon Amarth'))).toEqual('https://img/dotg.jpg');
            expect(resolver.getCachedUrl(track('Deceiver Of The Gods (CD2)', 'Amon Amarth'))).toEqual('https://img/dotg.jpg');
            expect(await resolver.resolveAsync(track('Deceiver of the Gods [Disc 2]', 'amon amarth'))).toEqual('https://img/dotg.jpg');
            lastfmApiMock.verify((x) => x.getAlbumInfoAsync(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.exactly(2));
        });

        it('should keep the exact cover when the disc has its own', async () => {
            lastfmApiMock
                .setup((x) => x.getAlbumInfoAsync('A', 'Live (CD2)', false, 'EN'))
                .returns(() => Promise.resolve(lastfmAlbum('https://img/cd2.jpg')));

            expect(await resolver.resolveAsync(track('Live (CD2)', 'A'))).toEqual('https://img/cd2.jpg');
            lastfmApiMock.verify((x) => x.getAlbumInfoAsync(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.once());
        });

        it('should not look up twice when the title has no disc part', async () => {
            lastfmApiMock
                .setup((x) => x.getAlbumInfoAsync(It.isAny(), It.isAny(), It.isAny(), It.isAny()))
                .returns(() => Promise.resolve(lastfmAlbum('')));

            expect(await resolver.resolveAsync(track('Oracles', 'B'))).toEqual('');
            lastfmApiMock.verify((x) => x.getAlbumInfoAsync(It.isAny(), It.isAny(), It.isAny(), It.isAny()), Times.once());
        });

        it('should remove common disc suffixes', () => {
            const cases: [string, string][] = [
                ['Deceiver Of The Gods (CD1)', 'Deceiver Of The Gods'],
                ['Album (CD 2)', 'Album'],
                ['Album [Disc 1 of 2]', 'Album'],
                ['Album {Disk 3}', 'Album'],
                ['Album (Disco 2: Bonus)', 'Album'],
                ['Album - CD2', 'Album'],
                ['Album: Disc 2', 'Album'],
                ['Album, disk 1', 'Album'],
                ['Album CD1', 'Album'],
                ['Album Disc 2 of 3', 'Album'],
                ['Album — CD 10  ', 'Album'],
            ];

            for (const [title, base] of cases) {
                expect(DiscordAlbumArtResolver.baseAlbumTitle(title)).toEqual(base);
            }
        });

        // Trying to break it.

        it('should leave titles alone that only look like a disc part', () => {
            const unchanged: string[] = [
                'Disco 2', // a real album
                'Discovery',
                'Disco Inferno',
                'CD1', // nothing else left: keep it
                '(CD1)',
                'Abcd1',
                'Discipline 2',
                'The CD Album',
                'Disc (Remastered)',
                'Album (CD) ',
                'Album (Live 1999)',
                '',
                '   ',
                '((((((((((((((((((((((((((((((',
            ];

            for (const title of unchanged) {
                expect(DiscordAlbumArtResolver.baseAlbumTitle(title)).toEqual(title.trim());
            }
        });

        it('should only remove the last disc part, and stay fast on hostile titles', () => {
            expect(DiscordAlbumArtResolver.baseAlbumTitle('Album (CD1) (CD2)')).toEqual('Album (CD1)');
            expect(DiscordAlbumArtResolver.baseAlbumTitle('Ünïcødé 盤 (CD1)')).toEqual('Ünïcødé 盤');

            const hostile: string = 'A' + ' '.repeat(300) + '-'.repeat(100) + ' cd' + '1'.repeat(100) + 'x';
            const hostileLong: string = 'A' + ' '.repeat(20000) + '-'.repeat(20000) + ' cd' + '1'.repeat(20000) + 'x';
            const started: number = Date.now();
            DiscordAlbumArtResolver.baseAlbumTitle(hostile);
            DiscordAlbumArtResolver.baseAlbumTitle(hostileLong);
            DiscordAlbumArtResolver.baseAlbumTitle('A' + '(cd1'.repeat(10000));
            expect(Date.now() - started).toBeLessThan(500);
        });
    });
});
