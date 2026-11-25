class FoldersUnreachableMessage {
    constructor(folders, numberOfKeptTracks) {
        this.type = 'foldersUnreachable';
        this.folders = folders;
        this.numberOfKeptTracks = numberOfKeptTracks;
    }
}

exports.FoldersUnreachableMessage = FoldersUnreachableMessage;
