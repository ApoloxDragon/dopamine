import { Migration } from '../migration';

/**
 * Likes and dislikes for albums and artists (songs keep theirs in Track.Love). Only adds a table: nothing existing changes.
 * Kind: 'album' (Key = album key) or 'artist' (Key = artist name, lower case). Value: 1 = liked, -1 = disliked.
 */
export class Migration18 extends Migration {
    public id: number = 18;
    public name: string = 'Migration18';

    public up(): void {
        this.sql(
            'CREATE TABLE Liked (' +
                'Kind TEXT NOT NULL, ' +
                'Key TEXT NOT NULL, ' +
                'Value INTEGER NOT NULL, ' +
                'LikedAtMs INTEGER, ' +
                'PRIMARY KEY (Kind, Key));',
        );
    }
}
