/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
// Torture tests for what is sent to Discord. Discord drops the whole activity when one text is shorter than 2 or longer
// than 128 characters, or a value is not what it expects, so every nonsense input must still give a valid activity.
jest.mock('electron-log', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
import { DiscordApi } from '../../../../main/api/discord/discord-api';

function createApi(): { api: any; client: any } {
    const api: any = new DiscordApi('id');
    const client = { setActivity: jest.fn(), clearActivity: jest.fn(), destroy: jest.fn() };
    api._client = client;
    api._isReady = true;
    return { api, client };
}

const base: any = {
    title: 'Warriors Of The North',
    artists: 'Amon Amarth',
    largeImageKey: 'icon',
    largeImageText: 'Deceiver Of The Gods (CD1)',
    smallImageKey: 'play',
    smallImageText: 'Playing',
    type: 2,
    statusDisplayType: 1,
    shouldSendTimestamps: true,
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_300_000,
};

function sent(args: any): any {
    const { api, client } = createApi();
    api.setPresence({ ...base, ...args });
    return client.setActivity.mock.calls[0][0];
}

const isValidText = (text: any): boolean =>
    typeof text === 'string' &&
    text.length <= 128 &&
    text.length >= 2 &&
    text.trim().length >= 1 &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

describe('DiscordApi torture', () => {
    it('the regular customer: a normal song is sent as it is', () => {
        const activity = sent({});

        expect(activity).toEqual(
            expect.objectContaining({
                details: 'Warriors Of The North',
                state: 'Amon Amarth',
                largeImageText: 'Deceiver Of The Gods (CD1)',
                startTimestamp: base.startTime,
                endTimestamp: base.endTime,
            }),
        );
    });

    it.each([
        ['empty', ''],
        ['one letter', 'A'],
        ['spaces only', '     '],
        ['a tab and a newline', '\t\n'],
        ['undefined', undefined],
        ['null', null],
        ['a number', 42],
        ['200 letters', 'x'.repeat(200)],
        ['127 letters then an emoji (cut through a surrogate pair)', 'x'.repeat(127) + '🍺🦎'],
        ['200 emoji', '🦎'.repeat(200)],
        ['zalgo', 'Z̷̢̛̛̛a̸̢̛l̵̢̛g̶̢̛ơ̷̢'.repeat(30)],
        ['a lone surrogate', '\uD83C'],
        ['NUL bytes', '\0\0\0'],
        ['zero-width spaces only', '​​​'],
    ])('should send a valid title and artist for %s', (_: string, value: any) => {
        const activity = sent({ title: value, artists: value, largeImageText: value, smallImageText: value });

        for (const field of ['details', 'state']) {
            expect(isValidText(activity[field])).toBe(true);
        }
        // Captions may be left out, but never sent broken.
        for (const field of ['largeImageText', 'smallImageText']) {
            expect(activity[field] === undefined || isValidText(activity[field])).toBe(true);
        }
        expect(activity.details).not.toContain('undefined');
        expect(activity.details).not.toContain('null');
    });

    it.each([
        [NaN, NaN],
        [Infinity, Infinity],
        [-1, 5],
        [0, 100],
        ['qwertyuiop', 'lizard'],
        [1e300, 1e301],
        [base.startTime, base.startTime - 1],
        [base.startTime, NaN],
    ])('should only send sane timestamps for start %p and end %p', (startTime: any, endTime: any) => {
        const activity = sent({ startTime, endTime });

        for (const value of [activity.startTimestamp, activity.endTimestamp]) {
            expect(value === undefined || (Number.isSafeInteger(value) && value > 0)).toBe(true);
        }
        if (activity.endTimestamp !== undefined) {
            expect(activity.endTimestamp).toBeGreaterThan(activity.startTimestamp);
        }
    });

    it('should not send timestamps when paused', () => {
        const activity = sent({ shouldSendTimestamps: false });

        expect(activity.startTimestamp).toBeUndefined();
        expect(activity.endTimestamp).toBeUndefined();
    });

    it('should send the Dopamine icon instead of a cover URL that is not https or too long', () => {
        for (const key of ['http://img/x.jpg', 'javascript:alert(1)', 'https://' + 'x'.repeat(400), '', undefined]) {
            expect(sent({ largeImageKey: key }).largeImageKey).toEqual('icon');
        }
        expect(sent({ largeImageKey: 'https://lastfm.freetls.fastly.net/i/u/300x300/abc.png' }).largeImageKey).toEqual(
            'https://lastfm.freetls.fastly.net/i/u/300x300/abc.png',
        );
    });

    it('should not throw when Discord throws while sending', () => {
        const { api, client } = createApi();
        client.setActivity.mockImplementation(() => {
            throw new Error('connection closed');
        });

        expect(() => api.setPresence(base)).not.toThrow();
    });

    it('should not throw when Discord rejects while sending', async () => {
        const { api, client } = createApi();
        client.setActivity.mockReturnValue(Promise.reject(new Error('RPC_CONNECTION_TIMEOUT')));

        expect(() => api.setPresence(base)).not.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
});
