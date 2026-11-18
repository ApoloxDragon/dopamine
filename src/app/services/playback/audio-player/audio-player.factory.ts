import { IAudioPlayer } from './i-audio-player';
import { LegacyAudioPlayer } from './legacy-audio-player';
import { Injectable } from '@angular/core';
import { MathExtensions } from '../../../common/math-extensions';
import { Logger } from '../../../common/logger';
import { SettingsBase } from '../../../common/settings/settings.base';
import { GaplessAudioPlayer } from './gapless-audio-player';
import { CrossfadeAudioPlayer } from './crossfade-audio-player';
import { EqualizerServiceBase } from '../../equalizer/equalizer.service.base';
import { CueAwareAudioPlayer } from './cue-aware-audio-player';

@Injectable({ providedIn: 'root' })
export class AudioPlayerFactory {
    public constructor(
        private mathExtensions: MathExtensions,
        private settings: SettingsBase,
        private equalizerService: EqualizerServiceBase,
        private logger: Logger,
    ) {}

    public create(): IAudioPlayer {
        // CUE sheet tracks always play through a streaming LegacyAudioPlayer (see CueAwareAudioPlayer).
        const createCuePlayer = (): IAudioPlayer => {
            this.logger.info('Creating LegacyAudioPlayer for CUE sheet tracks.', 'AudioPlayerFactory', 'create');
            return new LegacyAudioPlayer(this.mathExtensions, this.equalizerService, this.logger, this.settings);
        };

        if (this.settings.useCrossfade) {
            this.logger.info('Creating CrossfadeAudioPlayer for audio playback.', 'AudioPlayerFactory', 'create');
            return new CueAwareAudioPlayer(
                new CrossfadeAudioPlayer(this.mathExtensions, this.settings, this.equalizerService, this.logger),
                createCuePlayer,
                false,
            );
        } else if (this.settings.useGaplessPlayback) {
            this.logger.info('Creating GaplessAudioPlayer for audio playback.', 'AudioPlayerFactory', 'create');
            return new CueAwareAudioPlayer(
                new GaplessAudioPlayer(this.mathExtensions, this.equalizerService, this.logger, this.settings),
                createCuePlayer,
                false,
            );
        } else {
            this.logger.info('Creating LegacyAudioPlayer for audio playback.', 'AudioPlayerFactory', 'create');
            return new CueAwareAudioPlayer(
                new LegacyAudioPlayer(this.mathExtensions, this.equalizerService, this.logger, this.settings),
                createCuePlayer,
                true,
            );
        }
    }
}
