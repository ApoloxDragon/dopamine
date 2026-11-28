const log = require('electron-log');

class Logger {
    /** Extra logging for development: set from the app's developer options (passed to the indexing worker). */
    static extraLogging = false;

    /** Detail for finding bugs: only written when extra logging is on. */
    debug(message, callerClass, callerMethod) {
        if (Logger.extraLogging) {
            log.info(`[debug] ${this.#formattedMessage(message, callerClass, callerMethod)}`);
        }
    }

    info(message, callerClass, callerMethod) {
        log.info(this.#formattedMessage(message, callerClass, callerMethod));
    }

    warn(message, callerClass, callerMethod) {
        log.warn(this.#formattedMessage(message, callerClass, callerMethod));
    }

    error(error, message, callerClass, callerMethod) {
        log.error(this.#formattedMessageWithError(error, message, callerClass, callerMethod));
    }

    #formattedMessage(message, callerClass, callerMethod) {
        return `[${callerClass}] [${callerMethod}] ${message}`;
    }

    #formattedMessageWithError(error, message, callerClass, callerMethod) {
        return `[${callerClass}] [${callerMethod}]  ${message.endsWith('.') ? message : message + '.'}${
            error instanceof Error ? ' Error: ' + error.message : ''
        }`;
    }
}

exports.Logger = Logger;
