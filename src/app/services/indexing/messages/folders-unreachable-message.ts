import { IIndexingMessage } from './i-indexing-message';

/** Collection folders that could not be reached during a refresh (their songs were kept). */
export class FoldersUnreachableMessage implements IIndexingMessage {
    public type: string = 'foldersUnreachable';
    public folders: string[] = [];
    public numberOfKeptTracks: number = 0;
}
