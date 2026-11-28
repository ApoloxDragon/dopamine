import { DevBuildService } from './services/dev-build/dev-build.service';
import { NetworkShareGuardService } from './services/network-drives/network-share-guard.service';
import { Component, HostListener, OnInit, ViewChild } from '@angular/core';
import { MatDrawer } from '@angular/material/sidenav';
import log from 'electron-log';
import * as os from 'os';
import * as path from 'path';
import { Subscription } from 'rxjs';
import { ProductInformation } from './common/application/product-information';
import { Logger } from './common/logger';
import { PromiseUtils } from './common/utils/promise-utils';
import { IntegrationTestRunner } from './testing/integration-test-runner';
import { AppConfig } from '../environments/environment';
import { NavigationServiceBase } from './services/navigation/navigation.service.base';
import { AppearanceServiceBase } from './services/appearance/appearance.service.base';
import { TranslatorServiceBase } from './services/translator/translator.service.base';
import { ScrobblingService } from './services/scrobbling/scrobbling.service';
import { TrayServiceBase } from './services/tray/tray.service.base';
import { MediaSessionService } from './services/media-session/media-session.service';
import { EventListenerServiceBase } from './services/event-listener/event-listener.service.base';
import { AddToPlaylistMenu } from './ui/components/add-to-playlist-menu';
import { DesktopBase } from './common/io/desktop.base';
import { LifetimeService } from './services/lifetime/lifetime.service';
import { ListeningTrackerService } from './services/statistics/listening-tracker.service';
import { AudioVisualizer } from './services/playback/audio-visualizer';
import { DiscordService } from './services/discord/discord.service';
import { DockService } from './services/dock/dock.service';
import { DatabaseMigratorBase } from './data/database-migrator.base';
import { RatingBackupService } from './services/rating-backup/rating-backup.service';
import { TrackRepositoryBase } from './data/repositories/track-repository.base';
import { IndexingService } from './services/indexing/indexing.service';
import { FolderServiceBase } from './services/folder/folder.service.base';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
    private subscription: Subscription = new Subscription();

    public constructor(
        private databaseMigrator: DatabaseMigratorBase,
        private navigationService: NavigationServiceBase,
        private appearanceService: AppearanceServiceBase,
        private translatorService: TranslatorServiceBase,
        private discordService: DiscordService,
        private dockService: DockService,
        private scrobblingService: ScrobblingService,
        private trayService: TrayServiceBase,
        private mediaSessionService: MediaSessionService,
        private eventListenerService: EventListenerServiceBase,
        public lifetimeService: LifetimeService,
        private listeningTrackerService: ListeningTrackerService,
        private addToPlaylistMenu: AddToPlaylistMenu,
        private desktop: DesktopBase,
        private logger: Logger,
        private audioVisualizer: AudioVisualizer,
        private integrationTestRunner: IntegrationTestRunner,
        private ratingBackupService: RatingBackupService,
        private trackRepository: TrackRepositoryBase,
        private indexingService: IndexingService,
        private folderService: FolderServiceBase,
        private networkShareGuard: NetworkShareGuardService,
        private devBuildService: DevBuildService,
    ) {
        log.create('renderer');
        log.transports.file.resolvePath = () => path.join(this.desktop.getApplicationDataDirectory(), 'logs', 'Dopamine.log');
    }

    @ViewChild('playbackQueueDrawer') public playbackQueueDrawer: MatDrawer | undefined = undefined;

    @HostListener('document:keydown', ['$event'])
    public handleKeyboardEvent(event: KeyboardEvent): void {
        if (event.key === ' ' && !(event.target instanceof HTMLInputElement)) {
            // Prevents scrolling when pressing SPACE
            event.preventDefault();
        }
    }

    public async ngOnInit(): Promise<void> {
        if (!AppConfig.production) {
            this.logger.info('Executing integration tests', 'AppComponent', 'ngOnInit');
            // await this.integrationTestRunner.executeTestsAsync();
        }

        this.logger.info(
            `+++ Started ${ProductInformation.applicationName} ${ProductInformation.applicationVersion} +++`,
            'AppComponent',
            'ngOnInit',
        );

        this.logger.info(`Operating system: ${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`, 'AppComponent', 'ngOnInit');

        this.subscription.add(
            this.navigationService.showPlaybackQueueRequested$.subscribe(() => {
                if (this.playbackQueueDrawer != undefined) {
                    PromiseUtils.noAwait(this.playbackQueueDrawer.toggle());
                }
            }),
        );

        // Re-attempt backup/restore once indexing completes, because tracks may not be available early at startup.
        this.subscription.add(
            this.indexingService.indexingFinished$.subscribe(() => {
                PromiseUtils.noAwait(this.createInitialRatingsBackupAndAutoRestoreIfNeededAsync());
            }),
        );

        // Folder add/remove can change which tracks are present, so run backup/restore immediately on the current indexed tracks.
        this.subscription.add(
            this.folderService.foldersChanged$.subscribe(() => {
                PromiseUtils.noAwait(this.resetGuardAndRetryRatingsRestoreAsync());
            }),
        );

        this.devBuildService.initialize();
        this.databaseMigrator.migrate();
        // Before the queue is restored: a network share that is now under another folder name keeps its songs.
        this.networkShareGuard.relocateMovedShares();
        PromiseUtils.noAwait(this.networkShareGuard.reconnectMissingSharesAsync());

        this.audioVisualizer.initialize();
        await this.addToPlaylistMenu.initializeAsync();
        this.discordService.initialize();
        await this.appearanceService.applyAppearanceAsync();
        this.translatorService.applyLanguage();
        this.trayService.updateTrayContextMenu();
        this.mediaSessionService.initialize();
        this.dockService.initialize();
        this.scrobblingService.initialize();
        this.eventListenerService.listenToEvents();
        // Before the lifetime service: the running listening session must be saved before closing tasks complete.
        this.listeningTrackerService.initialize();
        this.lifetimeService.initialize();
        await this.navigationService.navigateToLoadingAsync();
        this.devBuildService.showWarningIfNeeded();
    }

    private async createInitialRatingsBackupAndAutoRestoreIfNeededAsync(): Promise<void> {
        try {
            const tracks = this.trackRepository.getVisibleTracks();

            if (tracks != undefined && tracks.length > 0) {
                // Restore is intentionally tied to indexing completion only.
                await this.ratingBackupService.createInitialBackupFromTracksAsync(tracks);
                await this.ratingBackupService.tryAutoRestoreOnStartupAsync(tracks);
                await this.ratingBackupService.syncBackupFromTracksAsync(tracks);
            }
        } catch (e: unknown) {
            this.logger.error(
                e,
                'Could not create initial ratings backup or auto-restore ratings',
                'AppComponent',
                'createInitialRatingsBackupAndAutoRestoreIfNeededAsync',
            );
        }
    }

    private async resetGuardAndRetryRatingsRestoreAsync(): Promise<void> {
        await this.ratingBackupService.resetAutoRestoreGuardAsync();
        await this.createInitialRatingsBackupAndAutoRestoreIfNeededAsync();
    }
}
