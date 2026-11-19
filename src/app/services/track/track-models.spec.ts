import { IMock, Mock } from 'typemoq';
import { DateTime } from '../../common/date-time';
import { TrackModel } from './track-model';
import { TrackModels } from './track-models';
import { TranslatorServiceBase } from '../translator/translator.service.base';
import { Track } from '../../data/entities/track';
import { SettingsMock } from '../../testing/settings-mock';

describe('TrackModel', () => {
    let trackModels: TrackModels;
    let dateTimeMock: IMock<DateTime>;
    let translatorServiceMock: IMock<TranslatorServiceBase>;
    let settingsMock: any;

    beforeEach(() => {
        dateTimeMock = Mock.ofType<DateTime>();
        translatorServiceMock = Mock.ofType<TranslatorServiceBase>();
        settingsMock = new SettingsMock();
        trackModels = new TrackModels();
    });

    describe('constructor', () => {
        it('should define tracks', () => {
            // Arrange

            // Act

            // Assert
            expect(trackModels.tracks).toBeDefined();
        });

        it('should define tracks as empty', () => {
            // Arrange

            // Act

            // Assert
            expect(trackModels.tracks.length).toEqual(0);
        });

        it('should define totalDurationInMilliseconds', () => {
            // Arrange

            // Act

            // Assert
            expect(trackModels.totalDurationInMilliseconds).toBeDefined();
        });

        it('should define totalDurationInMilliseconds as 0', () => {
            // Arrange

            // Act

            // Assert
            expect(trackModels.totalDurationInMilliseconds).toEqual(0);
        });

        it('should define totalFileSizeInBytes', () => {
            // Arrange

            // Act

            // Assert
            expect(trackModels.totalFileSizeInBytes).toBeDefined();
        });

        it('should define totalFileSizeInBytes as 0', () => {
            // Arrange

            // Act

            // Assert
            expect(trackModels.totalFileSizeInBytes).toEqual(0);
        });

        it('should define numberOfTracks', () => {
            // Arrange

            // Act

            // Assert
            expect(trackModels.numberOfTracks).toBeDefined();
        });

        it('should define numberOfTracks as 0', () => {
            // Arrange

            // Act

            // Assert
            expect(trackModels.numberOfTracks).toEqual(0);
        });
    });

    describe('addTrack', () => {
        it('should not add an undefined track', () => {
            // Arrange
            const trackToAdd: TrackModel | undefined = undefined;
            trackModels.tracks = [];

            // Act
            trackModels.addTrack(trackToAdd);

            // Assert
            expect(trackModels.tracks.length).toEqual(0);
        });

        it('should not change totalDurationInMilliseconds for an undefined track', () => {
            // Arrange
            const trackToAdd: TrackModel | undefined = undefined;

            // Act
            trackModels.addTrack(trackToAdd);

            // Assert
            expect(trackModels.totalDurationInMilliseconds).toEqual(0);
        });

        it('should not change totalFileSizeInBytes for an undefined track', () => {
            // Arrange
            const trackToAdd: TrackModel | undefined = undefined;

            // Act
            trackModels.addTrack(trackToAdd);

            // Assert
            expect(trackModels.totalFileSizeInBytes).toEqual(0);
        });

        it('should not change numberOfTracks for an undefined track', () => {
            // Arrange
            const trackToAdd: TrackModel | undefined = undefined;

            // Act
            trackModels.addTrack(trackToAdd);

            // Assert
            expect(trackModels.numberOfTracks).toEqual(0);
        });

        it('should add a defined track', () => {
            // Arrange
            const track: Track = new Track('/home/user/Music/track1.mp3');
            const trackToAdd: TrackModel = new TrackModel(track, dateTimeMock.object, translatorServiceMock.object, settingsMock);
            trackModels.tracks = [];

            // Act
            trackModels.addTrack(trackToAdd);

            // Assert
            expect(trackModels.tracks.length).toEqual(1);
            expect(trackModels.tracks[0]).toBe(trackToAdd);
        });

        it('should ensure that tracks are stored in the order in which they are added', () => {
            // Arrange
            const track1: Track = new Track('/home/user/Music/track1.mp3');
            const trackToAdd1: TrackModel = new TrackModel(track1, dateTimeMock.object, translatorServiceMock.object, settingsMock);
            const track2: Track = new Track('/home/user/Music/track1.mp3');
            const trackToAdd2: TrackModel = new TrackModel(track2, dateTimeMock.object, translatorServiceMock.object, settingsMock);
            trackModels.tracks = [];

            // Act
            trackModels.addTrack(trackToAdd1);
            trackModels.addTrack(trackToAdd2);
            // Assert
            expect(trackModels.tracks.length).toEqual(2);
            expect(trackModels.tracks[0]).toBe(trackToAdd1);
            expect(trackModels.tracks[1]).toBe(trackToAdd2);
        });

        it('should increase totalDurationInMilliseconds with the durationInMilliseconds of the defined track', () => {
            // Arrange
            const track: Track = new Track('/home/user/Music/track1.mp3');
            track.duration = 10;
            const trackToAdd: TrackModel = new TrackModel(track, dateTimeMock.object, translatorServiceMock.object, settingsMock);

            // Act
            trackModels.addTrack(trackToAdd);

            // Assert
            expect(trackModels.totalDurationInMilliseconds).toEqual(10);
        });

        it('should increase totalFileSizeInBytes with the fileSizeInBytes of the defined track', () => {
            // Arrange
            const track: Track = new Track('/home/user/Music/track1.mp3');
            track.fileSize = 20;
            const trackToAdd: TrackModel = new TrackModel(track, dateTimeMock.object, translatorServiceMock.object, settingsMock);

            // Act
            trackModels.addTrack(trackToAdd);

            // Assert
            expect(trackModels.totalFileSizeInBytes).toEqual(20);
        });

        it('should increase numberOfTracks when adding a defined track', () => {
            // Arrange
            const track: Track = new Track('/home/user/Music/track1.mp3');
            const trackToAdd: TrackModel = new TrackModel(track, dateTimeMock.object, translatorServiceMock.object, settingsMock);

            // Act
            trackModels.addTrack(trackToAdd);

            // Assert
            expect(trackModels.numberOfTracks).toEqual(1);
        });
    });

    describe('total file size', () => {
        const track = (path: string, audioPath: string, fileSize: number): TrackModel => {
            const entity: Track = new Track(path);
            entity.audioPath = audioPath;
            entity.fileSize = fileSize;
            return new TrackModel(entity, dateTimeMock.object, translatorServiceMock.object, settingsMock);
        };

        it('should count the file of a CUE album once, not once per track', () => {
            for (let i = 1; i <= 10; i++) {
                trackModels.addTrack(track(`/music/Album.flac|${i}`, '/music/Album.flac', 300_000_000));
            }
            trackModels.addTrack(track('/music/Other.flac|1', '/music/Other.flac', 200_000_000));

            expect(trackModels.totalFileSizeInBytes).toEqual(500_000_000);
            expect(trackModels.numberOfTracks).toEqual(11);
        });

        it('should still add up normal tracks', () => {
            trackModels.addTrack(track('/music/a.mp3', '', 5));
            trackModels.addTrack(track('/music/b.mp3', '', 7));

            expect(trackModels.totalFileSizeInBytes).toEqual(12);
        });

        // Trying to break it.

        it('should count the same song queued twice once', () => {
            const song: TrackModel = track('/music/a.mp3', '', 5);
            trackModels.addTrack(song);
            trackModels.addTrack(song);

            expect(trackModels.totalFileSizeInBytes).toEqual(5);
            expect(trackModels.numberOfTracks).toEqual(2);
        });

        it.each([NaN, -1, Infinity, undefined as unknown as number])('should ignore a file size of %p', (size: number) => {
            trackModels.addTrack(track('/music/a.mp3', '', size));
            trackModels.addTrack(track('/music/b.mp3', '', 7));

            expect(trackModels.totalFileSizeInBytes).toEqual(7);
        });

        it('should handle 200 000 CUE tracks quickly', () => {
            const started: number = Date.now();
            for (let i = 0; i < 200_000; i++) {
                trackModels.addTrack(track(`/music/${i % 1000}.flac|${i}`, `/music/${i % 1000}.flac`, 1000));
            }

            expect(trackModels.totalFileSizeInBytes).toEqual(1_000_000);
            expect(Date.now() - started).toBeLessThan(3000);
        });
    });
});
