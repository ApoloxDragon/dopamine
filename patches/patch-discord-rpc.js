#!/usr/bin/env node

// discord-rpc 4.0.1 only sends the activity fields it knows about. This adds:
// - type: the activity type (2 = "Listening to" instead of "Playing").
// - status_display_type: which text the status shows (1 = "Listening to {state}", i.e. the artist,
//   instead of "Listening to Dopamine"). See StatusDisplayType in discord-api-types.
// Each addition is applied on its own, so an install that already has the older 'type' patch gets the new one too.

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../node_modules/discord-rpc/src/client.js');
const anchor = `        instance: !!args.instance,\n`;
const additions = [`        type: args.type,\n`, `        status_display_type: args.statusDisplayType,\n`];

try {
    let content = fs.readFileSync(filePath, 'utf8');

    if (!content.includes(anchor)) {
        console.error('[discord-rpc patch] Expected snippet not found');
        process.exit(1);
    }

    let applied = 0;
    let insertAfter = anchor;

    for (const addition of additions) {
        if (!content.includes(addition)) {
            content = content.replace(insertAfter, insertAfter + addition);
            applied++;
        }

        insertAfter = addition;
    }

    if (applied === 0) {
        console.log('[discord-rpc patch] Already patched, skipping');
        process.exit(0);
    }

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[discord-rpc patch] Patch applied (${applied} field(s))`);
} catch (error) {
    console.error('[discord-rpc patch] Failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
}
