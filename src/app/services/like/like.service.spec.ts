import { LikeService } from './like.service';
import { LikedKind, LikedRepositoryBase } from '../../data/repositories/liked-repository.base';
import { Logger } from '../../common/logger';
import { TrackModel } from '../track/track-model';

class MemoryRepository implements LikedRepositoryBase {
    public store: Map<string, number> = new Map();
    public reads: number = 0;
    public failWrites: boolean = false;

    public getAll(kind: LikedKind): Map<string, number> {
        this.reads++;
        return new Map([...this.store].filter(([k]) => k.startsWith(`${kind}:`)).map(([k, v]) => [k.slice(kind.length + 1), v]));
    }

    public set(kind: LikedKind, key: string, value: number): void {
        if (this.failWrites) {
            throw new Error('database is locked');
        }
        value === 0 ? this.store.delete(`${kind}:${key}`) : this.store.set(`${kind}:${key}`, value);
    }
}

describe('LikeService', () => {
    let repository: MemoryRepository;
    let logger: { error: jest.Mock };
    let service: LikeService;

    beforeEach(() => {
        repository = new MemoryRepository();
        logger = { error: jest.fn() };
        service = new LikeService(repository, logger as unknown as Logger);
    });

    it('the regular customer: like, dislike and clear an album', () => {
        service.toggleAlbumLike('paranoid', 1);
        expect(service.albumLike('paranoid')).toBe(1);
        expect(service.likedAlbumKeys()).toEqual(['paranoid']);

        service.toggleAlbumLike('paranoid', -1);
        expect(service.albumLike('paranoid')).toBe(-1);

        service.toggleAlbumLike('paranoid', -1);
        expect(service.albumLike('paranoid')).toBe(0);
        expect(repository.store.size).toBe(0);
    });

    it('should treat artist names without regard to case or spaces', () => {
        service.toggleArtistLike('  Black Sabbath ', -1);

        expect(service.artistLike('black sabbath')).toBe(-1);
        expect(service.isDislikedByAlbumOrArtist({ albumKey: 'x', rawArtists: ['Ozzy', 'BLACK SABBATH'] } as unknown as TrackModel)).toBe(
            true,
        );
        expect(service.isDislikedByAlbumOrArtist({ albumKey: 'x', rawArtists: ['Ozzy'] } as unknown as TrackModel)).toBe(false);
    });

    it('should read the database once, not on every check', () => {
        for (let i = 0; i < 1000; i++) {
            service.albumLike(`a${i}`);
        }

        expect(repository.reads).toBe(1);
    });

    // Trying to break it.

    it('should ignore empty keys and odd input', () => {
        service.toggleAlbumLike('', 1);
        service.toggleArtistLike('   ', 1);

        expect(repository.store.size).toBe(0);
        expect(service.albumLike(undefined)).toBe(0);
        expect(service.artistLike(undefined)).toBe(0);
        expect(service.isDislikedByAlbumOrArtist({} as TrackModel)).toBe(false);
    });

    it('should keep working, and keep the old value, when the database cannot be written or read', () => {
        service.toggleAlbumLike('a', 1);
        repository.failWrites = true;

        service.toggleAlbumLike('a', -1);

        expect(service.albumLike('a')).toBe(1);
        expect(logger.error).toHaveBeenCalled();

        const broken = new LikeService(
            {
                getAll: () => {
                    throw new Error('no table');
                },
                set: () => undefined,
            },
            logger as unknown as Logger,
        );
        expect(broken.albumLike('a')).toBe(0);
    });
});
