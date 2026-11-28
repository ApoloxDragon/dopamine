const { CueTrackPath } = require('./cue-track-path');

describe('CueTrackPath', () => {
    it('should create a virtual path', () => {
        expect(CueTrackPath.create('/music/Oracles.flac', 3)).toBe('/music/Oracles.flac|3');
    });

    it('should parse a virtual path', () => {
        expect(CueTrackPath.parse('/music/Oracles.flac|3')).toEqual({ audioPath: '/music/Oracles.flac', trackNumber: 3 });
    });

    it('should parse a Windows virtual path', () => {
        expect(CueTrackPath.parse('C:\\Music\\Agony (Japan).flac|11')).toEqual({
            audioPath: 'C:\\Music\\Agony (Japan).flac',
            trackNumber: 11,
        });
    });

    it('should not parse a normal path', () => {
        expect(CueTrackPath.parse('/music/Oracles.flac')).toBeUndefined();
    });

    it('should not parse a path whose suffix after | is not a number', () => {
        expect(CueTrackPath.parse('/music/a|b.flac')).toBeUndefined();
    });

    it('should not parse undefined or null', () => {
        expect(CueTrackPath.parse(undefined)).toBeUndefined();
        expect(CueTrackPath.parse(null)).toBeUndefined();
    });

    it('should detect cue tracks by their audio path', () => {
        expect(CueTrackPath.isCueTrack({ path: '/m/a.flac|1', audioPath: '/m/a.flac' })).toBe(true);
        expect(CueTrackPath.isCueTrack({ path: '/m/a.flac', audioPath: '' })).toBe(false);
        expect(CueTrackPath.isCueTrack({ path: '/m/a.flac', audioPath: null })).toBe(false);
        expect(CueTrackPath.isCueTrack(undefined)).toBe(false);
    });

    it('should return the real audio path', () => {
        expect(CueTrackPath.getAudioPath({ path: '/m/a.flac|1', audioPath: '/m/a.flac' })).toBe('/m/a.flac');
        expect(CueTrackPath.getAudioPath({ path: '/m/b.flac', audioPath: null })).toBe('/m/b.flac');
    });
});
