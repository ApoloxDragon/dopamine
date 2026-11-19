import { PathUtils } from './path-utils';

// The main process side of the protocol, to check that both build the same URL.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const audioProtocol = require('../../../../main/audio-protocol');

describe('PathUtils', () => {
    describe('createPlayableAudioFilePath', () => {
        it('should escape # and ?', () => {
            expect(PathUtils.createPlayableAudioFilePath('/music/a #1?.flac')).toEqual('file:////music/a %231%3F.flac');
        });
    });

    describe('createStreamingAudioFilePath', () => {
        it.each(['/home/a/Music/2021 - Album/2021 - Album.flac', "/m/Fear & Weapons #1 'live'?.flac", 'C:\\Music\\Album\\Album.flac'])(
            'should build the same URL as the main process for %s, and keep the path intact',
            (filePath: string) => {
                const url: string = PathUtils.createStreamingAudioFilePath(filePath);

                expect(url).toEqual(audioProtocol.audioUrl(filePath));
                expect(new URL(url).searchParams.get('path')).toEqual(filePath);
            },
        );
    });
});
