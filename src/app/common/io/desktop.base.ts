import { Observable } from 'rxjs';

export abstract class DesktopBase {
    public abstract accentColorChanged$: Observable<void>;
    public abstract nativeThemeUpdated$: Observable<void>;

    public abstract showSelectFolderDialogAsync(dialogTitle: string, defaultPath?: string): Promise<string>;
    /** filters: file types to offer, e.g. [{ name: 'Text', extensions: ['txt'] }]. Without filters every file can be chosen. */
    public abstract showSelectFileDialogAsync(dialogTitle: string, filters?: { name: string; extensions: string[] }[]): Promise<string>;
    /** filters: file types to offer. Defaults to images (png, jpg) as before. */
    public abstract showSaveFileDialogAsync(
        dialogTitle: string,
        defaultPath: string,
        filters?: { name: string; extensions: string[] }[],
    ): Promise<string>;

    public abstract openLinkAsync(url: string): Promise<void>;
    public abstract openPathAsync(path: string): Promise<void>;
    public abstract showFileInDirectory(filePath: string): void;
    public abstract shouldUseDarkColors(): boolean;
    public abstract getAccentColor(): string;
    public abstract moveFileToTrashAsync(filePath: string): Promise<void>;
    public abstract getMusicDirectory(): string;
    public abstract getApplicationDataDirectory(): string;
    public abstract getBundledTranslationsDirectory(): string;
    public abstract setWindowAlwaysOnTop(alwaysOnTop: boolean): void;
}
