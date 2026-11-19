import { AfterViewInit, Component, ElementRef, HostListener, Input, OnDestroy, ViewChild } from '@angular/core';
import { EqualizerServiceBase } from '../../../../../services/equalizer/equalizer.service.base';
import { EqualizerFilter, ParametricBand, ParametricEqualizer, ParametricFilterType, ParametricProfile } from '../../../../../services/equalizer/parametric-equalizer';
import { DesktopBase } from '../../../../../common/io/desktop.base';
import { FileAccessBase } from '../../../../../common/io/file-access.base';
import { TranslatorServiceBase } from '../../../../../services/translator/translator.service.base';
import { Logger } from '../../../../../common/logger';

interface Marker {
    index: number;
    x: number;
    y: number;
}

/**
 * Editor for the parametric equalizer: a response curve with draggable band handles (drag: frequency and gain,
 * mouse wheel: Q), a table with every band, preamp, clipping protection, and AutoEQ / Equalizer APO import and export.
 */
@Component({
    selector: 'app-parametric-equalizer-panel',
    templateUrl: './parametric-equalizer-panel.component.html',
    styleUrls: ['./parametric-equalizer-panel.component.scss'],
})
export class ParametricEqualizerPanelComponent implements AfterViewInit, OnDestroy {
    private static readonly curvePoints: number = 240;
    private static readonly textFileFilters: { name: string; extensions: string[] }[] = [{ name: 'Equalizer APO / AutoEQ', extensions: ['txt'] }];

    @Input() public isEnabled: boolean = true;
    @ViewChild('chart') private chart!: ElementRef<HTMLElement>;

    public readonly p = ParametricEqualizer;
    public readonly filterTypes: ParametricFilterType[] = ParametricEqualizer.filterTypes;
    public width: number = 600;
    public readonly height: number = 200;
    public range: number = 12;
    public curvePath: string = '';
    public zeroY: number = 100;
    public gridLines: { y: number; label: string }[] = [];
    public frequencyLabels: { x: number; label: string }[] = [];
    public markers: Marker[] = [];
    public selectedIndex: number = -1;
    public peakDb: number = 0;
    public message: string = '';

    private dragIndex: number = -1;
    private resizeObserver?: ResizeObserver;

    public constructor(
        public equalizerService: EqualizerServiceBase,
        private desktop: DesktopBase,
        private fileAccess: FileAccessBase,
        private translatorService: TranslatorServiceBase,
        private logger: Logger,
    ) {}

    public get profile(): ParametricProfile {
        return this.equalizerService.parametricProfile;
    }

    /** True when boosts are not fully compensated by the preamp, so loud passages can clip. */
    public get mayClip(): boolean {
        return this.peakDb + this.profile.preamp > 0.05;
    }

    public get suggestedPreamp(): number {
        return -Math.ceil(this.peakDb * 10) / 10;
    }

    public ngAfterViewInit(): void {
        this.resizeObserver = new ResizeObserver(() => this.update());
        this.resizeObserver.observe(this.chart.nativeElement);
        setTimeout(() => this.update());
    }

    public ngOnDestroy(): void {
        this.resizeObserver?.disconnect();
    }

    public update(): void {
        const element: HTMLElement | undefined = this.chart?.nativeElement;

        if (element !== undefined && element.clientWidth > 0) {
            this.width = element.clientWidth;
        }

        const profile: ParametricProfile = this.profile;
        const filters: EqualizerFilter[] = ParametricEqualizer.toFilters(profile);
        const frequencies: number[] = ParametricEqualizer.responseFrequencies(ParametricEqualizer.curvePointsFor(this.width, ParametricEqualizerPanelComponent.curvePoints));
        const response: number[] = ParametricEqualizer.responseDb(filters, 0, frequencies);

        this.peakDb = Math.max(0, ...response);
        const largest: number = Math.max(...response.map((x) => Math.abs(x)), ...profile.bands.map((b) => Math.abs(b.gain)));
        this.range = Math.min(30, Math.max(12, Math.ceil(largest / 6) * 6));
        this.zeroY = this.toY(0);

        this.curvePath = frequencies.map((f, i) => `${i === 0 ? 'M' : 'L'} ${this.round(this.toX(f))} ${this.round(this.toY(response[i]))}`).join(' ');
        this.gridLines = [-this.range, -this.range / 2, 0, this.range / 2, this.range].map((db) => ({ y: this.round(this.toY(db)), label: `${db > 0 ? '+' : ''}${db}` }));
        this.frequencyLabels = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((f) => ({ x: this.round(this.toX(f)), label: this.formatFrequency(f) }));

        this.markers = profile.bands
            .map((band, index) => ({ band, index }))
            .filter((x) => x.band.enabled)
            .map(({ band, index }) => {
                const db: number = ParametricEqualizer.responseDb(filters, 0, [band.frequency])[0];
                return { index, x: this.round(this.toX(band.frequency)), y: this.round(this.toY(Math.max(-this.range, Math.min(this.range, db)))) };
            });
    }

    // ---- Band editing ----

    public setEnabled(index: number, enabled: boolean): void {
        this.equalizerService.updateParametricBand(index, { enabled });
        this.update();
    }

    public setType(index: number, type: string): void {
        this.equalizerService.updateParametricBand(index, { type: type as ParametricFilterType });
        this.update();
    }

