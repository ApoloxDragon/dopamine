import { Observable, Subject } from 'rxjs';
import { IMock, It, Mock, Times } from 'typemoq';
import { DateTime } from '../../common/date-time';
import { DateProxy } from '../../common/io/date-proxy';
import { Logger } from '../../common/logger';
import { SettingsBase } from '../../common/settings/settings.base';
import { PlaybackProgress } from '../playback/playback-progress';
import { PlaybackStarted } from '../playback/playback-started';
import { TrackModel } from '../track/track-model';
import { DiscordService } from './discord.service';
import { PlaybackService } from '../playback/playback.service';
import { TranslatorServiceBase } from '../translator/translator.service.base';
import { Track } from '../../data/entities/track';
import { IpcProxyBase } from '../../common/io/ipc-proxy.base';
import { DiscordApiCommand } from './discord-api-command';
import { DiscordApiCommandType } from './discord-api-command-type';
import { SettingsMock } from '../../testing/settings-mock';
import { DiscordAlbumArtResolver } from './discord-album-art-resolver';

describe('DiscordService', () => {
    let playbackServiceMock: IMock<PlaybackService>;
    let dateTimeMock: IMock<DateTime>;
    let translatorServiceMock: IMock<TranslatorServiceBase>;
    let dateProxyMock: IMock<DateProxy>;
    let ipcProxyMock: IMock<IpcProxyBase>;
    let settingsMock: SettingsMock;
    let loggerMock: IMock<Logger>;
    let albumArtResolverMock: IMock<DiscordAlbumArtResolver>;

    let playbackServicePlaybackStartedMock: Subject<PlaybackStarted>;
    let playbackServicePlaybackStoppedMock: Subject<void>;
    let playbackServicePlaybackPausedMock: Subject<void>;
    let playbackServicePlaybackResumedMock: Subject<void>;
    let playbackServicePlaybackSkippedMock: Subject<void>;

    let trackModel: TrackModel;

    beforeEach(() => {
        playbackServiceMock = Mock.ofType<PlaybackService>();
        dateTimeMock = Mock.ofType<DateTime>();
        translatorServiceMock = Mock.ofType<TranslatorServiceBase>();
        dateProxyMock = Mock.ofType<DateProxy>();
        ipcProxyMock = Mock.ofType<IpcProxyBase>();
        settingsMock = new SettingsMock();
        loggerMock = Mock.ofType<Logger>();
        albumArtResolverMock = Mock.ofType<DiscordAlbumArtResolver>();
        albumArtResolverMock.setup((x) => x.getCachedUrl(It.isAny())).returns(() => '');

        translatorServiceMock.setup((x) => x.get('playing')).returns(() => 'Playing');
        translatorServiceMock.setup((x) => x.get('paused')).returns(() => 'Paused');
        translatorServiceMock.setup((x) => x.get('playing-with-dopamine')).returns(() => 'Playing with Dopamine');

        const track: Track = new Track('path');
        track.trackTitle = 'title';
        track.artists = ';artist1;;artist2';
        trackModel = new TrackModel(track, dateTimeMock.object, translatorServiceMock.object, '');
        track.duration = 200000;

        dateProxyMock.setup((x) => x.now()).returns(() => 5000);
    });

    function setUpPlaybackServiceMock(isPlaying: boolean, canPause: boolean): void {
        playbackServicePlaybackStartedMock = new Subject();
        const playbackServicePlaybackStartedMock$: Observable<PlaybackStarted> = playbackServicePlaybackStartedMock.asObservable();
        playbackServiceMock.setup((x) => x.playbackStarted$).returns(() => playbackServicePlaybackStartedMock$);

        playbackServicePlaybackStoppedMock = new Subject();
        const playbackServicePlaybackStoppedMock$: Observable<void> = playbackServicePlaybackStoppedMock.asObservable();
        playbackServiceMock.setup((x) => x.playbackStopped$).returns(() => playbackServicePlaybackStoppedMock$);

        playbackServicePlaybackPausedMock = new Subject();
        const playbackServicePlaybackPausedMock$: Observable<void> = playbackServicePlaybackPausedMock.asObservable();
        playbackServiceMock.setup((x) => x.playbackPaused$).returns(() => playbackServicePlaybackPausedMock$);

        playbackServicePlaybackResumedMock = new Subject();
        const playbackServicePlaybackResumedMock$: Observable<void> = playbackServicePlaybackResumedMock.asObservable();
        playbackServiceMock.setup((x) => x.playbackResumed$).returns(() => playbackServicePlaybackResumedMock$);

        playbackServicePlaybackSkippedMock = new Subject();
        const playbackServicePlaybackSkippedMock$: Observable<void> = playbackServicePlaybackSkippedMock.asObservable();
        playbackServiceMock.setup((x) => x.playbackSkipped$).returns(() => playbackServicePlaybackSkippedMock$);

        playbackServiceMock.setup((x) => x.currentTrack).returns(() => trackModel);

        const progress: PlaybackProgress = new PlaybackProgress(2, 120);
        playbackServiceMock.setup((x) => x.progress).returns(() => progress);

        playbackServiceMock.setup((x) => x.isPlaying).returns(() => isPlaying);
        playbackServiceMock.setup((x) => x.canPause).returns(() => canPause);
    }

    function createDiscordService(): DiscordService {
        return new DiscordService(
            playbackServiceMock.object,
            translatorServiceMock.object,
            dateProxyMock.object,
            ipcProxyMock.object,
            settingsMock,
            loggerMock.object,
            albumArtResolverMock.object,
        );
    }

    describe('constructor', () => {
        it('should create', () => {
            // Act
            const service: DiscordService = createDiscordService();

            // Assert
            expect(service).toBeDefined();
        });
    });

    describe('initialize', () => {
        it('should clear Discord presence if Discord Rich Presence is disabled', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = false;

            const service: DiscordService = createDiscordService();

            // Act
            service.initialize();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.ClearPresence, undefined)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Playing" if a track is already playing and Discord Rich Presence is enabled', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = true;

            setUpPlaybackServiceMock(true, true);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'play',
                smallImageText: 'Playing',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: true,
                startTime: 3000,
                endTime: 123000,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.initialize();
            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Playing" after a track starts playing and Discord Rich Presence is enabled', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = true;

            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'play',
                smallImageText: 'Playing',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: true,
                startTime: 3000,
                endTime: 123000,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackStartedMock.next(new PlaybackStarted(trackModel, false));
            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Paused" after a track is paused and Discord Rich Presence is enabled', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = true;

            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'pause',
                smallImageText: 'Paused',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: false,
                startTime: 0,
                endTime: undefined,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackPausedMock.next();
            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Playing" after a track is resumed and Discord Rich Presence is enabled', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = true;

            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'play',
                smallImageText: 'Playing',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: true,
                startTime: 3000,
                endTime: 123000,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackResumedMock.next();
            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Playing" after a track is skipped and Discord Rich Presence is enabled and playbackService can pause', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = true;

            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'play',
                smallImageText: 'Playing',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: true,
                startTime: 3000,
                endTime: 123000,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackSkippedMock.next();
            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Paused" after a track is skipped and Discord Rich Presence is enabled and playbackService cannot pause', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = true;

            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'pause',
                smallImageText: 'Paused',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: false,
                startTime: 0,
                endTime: undefined,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackSkippedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should clear Discord presence after a track is stopped and Discord Rich Presence is enabled', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = true;

            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackStoppedMock.next();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.ClearPresence, undefined)),
                Times.once(),
            );
        });

        it('should not set Discord presence after a track starts playing and Discord Rich Presence is disabled', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = false;

            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            jest.useFakeTimers();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackStartedMock.next(
                new PlaybackStarted(new TrackModel(new Track('Path1'), dateTimeMock.object, translatorServiceMock.object, ''), false),
            );

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });

        it('should not set Discord presence to "Paused" after a track is paused and Discord Rich Presence is disabled', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = false;

            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            jest.useFakeTimers();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackPausedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });

        it('should not set Discord presence to "Playing" after a track is resumed and Discord Rich Presence is disabled', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = false;

            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            jest.useFakeTimers();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackResumedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });

        it('should not set Discord presence to "Playing" after a track is skipped and Discord Rich Presence is disabled and playbackService can pause', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = false;

            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            jest.useFakeTimers();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackSkippedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });

        it('should not set Discord presence to "Playing" after a track is skipped and Discord Rich Presence is disabled and playbackService cannot pause', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = false;

            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            jest.useFakeTimers();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackSkippedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });

        it('should not clear Discord presence after a track is stopped and Discord Rich Presence is disabled', () => {
            // Arrange
            settingsMock.enableDiscordRichPresence = false;

            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            // Act
            service.initialize();
            ipcProxyMock.reset();

            playbackServicePlaybackStoppedMock.next();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });
    });

    describe('enableDiscordRichPresence', () => {
        it('should clear Discord presence if enableRichPresence is false', () => {
            // Arrange
            const service: DiscordService = createDiscordService();

            // Act
            service.enableDiscordRichPresence = false;

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.ClearPresence, undefined)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Playing" if a track is already playing and enableRichPresence is true', () => {
            // Arrange
            setUpPlaybackServiceMock(true, true);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'play',
                smallImageText: 'Playing',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: true,
                startTime: 3000,
                endTime: 123000,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.enableDiscordRichPresence = true;

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Playing" after a track starts playing and enableRichPresence is true', () => {
            // Arrange
            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'play',
                smallImageText: 'Playing',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: true,
                startTime: 3000,
                endTime: 123000,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.enableDiscordRichPresence = true;
            ipcProxyMock.reset();

            playbackServicePlaybackStartedMock.next(new PlaybackStarted(trackModel, false));

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Paused" after a track is paused and enableRichPresence is true', () => {
            // Arrange
            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'pause',
                smallImageText: 'Paused',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: false,
                startTime: 0,
                endTime: undefined,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.enableDiscordRichPresence = true;
            ipcProxyMock.reset();

            playbackServicePlaybackPausedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Playing" after a track is resumed and enableRichPresence is true', () => {
            // Arrange
            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'play',
                smallImageText: 'Playing',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: true,
                startTime: 3000,
                endTime: 123000,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.enableDiscordRichPresence = true;
            ipcProxyMock.reset();

            playbackServicePlaybackResumedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Playing" after a track is skipped and enableRichPresence is true and playbackService can pause', () => {
            // Arrange
            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'play',
                smallImageText: 'Playing',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: true,
                startTime: 3000,
                endTime: 123000,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.enableDiscordRichPresence = true;
            ipcProxyMock.reset();

            playbackServicePlaybackSkippedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should set Discord presence to "Paused" after a track is skipped and enableRichPresence is true and playbackService cannot pause', () => {
            // Arrange
            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            const args = {
                title: 'title',
                artists: 'artist1, artist2',
                smallImageKey: 'pause',
                smallImageText: 'Paused',
                largeImageKey: 'icon',
                largeImageText: 'Playing with Dopamine',
                shouldSendTimestamps: false,
                startTime: 0,
                endTime: undefined,
                type: 2,
                statusDisplayType: 1,
            };

            jest.useFakeTimers();

            // Act
            service.enableDiscordRichPresence = true;
            ipcProxyMock.reset();

            playbackServicePlaybackSkippedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args)),
                Times.once(),
            );
        });

        it('should clear Discord presence after a track is stopped and enableRichPresence is true', () => {
            // Arrange
            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            // Act
            service.enableDiscordRichPresence = true;
            ipcProxyMock.reset();

            playbackServicePlaybackStoppedMock.next();

            // Assert
            ipcProxyMock.verify(
                (x) => x.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.ClearPresence, undefined)),
                Times.once(),
            );
        });

        it('should not set Discord presence after a track starts playing and enableRichPresence is false', () => {
            // Arrange
            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            jest.useFakeTimers();

            // Act
            service.enableDiscordRichPresence = false;
            ipcProxyMock.reset();

            playbackServicePlaybackStartedMock.next(
                new PlaybackStarted(new TrackModel(new Track('Path1'), dateTimeMock.object, translatorServiceMock.object, ''), false),
            );

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });

        it('should not set Discord presence to "Paused" after a track is paused and enableRichPresence is false', () => {
            // Arrange
            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            jest.useFakeTimers();

            // Act
            service.enableDiscordRichPresence = false;
            ipcProxyMock.reset();

            playbackServicePlaybackPausedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });

        it('should not set Discord presence to "Playing" after a track is resumed and enableRichPresence is false', () => {
            // Arrange
            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            jest.useFakeTimers();

            // Act
            service.enableDiscordRichPresence = false;
            ipcProxyMock.reset();

            playbackServicePlaybackResumedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });

        it('should not set Discord presence to "Playing" after a track is skipped and enableRichPresence is false and playbackService can pause', () => {
            // Arrange
            setUpPlaybackServiceMock(false, true);
            const service: DiscordService = createDiscordService();

            jest.useFakeTimers();

            // Act
            service.enableDiscordRichPresence = false;
            ipcProxyMock.reset();

            playbackServicePlaybackSkippedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });

        it('should not set Discord presence to "Playing" after a track is skipped and enableRichPresence is false and playbackService cannot pause', () => {
            // Arrange
            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            jest.useFakeTimers();

            // Act
            service.enableDiscordRichPresence = false;
            ipcProxyMock.reset();

            playbackServicePlaybackSkippedMock.next();

            jest.runAllTimers();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });

        it('should not clear Discord presence after a track is stopped and enableRichPresence is false', () => {
            // Arrange
            setUpPlaybackServiceMock(false, false);
            const service: DiscordService = createDiscordService();

            // Act
            service.enableDiscordRichPresence = false;
            ipcProxyMock.reset();

            playbackServicePlaybackStoppedMock.next();

            // Assert
            ipcProxyMock.verify((x) => x.sendToMainProcess('discord-api-command', It.isAny()), Times.never());
        });
    });

    describe('Listening to presence (album and cover)', () => {
        it('should make the status read "Listening to <artist>"', () => {
            settingsMock.enableDiscordRichPresence = true;
            setUpPlaybackServiceMock(true, true);
            const sent = sentArgs();
            jest.useFakeTimers();

            createDiscordService().initialize();
            jest.runAllTimers();

            expect(sent[sent.length - 1].type).toEqual(2);
            expect(sent[sent.length - 1].statusDisplayType).toEqual(1);
            expect(sent[sent.length - 1].artists).toEqual('artist1, artist2');
        });

        function sentArgs(): any[] {
            const sent: any[] = [];
            ipcProxyMock
                .setup((x) => x.sendToMainProcess('discord-api-command', It.isAny()))
                .callback((_: string, command: DiscordApiCommand) => sent.push(command.args));
            return sent;
        }

        function setAlbum(title: string, albumArtists: string): void {
            const track: Track = new Track('path');
            track.trackTitle = 'title';
            track.artists = ';artist1;';
            track.albumTitle = title;
            track.albumArtists = albumArtists;
            trackModel = new TrackModel(track, dateTimeMock.object, translatorServiceMock.object, '');
        }

        it('should show the album title as the caption of the large image', () => {
            settingsMock.enableDiscordRichPresence = true;
            setAlbum('Oracles', ';Fleshgod Apocalypse;');
            setUpPlaybackServiceMock(true, true);
            const sent = sentArgs();
            jest.useFakeTimers();

            createDiscordService().initialize();
            jest.runAllTimers();

            expect(sent[sent.length - 1].largeImageText).toEqual('Oracles');
            expect(sent[sent.length - 1].largeImageKey).toEqual('icon');
        });

        it('should send an end time for the progress bar while playing', () => {
            settingsMock.enableDiscordRichPresence = true;
            setUpPlaybackServiceMock(true, true);
            const sent = sentArgs();
            jest.useFakeTimers();

            createDiscordService().initialize();
            jest.runAllTimers();

            // now (5000) + remaining (120 - 2 s)
            expect(sent[sent.length - 1].endTime).toEqual(123000);
        });

        it('should use the track length for the end time when the player does not know it yet', () => {
            settingsMock.enableDiscordRichPresence = true;
            setUpPlaybackServiceMock(true, true);
            playbackServiceMock.reset();
            setUpPlaybackServiceMock(true, true);
            playbackServiceMock.setup((x) => x.progress).returns(() => new PlaybackProgress(2, 0));
            const sent = sentArgs();
            jest.useFakeTimers();

            createDiscordService().initialize();
            jest.runAllTimers();

            // now (5000) + track length (200 s, from the collection) - progress (2 s)
            expect(sent[sent.length - 1].endTime).toEqual(5000 + 198000);
        });

        it('should take the playback speed into account for the end time', () => {
            settingsMock.enableDiscordRichPresence = true;
            setUpPlaybackServiceMock(true, true);
            playbackServiceMock.setup((x) => x.playbackSpeed).returns(() => 2);
            const sent = sentArgs();
            jest.useFakeTimers();

            createDiscordService().initialize();
            jest.runAllTimers();

            expect(sent[sent.length - 1].endTime).toEqual(5000 + 59000);
        });

        it('should use a cached album cover URL as the large image', () => {
            settingsMock.enableDiscordRichPresence = true;
            setAlbum('Oracles', ';Fleshgod Apocalypse;');
            setUpPlaybackServiceMock(true, true);
            albumArtResolverMock.reset();
            albumArtResolverMock.setup((x) => x.getCachedUrl(It.isAny())).returns(() => 'https://img/cover.jpg');
            const sent = sentArgs();
            jest.useFakeTimers();

            createDiscordService().initialize();
            jest.runAllTimers();

            expect(sent[sent.length - 1].largeImageKey).toEqual('https://img/cover.jpg');
            albumArtResolverMock.verify((x) => x.resolveAsync(It.isAny()), Times.never());
        });

        it('should look the cover up when it is not cached yet', () => {
            settingsMock.enableDiscordRichPresence = true;
            setAlbum('Oracles', ';Fleshgod Apocalypse;');
            setUpPlaybackServiceMock(true, true);
            albumArtResolverMock.reset();
            albumArtResolverMock.setup((x) => x.getCachedUrl(It.isAny())).returns(() => undefined);
            albumArtResolverMock.setup((x) => x.resolveAsync(It.isAny())).returns(() => Promise.resolve(''));
            const sent = sentArgs();
            jest.useFakeTimers();

            createDiscordService().initialize();
            jest.runAllTimers();

            expect(sent[sent.length - 1].largeImageKey).toEqual('icon');
            albumArtResolverMock.verify((x) => x.resolveAsync(It.isAny()), Times.once());
        });

        it('should not look covers up when the album cover setting is off', () => {
            settingsMock.enableDiscordRichPresence = true;
            settingsMock.showAlbumCoverInDiscordRichPresence = false;
            setAlbum('Oracles', ';Fleshgod Apocalypse;');
            setUpPlaybackServiceMock(true, true);
            albumArtResolverMock.reset();
            albumArtResolverMock.setup((x) => x.getCachedUrl(It.isAny())).returns(() => undefined);
            const sent = sentArgs();
            jest.useFakeTimers();

            createDiscordService().initialize();
            jest.runAllTimers();

            expect(sent[sent.length - 1].largeImageKey).toEqual('icon');
            albumArtResolverMock.verify((x) => x.resolveAsync(It.isAny()), Times.never());
            albumArtResolverMock.verify((x) => x.getCachedUrl(It.isAny()), Times.never());
        });
    });
});
