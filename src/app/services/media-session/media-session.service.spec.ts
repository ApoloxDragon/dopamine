import { IMock, It, Mock, Times } from 'typemoq';
import { MediaSessionService } from './media-session.service';
import { MediaSessionProxy } from '../../common/io/media-session-proxy';
import { MetadataService } from '../metadata/metadata.service';
import { TranslatorServiceBase } from '../translator/translator.service.base';
import { DateTime } from '../../common/date-time';
import { TrackModel } from '../track/track-model';
import { Track } from '../../data/entities/track';

describe('MediaSessionService', () => {
    let metadataServiceMock: IMock<MetadataService>;
    let mediaSessionProxyMock: IMock<MediaSessionProxy>;

    beforeEach(() => {
        metadataServiceMock = Mock.ofType<MetadataService>();
        mediaSessionProxyMock = Mock.ofType<MediaSessionProxy>();
    });

    function createService(): MediaSessionService {
        return new MediaSessionService(metadataServiceMock.object, mediaSessionProxyMock.object);
    }

    describe('constructor', () => {
        it('should create', () => {
            // Arrange

            // Act
            const service: MediaSessionService = createService();

            // Assert
            expect(service).toBeDefined();
        });
    });

    describe('initialize', () => {
        describe('settings.enableMultimediaKeys is true', () => {
            it('should set all multimedia keys handlers', () => {
                // Arrange
                const service: MediaSessionService = createService();

                // Act
                service.initialize();

                // Assert
                mediaSessionProxyMock.verify((x) => x.setActionHandler('play', It.isAny()), Times.once());
                mediaSessionProxyMock.verify((x) => x.setActionHandler('pause', It.isAny()), Times.once());
                mediaSessionProxyMock.verify((x) => x.setActionHandler('previoustrack', It.isAny()), Times.once());
                mediaSessionProxyMock.verify((x) => x.setActionHandler('nexttrack', It.isAny()), Times.once());
            });
        });
    });

    describe('updatePlaybackState', () => {
        it.each([true, false])('should publish the timeline with playing=%s', (isPlaying: boolean) => {
            createService().updatePlaybackState(240, 42.5, 1.25, isPlaying);

            mediaSessionProxyMock.verify((x) => x.setPlaybackState(isPlaying ? 'playing' : 'paused'), Times.once());
            mediaSessionProxyMock.verify((x) => x.setPositionState({ duration: 240, position: 42.5, playbackRate: 1.25 }), Times.once());
        });

        it.each([-1, 250])('should clamp position %s to the track duration', (position: number) => {
            createService().updatePlaybackState(240, position, 1, true);

            mediaSessionProxyMock.verify((x) => x.setPositionState({
                duration: 240, position: position < 0 ? 0 : 240, playbackRate: 1,
            }), Times.once());
        });

        it.each([
            [0, 0, 1], [-1, 0, 1], [NaN, 0, 1], [Infinity, 0, 1],
            [240, NaN, 1], [240, Infinity, 1], [240, 0, 0], [240, 0, NaN], [240, 0, Infinity],
        ])('should clear invalid timeline values (%s, %s, %s)', (duration: number, position: number, rate: number) => {
            createService().updatePlaybackState(duration, position, rate, true);

            mediaSessionProxyMock.verify((x) => x.setPositionState(), Times.once());
        });
    });

    describe('clearMetadata', () => {
        it('should clear playback state and timeline along with metadata', () => {
            createService().clearMetadata();

            mediaSessionProxyMock.verify((x) => x.setPlaybackState('none'), Times.once());
            mediaSessionProxyMock.verify((x) => x.setPositionState(), Times.once());
            mediaSessionProxyMock.verify((x) => x.clearMetadata(), Times.once());
        });
    });

    describe('setMetadataAsync', () => {
        function createTrack(path: string): TrackModel {
            const translatorServiceMock: IMock<TranslatorServiceBase> = Mock.ofType<TranslatorServiceBase>();
            const dateTimeMock: IMock<DateTime> = Mock.ofType<DateTime>();
            const track: Track = new Track(path);
            track.trackTitle = 'title1';
            track.artists = ';artist1;';
            track.albumTitle = 'album1';
            return new TrackModel(track, dateTimeMock.object, translatorServiceMock.object, '');
        }

        it('should set title, artist and album, then the small cover made for the media controls', async () => {
            const service: MediaSessionService = createService();
            const trackModel: TrackModel = createTrack('path1');
            metadataServiceMock.setup((x) => x.createMediaSessionImageUrlAsync(trackModel)).returns(() => Promise.resolve('data:image/jpeg;base64,AAA'));

            await service.setMetadataAsync(trackModel);

            mediaSessionProxyMock.verify((x) => x.setMetadata('title1', 'artist1', 'album1', 'data:image/jpeg;base64,AAA'), Times.once());
            metadataServiceMock.verify((x) => x.createAlbumImageUrlAsync(It.isAny(), It.isAny()), Times.never());
        });

        it('should show the Dopamine logo when the track has no cover, so the previous cover does not stay', async () => {
            const service: MediaSessionService = createService();
            const trackModel: TrackModel = createTrack('path1');
            metadataServiceMock.setup((x) => x.createMediaSessionImageUrlAsync(trackModel)).returns(() => Promise.resolve(''));
            mediaSessionProxyMock
                .setup((x) => x.loadImageAsDataUrlAsync(MediaSessionService.placeholderImagePath))
                .returns(() => Promise.resolve('data:image/png;base64,LOGO'));

            await service.setMetadataAsync(trackModel);
            await service.setMetadataAsync(trackModel);

            mediaSessionProxyMock.verify((x) => x.setMetadata('title1', 'artist1', 'album1', 'data:image/png;base64,LOGO'), Times.atLeast(2));
            // The logo is loaded once and reused
            mediaSessionProxyMock.verify((x) => x.loadImageAsDataUrlAsync(It.isAny()), Times.once());
        });

        it('should not let a slow cover of an older track overwrite the newer track', async () => {
            const service: MediaSessionService = createService();
            const older: TrackModel = createTrack('older');
            const newer: TrackModel = createTrack('newer');
            let resolveOlder: (url: string) => void = () => {};
            metadataServiceMock
                .setup((x) => x.createMediaSessionImageUrlAsync(older))
                .returns(() => new Promise<string>((resolve) => (resolveOlder = resolve)));
            metadataServiceMock.setup((x) => x.createMediaSessionImageUrlAsync(newer)).returns(() => Promise.resolve('data:new'));

            const olderRequest = service.setMetadataAsync(older);
            await service.setMetadataAsync(newer);
            resolveOlder('data:old');
            await olderRequest;

            mediaSessionProxyMock.verify((x) => x.setMetadata(It.isAny(), It.isAny(), It.isAny(), 'data:old'), Times.never());
            mediaSessionProxyMock.verify((x) => x.setMetadata(It.isAny(), It.isAny(), It.isAny(), 'data:new'), Times.once());
        });
    });
});
