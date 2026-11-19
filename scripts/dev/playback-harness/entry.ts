// Browser entry for the playback harness: exposes the real players with stubbed Angular services.
import { LegacyAudioPlayer } from '../../../src/app/services/playback/audio-player/legacy-audio-player';
import { CueAwareAudioPlayer } from '../../../src/app/services/playback/audio-player/cue-aware-audio-player';
import { MathExtensions } from '../../../src/app/common/math-extensions';

const logger: any = {
    info: (m: string) => console.log('[info] ' + m),
    warn: (m: string) => console.log('[warn] ' + m),
    error: (e: unknown, m: string) => console.log('[error] ' + m + ' ' + String(e)),
};
// Every player's equalizer, so a harness can change filters and fades of the player it plays on.
const equalizers: any[] = [];
const equalizerService: any = { register: (equalizer: any) => equalizers.push(equalizer) };
const settings: any = { preferredAudioOutputDeviceId: '' };

function createLegacy(): LegacyAudioPlayer {
    return new LegacyAudioPlayer(new MathExtensions(), equalizerService, logger, settings);
}

// Minimal TrackModel stand-in with the members the players use.
function createTrack(audioPath: string, number: number, startSeconds: number, endSeconds: number): any {
    return {
        path: `${audioPath}|${number}`,
        audioPath,
        isCueTrack: true,
        cueStartSeconds: startSeconds,
        cueEndSeconds: endSeconds,
        number,
    };
}

function createNormalTrack(path: string): any {
    return { path, audioPath: path, isCueTrack: false, cueStartSeconds: 0, cueEndSeconds: 0, number: 0 };
}

(window as any).harness = {
    equalizers,
    createLegacy,
    createRouter: () => new CueAwareAudioPlayer(createLegacy(), createLegacy, true),
    // Like a gapless/crossfade setup: a separate main player, and a CUE player created on demand.
    createSplitRouter: () => new CueAwareAudioPlayer(createLegacy(), createLegacy, false),
    createTrack,
    createNormalTrack,
};
