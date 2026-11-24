import { AlbumShelvesComponent } from './album-shelves.component';
import { AlbumModel } from '../../../../services/album/album-model';

function album(key: string, dateAdded: number, dateLastPlayed: number): AlbumModel {
    return { albumKey: key, dateAddedInTicks: dateAdded, dateLastPlayedInTicks: dateLastPlayed } as unknown as AlbumModel;
}

describe('AlbumShelvesComponent', () => {
    const albums: AlbumModel[] = [album('a', 10, 0), album('b', 30, 5), album('c', 20, 50), album('d', 0, 7)];

    it('should list recently added albums newest first, without albums that have no date', () => {
        expect(AlbumShelvesComponent.recentlyAdded(albums, 12).map((x) => x.albumKey)).toEqual(['b', 'c', 'a']);
    });

    it('should list recently played albums last played first, without albums never played', () => {
        expect(AlbumShelvesComponent.recentlyPlayed(albums, 12).map((x) => x.albumKey)).toEqual(['c', 'd', 'b']);
    });

    it('should keep at most the given number', () => {
        expect(AlbumShelvesComponent.recentlyAdded(albums, 2).length).toEqual(2);
        expect(AlbumShelvesComponent.recentlyAdded(albums, -1)).toEqual([]);
    });

    it('should not be thrown by odd dates or entries', () => {
        const odd: AlbumModel[] = [album('x', NaN, NaN), album('y', Infinity, -1), undefined as unknown as AlbumModel, album('z', 1, 1)];

        expect(AlbumShelvesComponent.recentlyAdded(odd, 12).map((x) => x.albumKey)).toEqual(['z']);
        expect(AlbumShelvesComponent.recentlyPlayed(odd, 12).map((x) => x.albumKey)).toEqual(['z']);
    });

    it('should not change the order of the albums it was given', () => {
        const given: AlbumModel[] = [...albums];
        AlbumShelvesComponent.recentlyAdded(given, 12);
        expect(given.map((x) => x.albumKey)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should open and close, remembered in the settings', () => {
        const settings: any = { showAlbumShelves: true };
        const component: AlbumShelvesComponent = new AlbumShelvesComponent(settings);

        component.toggle();

        expect(settings.showAlbumShelves).toBe(false);
        expect(component.isOpen).toBe(false);
    });

    it('should handle thousands of albums quickly', () => {
        const many: AlbumModel[] = Array.from({ length: 50000 }, (_, i) => album(`k${i}`, i, 50000 - i));
        const started: number = Date.now();

        const component: AlbumShelvesComponent = new AlbumShelvesComponent({ showAlbumShelves: true } as any);
        component.albums = many;

        expect(component.recentlyAdded[0].albumKey).toEqual('k49999');
        expect(component.recentlyPlayed[0].albumKey).toEqual('k0');
        expect(Date.now() - started).toBeLessThan(1000);
    });
});
