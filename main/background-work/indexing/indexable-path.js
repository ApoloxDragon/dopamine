class IndexablePath {
    // cue is set for CUE sheet tracks: { audioPath, cuePath }. path is then the virtual path (see CueTrackPath).
    constructor(path, dateModifiedTicks, folderId, cue = undefined) {
        this.path = path;
        this.dateModifiedTicks = dateModifiedTicks;
        this.folderId = folderId;
        this.cue = cue;
    }
}

exports.IndexablePath = IndexablePath;
