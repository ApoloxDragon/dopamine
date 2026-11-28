const { workerData, parentPort } = require('worker_threads');

class WorkerProxy {
    task() {
        return workerData.arg.task;
    }

    postMessage(message) {
        parentPort?.postMessage(message);
    }

    applicationDataDirectory() {
        return workerData.arg.applicationDataDirectory;
    }

    skipRemovedFilesDuringRefresh() {
        return workerData.arg.skipRemovedFilesDuringRefresh;
    }

    extraLogging() {
        return workerData.arg.extraLogging === true;
    }

    useSongCache() {
        return workerData.arg.useSongCache === true;
    }
}

exports.WorkerProxy = WorkerProxy;
