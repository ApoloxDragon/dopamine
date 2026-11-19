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
});
