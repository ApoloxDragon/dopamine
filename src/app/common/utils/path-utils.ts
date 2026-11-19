import { StringUtils } from './string-utils';

export class PathUtils {
    public static createPlayableAudioFilePath(audioFilePath: string): string {
        // HTMLAudioElement doesn't play paths which contain # and ?, so we escape them.
        let playableAudioFilePath: string = StringUtils.replaceAll(audioFilePath, '#', '%23');
        playableAudioFilePath = StringUtils.replaceAll(playableAudioFilePath, '?', '%3F');

        return `file:///${playableAudioFilePath}`;
    }

    /**
     * The URL of a local audio file on the app's dopamine-audio:// protocol (main/audio-protocol.js builds the same URL).
     * Used when the <audio> element cannot open a file through file://, for example a FLAC whose cover has no MIME type.
     */
    public static createStreamingAudioFilePath(audioFilePath: string): string {
        return `dopamine-audio://audio/?path=${encodeURIComponent(audioFilePath)}`;
    }
}