    public setNumber(index: number, field: 'frequency' | 'gain' | 'q', value: string): void {
        const parsed: number = parseFloat(value.replace(',', '.'));

        if (!Number.isNaN(parsed)) {
            this.equalizerService.updateParametricBand(index, { [field]: parsed } as Partial<ParametricBand>);
        }

        this.update();
    }

    public setPreamp(value: string): void {
        const parsed: number = parseFloat(value.replace(',', '.'));

        if (!Number.isNaN(parsed)) {
            this.equalizerService.setParametricPreamp(parsed);
        }

        this.update();
    }

    public preventClipping(): void {
        this.equalizerService.preventParametricClipping();
        this.update();
    }

    public addBand(): void {
        this.equalizerService.addParametricBand();
        this.selectedIndex = this.profile.bands.length - 1;
        this.update();
    }

    public removeBand(index: number): void {
        this.equalizerService.removeParametricBand(index);
        this.selectedIndex = -1;
        this.update();
    }

    public reset(): void {
        this.equalizerService.resetParametric();
        this.selectedIndex = -1;
        this.message = '';
        this.update();
    }

    // ---- Dragging handles on the curve ----

    public onMarkerPointerDown(index: number, event: PointerEvent): void {
        if (!this.isEnabled) {
            return;
        }

        this.dragIndex = index;
        this.selectedIndex = index;
        event.preventDefault();
        event.stopPropagation();
    }

    @HostListener('document:pointermove', ['$event'])
    public onPointerMove(event: PointerEvent): void {
        if (this.dragIndex < 0 || this.chart === undefined) {
            return;
        }

        const rect: DOMRect = this.chart.nativeElement.getBoundingClientRect();
        const x: number = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
        const y: number = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
        const band: ParametricBand = this.profile.bands[this.dragIndex];
        const changes: Partial<ParametricBand> = { frequency: Math.round(this.fromX(x)) };

        if (ParametricEqualizer.usesGain(band.type)) {
            changes.gain = Math.round(this.fromY(y) * 10) / 10;
        }

        this.equalizerService.updateParametricBand(this.dragIndex, changes);
        this.update();
    }

    @HostListener('document:pointerup')
    public onPointerUp(): void {
        this.dragIndex = -1;
    }

    public onMarkerWheel(index: number, event: WheelEvent): void {
        if (!this.isEnabled) {
            return;
        }

        const band: ParametricBand = this.profile.bands[index];

        if (ParametricEqualizer.usesQ(band.type)) {
            const factor: number = event.deltaY < 0 ? 1.1 : 1 / 1.1;
            this.equalizerService.updateParametricBand(index, { q: band.q * factor });
            this.selectedIndex = index;
            this.update();
        }

        event.preventDefault();
    }

    // ---- Import / export ----

    public async importAsync(): Promise<void> {
        const path: string = await this.desktop.showSelectFileDialogAsync(
            this.translatorService.get('equalizer-import'),
            ParametricEqualizerPanelComponent.textFileFilters,
        );

        if (path === '') {
            return;
        }

        try {
            const result = this.equalizerService.importParametricText(this.fileAccess.getFileContentAsString(path));

            if (result === undefined) {
                this.message = this.translatorService.get('equalizer-import-nothing-found');
            } else {
                this.message = this.translatorService.get('equalizer-import-result', {
                    bands: result.bands,
                    skipped: result.skippedLines,
                });
            }
        } catch (e: unknown) {
            this.logger.error(e, `Could not import equalizer file '${path}'`, 'ParametricEqualizerPanelComponent', 'importAsync');
            this.message = this.translatorService.get('equalizer-import-nothing-found');
        }

        this.selectedIndex = -1;
        this.update();
    }

    public async exportAsync(): Promise<void> {
        const path: string = await this.desktop.showSaveFileDialogAsync(
            this.translatorService.get('equalizer-export'),
            'ParametricEQ.txt',
            ParametricEqualizerPanelComponent.textFileFilters,
        );

        if (path === '') {
            return;
        }

        try {
            this.fileAccess.writeToFile(path, this.equalizerService.exportParametricText());
            this.message = this.translatorService.get('equalizer-export-done');
        } catch (e: unknown) {
            this.logger.error(e, `Could not export equalizer file '${path}'`, 'ParametricEqualizerPanelComponent', 'exportAsync');
        }
    }

    // ---- Formatting and scales ----

    public formatFrequency(frequency: number): string {
        return frequency >= 1000 ? `${Math.round(frequency / 100) / 10}k` : `${Math.round(frequency)}`;
    }

    public trackByIndex(index: number): number {
        return index;
    }

    private toX(frequency: number): number {
        const min: number = Math.log10(ParametricEqualizer.minimumFrequency);
        const max: number = Math.log10(ParametricEqualizer.maximumFrequency);
        return ((Math.log10(frequency) - min) / (max - min)) * this.width;
    }

    private fromX(x: number): number {
        const min: number = Math.log10(ParametricEqualizer.minimumFrequency);
        const max: number = Math.log10(ParametricEqualizer.maximumFrequency);
        return Math.pow(10, min + (x / this.width) * (max - min));
    }

    private toY(db: number): number {
        return ((this.range - db) / (2 * this.range)) * this.height;
    }

    private fromY(y: number): number {
        return this.range - (y / this.height) * 2 * this.range;
    }

    private round(value: number): number {
        return Math.round(value * 10) / 10;
    }
}
