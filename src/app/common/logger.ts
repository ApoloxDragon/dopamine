import { Injectable } from '@angular/core';
import log from 'electron-log';
import { DevBuild } from './application/dev-build';

@Injectable()
export class Logger {
    /** Extra logging for development (developer options in dev builds). Off unless turned on there. */
    public static extraLogging: boolean = false;

    /** Detail for finding bugs: only written when extra logging is on. */
    public debug(message: string, callerClass: string, callerMethod: string): void {
        if (Logger.extraLogging && DevBuild.isActive) {
            log.info(`[debug] ${this.formattedMessage(message, callerClass, callerMethod)}`);
        }
    }

    public info(message: string, callerClass: string, callerMethod: string): void {
        log.info(this.formattedMessage(message, callerClass, callerMethod));
    }

    public warn(message: string, callerClass: string, callerMethod: string): void {
        log.warn(this.formattedMessage(message, callerClass, callerMethod));
    }

    public error(error: unknown, message: string, callerClass: string, callerMethod: string): void {
        log.error(this.formattedMessageWithError(error, message, callerClass, callerMethod));
    }

    private formattedMessage(message: string, callerClass: string, callerMethod: string): string {
        return `[${callerClass}] [${callerMethod}] ${message}`;
    }

    private formattedMessageWithError(error: unknown, message: string, callerClass: string, callerMethod: string): string {
        const base = `[${callerClass}] [${callerMethod}]  ${message.endsWith('.') ? message : message + '.'}`;

        if (error instanceof Error) {
            return `${base} Error: ${error.message}\nStack:\n${error.stack ?? ''}`;
        } else if (typeof error === 'string') {
            return `${base} Error: ${error}`;
        } else if (error !== undefined && error !== null) {
            try {
                return `${base} Error: ${JSON.stringify(error, undefined, 2)}`;
            } catch {
                return `${base} Error: ${String(error)}`;
            }
        } else {
            return base;
        }
    }
}
