import { Subject } from 'rxjs';
import { CueAwareAudioPlayer } from './cue-aware-audio-player';
import { IAudioPlayer } from './i-audio-player';
import { TrackModel } from '../../track/track-model';

class FakePlayer implements IAudioPlayer {
    public finished: Subject<void> = new Subject();
    public failed: Subject<string> = new Subject();
    public preloaded: Subject<TrackModel> = new Subject();
    public playbackFinished$ = this.finished.asObservable();
    public playbackFailed$ = this.failed.asObservable();
    public playingPreloadedTrack$ = this.preloaded.asObservable();
    public progressSeconds: number = 0;
    public totalSeconds: number = 0;
    public analyser: AnalyserNode = {} as AnalyserNode;
    public isPaused: boolean = false;
    public calls: string[] = [];

    public constructor(public name: string) {}

    public playAsync(track: TrackModel): Promise<void> {
        this.calls.push(`play ${track.path}`);
        return Promise.resolve();
    }
    public startPausedAsync(track: TrackModel, skipSeconds: number): Promise<void> {
        this.calls.push(`startPaused ${track.path} ${skipSeconds}`);
        return Promise.resolve();
    }
    public stop(): void {
        this.calls.push('stop');
    }
    public pause(): void {
        this.calls.push('pause');
    }
    public resumeAsync(): Promise<void> {
        this.calls.push('resume');
        return Promise.resolve();
    }
    public setVolume(volume: number, replayGainMultiplier?: number): void {
        this.calls.push(`volume ${volume} ${String(replayGainMultiplier)}`);
    }
    public setPlaybackRate(rate: number): void {
        this.calls.push(`rate ${rate}`);
    }
    public skipToSecondsAsync(seconds: number): Promise<void> {
        this.calls.push(`skip ${seconds}`);
        return Promise.resolve();
    }
    public preloadNext(track: TrackModel): void {
        this.calls.push(`preload ${track.path}`);
    }
    public getAudio(): HTMLAudioElement | undefined {
        return undefined;
    }
    public fadeAsync(level: number, durationMs: number): Promise<void> {
        this.calls.push(`fade ${level} ${durationMs}`);
        return Promise.resolve();
    }
    public setFadeLevel(level: number): void {
        this.calls.push(`fadeLevel ${level}`);
    }
    public setAudioOutputDeviceAsync(deviceId: string): Promise<void> {
        this.calls.push(`device ${deviceId}`);
        return Promise.resolve();
    }
}

function track(path: string, isCueTrack: boolean): TrackModel {
    return { path, isCueTrack } as unknown as TrackModel;
}

describe('CueAwareAudioPlayer', () => {
    const normal: TrackModel = track('/m/song.flac', false);
    const cue: TrackModel = track('/m/album.flac|2', true);
    let main: FakePlayer;
    let cuePlayer: FakePlayer;
    let created: number;
    let router: CueAwareAudioPlayer;

    function createRouter(mainPlayerStreams: boolean): CueAwareAudioPlayer {
        return new CueAwareAudioPlayer(
            main,
            () => {
                created++;
                return cuePlayer;
            },
            mainPlayerStreams,
        );
    }

    beforeEach(() => {
        main = new FakePlayer('main');
        cuePlayer = new FakePlayer('cue');
        created = 0;
        router = createRouter(false);
    });

    it('should play normal tracks on the main player', async () => {
        await router.playAsync(normal);

        expect(main.calls).toContain('play /m/song.flac');
        expect(created).toBe(0);
    });

    it('should create the CUE player only when the first CUE track plays', async () => {
        await router.playAsync(normal);
        expect(created).toBe(0);

        await router.playAsync(cue);
        await router.playAsync(cue);

        expect(created).toBe(1);
        expect(cuePlayer.calls).toContain('play /m/album.flac|2');
        expect(main.calls).not.toContain('play /m/album.flac|2');
    });

    it('should use the main player for CUE tracks when it is a streaming player', async () => {
        router = createRouter(true);

        await router.playAsync(cue);

        expect(created).toBe(0);
        expect(main.calls).toContain('play /m/album.flac|2');
    });

    it('should stop the main player when switching to the CUE player, and back', async () => {
        await router.playAsync(normal);
        await router.playAsync(cue);

        expect(main.calls).toContain('stop');

        await router.playAsync(normal);

        expect(cuePlayer.calls).toContain('stop');
    });

    it('should never pass a CUE track to the main player preload', () => {
        router.preloadNext(cue);
        router.preloadNext(normal);

        expect(main.calls).toEqual(['preload /m/song.flac']);
    });

    it('should give a lazily created CUE player the current volume, rate and output device', async () => {
        router.setVolume(0.5, 0.8);
        router.setPlaybackRate(1.25);
        await router.setAudioOutputDeviceAsync('device-1');

        await router.playAsync(cue);

        expect(cuePlayer.calls.slice(0, 3)).toEqual(['volume 0.5 0.8', 'rate 1.25', 'device device-1']);
    });

    it('should apply volume to both players once the CUE player exists', async () => {
        await router.playAsync(cue);
        router.setVolume(0.3);

        expect(main.calls).toContain('volume 0.3 undefined');
        expect(cuePlayer.calls).toContain('volume 0.3 undefined');
    });

    it('should report progress, total and pause state of the active player', async () => {
        main.progressSeconds = 10;
        cuePlayer.progressSeconds = 2;
        cuePlayer.totalSeconds = 175.72;

        expect(router.progressSeconds).toBe(10);

        await router.playAsync(cue);

        expect(router.progressSeconds).toBe(2);
        expect(router.totalSeconds).toBe(175.72);
    });

    it('should send pause, resume, stop and skip to the active player only', async () => {
        await router.playAsync(cue);
        main.calls = [];

        router.pause();
        await router.resumeAsync();
        await router.skipToSecondsAsync(30);
        router.stop();

        expect(cuePlayer.calls).toEqual(expect.arrayContaining(['pause', 'resume', 'skip 30', 'stop']));
        expect(main.calls).toEqual([]);
    });

    it('should start paused on the player for the track', async () => {
        await router.startPausedAsync(cue, 12);

        expect(cuePlayer.calls).toContain('startPaused /m/album.flac|2 12');
    });

    it('should only forward finished and failed events of the active player', async () => {
        let finished = 0;
        const failed: string[] = [];
        router.playbackFinished$.subscribe(() => finished++);
        router.playbackFailed$.subscribe((p) => failed.push(p));

        await router.playAsync(cue);
        main.finished.next();
        main.failed.next('/m/song.flac');
        cuePlayer.finished.next();
        cuePlayer.failed.next('/m/album.flac');

        expect(finished).toBe(1);
        expect(failed).toEqual(['/m/album.flac']);
    });
});
