const path = require('path');
const { TagLibFileMetadata } = require('./tag-lib-file-metadata');

describe('TagLibFileMetadata', () => {
    it('should estimate the bit rate of an ALAC .m4a, which has none in its header', () => {
        const metadata = new TagLibFileMetadata(path.join(__dirname, 'test-data', 'audio', 'alac-1s.m4a'));

        expect(metadata.durationInMilliseconds).toBeGreaterThan(900);
        expect(metadata.bitRate).toBeGreaterThan(10);
        expect(metadata.bitRate).toBeLessThan(500);
    });

    describe('estimateBitRate', () => {
        const fileOf = (size) => ({ statSync: () => ({ size }) });

        it('should give kbps from size and length', () => {
            // 1 000 000 bytes in 10 s = 800 kbps
            expect(TagLibFileMetadata.estimateBitRate('/a.m4a', 10000, fileOf(1_000_000))).toEqual(800);
        });

        it.each([0, -1, NaN, Infinity, undefined, null, 'qwertyuiop'])('should give 0 for a length of %p', (duration) => {
            expect(TagLibFileMetadata.estimateBitRate('/a.m4a', duration, fileOf(1000))).toEqual(0);
        });

        it('should give 0 for an empty, missing or unreadable file', () => {
            expect(TagLibFileMetadata.estimateBitRate('/a.m4a', 1000, fileOf(0))).toEqual(0);
            expect(TagLibFileMetadata.estimateBitRate('/a.m4a', 1000, fileOf(NaN))).toEqual(0);
            expect(
                TagLibFileMetadata.estimateBitRate('/a.m4a', 1000, {
                    statSync: () => {
                        throw new Error('ENOENT');
                    },
                }),
            ).toEqual(0);
        });
    });
});
