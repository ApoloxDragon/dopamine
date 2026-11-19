// Browser entry: exposes the real AudioEqualizer and the response calculation for comparison with Chromium.
import { AudioEqualizer } from '../../../src/app/services/playback/audio-player/audio-equalizer';
import { ParametricEqualizer } from '../../../src/app/services/equalizer/parametric-equalizer';

(window as any).eq = { AudioEqualizer, ParametricEqualizer };
